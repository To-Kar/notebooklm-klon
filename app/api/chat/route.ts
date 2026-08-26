import { streamAnswer, type ChatMessage } from "@/lib/chat/llm";
import {
  NO_CONTEXT_ANSWER,
  buildSystemPrompt,
  hasUsableContext,
} from "@/lib/chat/prompt";
import { retrieveChunks, type RetrievedChunk } from "@/lib/chat/retrieve";
import { getNotebook } from "@/lib/notebooks";

/**
 * Chat-Endpunkt.
 *
 * Der erste Route Handler im Projekt. Server Actions koennen keine Antwort
 * streamen, deshalb laeuft der Chat hier und nicht als Action.
 */

/** Retrieval, Prompt und Antwort brauchen mehr als die 10 Sekunden Vorgabe. */
export const maxDuration = 60;

/** Wie viele Nachrichten des Verlaufs mitgeschickt werden duerfen. */
const MAX_HISTORY = 20;

/** Obergrenze fuer eine einzelne Frage. */
const MAX_QUESTION_LENGTH = 2000;

/**
 * Was ueber die Leitung geht: eine JSON-Zeile je Ereignis.
 *
 * Reiner Text waere einfacher, koennte aber nur die Antwort tragen. Die
 * Zuordnung von [n] zur Quelle muss aber auch beim Browser ankommen - ohne
 * sie gibt es in Arbeitspaket 5 keine klickbaren Zitate. Ein zeilenweises
 * Format traegt beides und laesst sich spaeter erweitern.
 */
export type ChatStreamEvent =
  | { type: "sources"; sources: ChatSource[] }
  | { type: "delta"; text: string }
  | { type: "error"; message: string };

/** Eine Belegstelle, wie sie der Browser braucht. */
export type ChatSource = {
  /** Die Nummer, mit der die Antwort darauf verweist. */
  marker: number;
  chunkId: string;
  sourceId: string;
  title: string;
  page: number | null;
  url: string | null;
  similarity: number;
};

function toChatSources(chunks: RetrievedChunk[]): ChatSource[] {
  return chunks.map((chunk, index) => ({
    marker: index + 1,
    chunkId: chunk.chunkId,
    sourceId: chunk.sourceId,
    title: chunk.sourceTitle,
    page: chunk.page,
    url: chunk.sourceUrl,
    similarity: chunk.similarity,
  }));
}

function encodeEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

/** Prueft und normalisiert, was der Browser geschickt hat. */
function readRequestBody(body: unknown):
  | { ok: true; notebookId: string; messages: ChatMessage[] }
  | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Ungueltige Anfrage." };
  }

  const { notebookId, messages } = body as {
    notebookId?: unknown;
    messages?: unknown;
  };

  if (typeof notebookId !== "string" || notebookId.length === 0) {
    return { ok: false, message: "Es fehlt die Angabe des Notebooks." };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, message: "Es fehlt die Frage." };
  }

  const cleaned: ChatMessage[] = [];

  for (const entry of messages.slice(-MAX_HISTORY)) {
    if (typeof entry !== "object" || entry === null) continue;

    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string" || content.trim().length === 0) continue;

    cleaned.push({ role, content: content.slice(0, MAX_QUESTION_LENGTH) });
  }

  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== "user") {
    return { ok: false, message: "Die letzte Nachricht muss eine Frage sein." };
  }

  return { ok: true, notebookId, messages: cleaned };
}

export async function POST(request: Request) {
  let parsedBody: unknown;

  try {
    parsedBody = await request.json();
  } catch {
    return Response.json({ message: "Ungueltiges JSON." }, { status: 400 });
  }

  const input = readRequestBody(parsedBody);

  if (!input.ok) {
    return Response.json({ message: input.message }, { status: 400 });
  }

  // Die notebookId kommt aus dem Browser und ist ungeprueft.
  const notebook = await getNotebook(input.notebookId);

  if (!notebook) {
    return Response.json(
      { message: "Dieses Notebook gibt es nicht." },
      { status: 404 },
    );
  }

  const question = input.messages[input.messages.length - 1].content;

  let chunks: RetrievedChunk[];
  try {
    chunks = await retrieveChunks(notebook.id, question);
  } catch (error) {
    console.error("Retrieval fehlgeschlagen:", error);
    return Response.json(
      { message: "Die Suche in den Quellen ist fehlgeschlagen." },
      { status: 502 },
    );
  }

  // Ohne tragfaehigen Kontext wird das Modell gar nicht erst gefragt.
  if (!hasUsableContext(chunks)) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encodeEvent({ type: "sources", sources: [] }));
        controller.enqueue(
          encodeEvent({ type: "delta", text: NO_CONTEXT_ANSWER }),
        );
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8" },
    });
  }

  const systemPrompt = buildSystemPrompt(chunks);
  const sources = toChatSources(chunks);

  const stream = new ReadableStream({
    async start(controller) {
      // Die Belegstellen zuerst: der Browser kann sie schon anzeigen,
      // waehrend die Antwort noch laeuft.
      controller.enqueue(encodeEvent({ type: "sources", sources }));

      try {
        for await (const text of streamAnswer(
          systemPrompt,
          input.messages,
          request.signal,
        )) {
          controller.enqueue(encodeEvent({ type: "delta", text }));
        }
      } catch (error) {
        // Bricht der Browser ab, ist das kein Fehler.
        if (request.signal.aborted) {
          controller.close();
          return;
        }

        console.error("Antwort fehlgeschlagen:", error);

        const isRateLimit =
          error instanceof Error && error.name === "RateLimitError";

        controller.enqueue(
          encodeEvent({
            type: "error",
            message: isRateLimit
              ? (error as Error).message
              : "Die Antwort konnte nicht erzeugt werden.",
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      // Verhindert Zwischenpufferung durch Proxys.
      "cache-control": "no-store, no-transform",
    },
  });
}
