import { streamAnswer, type ChatMessage } from "@/lib/chat/llm";
import {
  NO_CONTEXT_ANSWER,
  NO_SELECTION_ANSWER,
  buildSystemPrompt,
  hasUsableContext,
} from "@/lib/chat/prompt";
import { retrieveChunks, type RetrievedChunk } from "@/lib/chat/retrieve";
import { usedSources } from "@/lib/chat/citations";
import { buildSearchQuery } from "@/lib/chat/rewrite";
import {
  HISTORY_LIMIT,
  appendMessage,
  listRecentMessages,
} from "@/lib/messages";
import { getNotebook } from "@/lib/notebooks";
import type { SourceType } from "@/lib/source-limits";
import { listSelectedSourceIds } from "@/lib/sources";

/**
 * Chat-Endpunkt.
 *
 * Der erste Route Handler im Projekt. Server Actions koennen keine Antwort
 * streamen, deshalb laeuft der Chat hier und nicht als Action.
 */

/** Retrieval, Prompt und Antwort brauchen mehr als die 10 Sekunden Vorgabe. */
export const maxDuration = 60;

/** Obergrenze fuer eine einzelne Frage. */
const MAX_QUESTION_LENGTH = 2000;

/**
 * Kennzeichnung einer abgebrochenen Antwort.
 *
 * Steht im Text statt in einer eigenen Spalte: eine Migration fuer ein
 * Merkmal, das der Nutzer ohnehin lesen soll, waere zu viel Aufwand fuer zu
 * wenig Gewinn.
 */
const ABORTED_SUFFIX = "\n\n(Antwort abgebrochen.)";

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
  sourceType: SourceType;
  title: string;
  page: number | null;
  url: string | null;
  similarity: number;
  /**
   * Der woertliche Abschnitt, auf den sich die Antwort beruft.
   *
   * Geht mit, obwohl er den Stream groesser macht: ohne ihn muesste der
   * Browser fuer jeden Klick nachladen, und der Beleg waere einen
   * Netzwerkaufruf weit statt sofort da. Das Nachpruefen einer Aussage ist
   * der Kern dieses Produkts und darf sich nicht traege anfuehlen.
   */
  content: string;
};

function toChatSources(chunks: RetrievedChunk[]): ChatSource[] {
  return chunks.map((chunk, index) => ({
    marker: index + 1,
    chunkId: chunk.chunkId,
    sourceId: chunk.sourceId,
    sourceType: chunk.sourceType,
    title: chunk.sourceTitle,
    page: chunk.page,
    url: chunk.sourceUrl,
    similarity: chunk.similarity,
    content: chunk.content,
  }));
}

function encodeEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

/**
 * Prueft und normalisiert, was der Browser geschickt hat.
 *
 * Der Browser schickt nur noch die Frage. Den Verlauf holt der Server aus der
 * Datenbank - sonst gaebe es zwei Wahrheiten darueber, was gesagt wurde, und
 * sie wuerden auseinanderlaufen, sobald ein zweiter Tab offen ist.
 */
function readRequestBody(body: unknown):
  | { ok: true; notebookId: string; question: string }
  | { ok: false; message: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Ungueltige Anfrage." };
  }

  const { notebookId, question } = body as {
    notebookId?: unknown;
    question?: unknown;
  };

  if (typeof notebookId !== "string" || notebookId.length === 0) {
    return { ok: false, message: "Es fehlt die Angabe des Notebooks." };
  }

  if (typeof question !== "string" || question.trim().length === 0) {
    return { ok: false, message: "Es fehlt die Frage." };
  }

  return {
    ok: true,
    notebookId,
    question: question.trim().slice(0, MAX_QUESTION_LENGTH),
  };
}

/**
 * Eine feste Antwort im selben Format wie eine gestreamte.
 *
 * Der Browser soll nicht zwei Faelle unterscheiden muessen: eine Absage ist
 * eine Antwort, nur eben ohne Belege und ohne Modell.
 */
function antwortStrom(text: string): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encodeEvent({ type: "sources", sources: [] }));
      controller.enqueue(encodeEvent({ type: "delta", text }));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  });
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

  // Der Verlauf kommt aus der Datenbank, nicht aus dem Browser.
  let history: ChatMessage[];
  try {
    history = (await listRecentMessages(notebook.id, HISTORY_LIMIT)).map(
      ({ role, content }) => ({ role, content }),
    );
  } catch (error) {
    console.error("Verlauf konnte nicht geladen werden:", error);
    return Response.json(
      { message: "Der bisherige Verlauf konnte nicht geladen werden." },
      { status: 502 },
    );
  }

  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: input.question },
  ];

  /**
   * Die Frage wird sofort festgehalten, nicht erst mit der Antwort.
   *
   * Scheitert der Lauf danach - Kontingent erschoepft, Anbieter weg -, dann
   * steht die Frage trotzdem im Verlauf. Das entspricht dem, was passiert
   * ist, und der Nutzer kann sie erneut stellen, ohne sie neu zu tippen.
   */
  try {
    await appendMessage(notebook.id, "user", input.question);
  } catch (error) {
    console.error("Frage konnte nicht gespeichert werden:", error);
    return Response.json(
      { message: "Die Frage konnte nicht gespeichert werden." },
      { status: 502 },
    );
  }

  // Gesucht wird mit der aufgeloesten Frage, geantwortet auf Basis des
  // vollen Verlaufs. Beides zu vermischen waere falsch: das Retrieval
  // braucht einen eigenstaendigen Text, das Modell den Gespraechsfaden.
  const searchQuery = await buildSearchQuery(messages, request.signal);

  // Nur ausgewaehlte und fertig verarbeitete Quellen kommen in Frage.
  let sourceIds: string[];
  try {
    sourceIds = await listSelectedSourceIds(notebook.id);
  } catch (error) {
    console.error("Auswahl konnte nicht geladen werden:", error);
    return Response.json(
      { message: "Die Quellenauswahl konnte nicht geladen werden." },
      { status: 502 },
    );
  }

  if (sourceIds.length === 0) {
    await appendMessage(notebook.id, "assistant", NO_SELECTION_ANSWER);
    return antwortStrom(NO_SELECTION_ANSWER);
  }

  let chunks: RetrievedChunk[];
  try {
    chunks = await retrieveChunks(notebook.id, searchQuery, sourceIds);
  } catch (error) {
    console.error("Retrieval fehlgeschlagen:", error);
    return Response.json(
      { message: "Die Suche in den Quellen ist fehlgeschlagen." },
      { status: 502 },
    );
  }

  // Ohne tragfaehigen Kontext wird das Modell gar nicht erst gefragt.
  if (!hasUsableContext(chunks)) {
    // Auch die Absage ist eine Antwort und gehoert in den Verlauf - sonst
    // stuende dort eine Frage, auf die scheinbar nie jemand reagiert hat.
    await appendMessage(notebook.id, "assistant", NO_CONTEXT_ANSWER);
    return antwortStrom(NO_CONTEXT_ANSWER);
  }

  const systemPrompt = buildSystemPrompt(chunks);
  const sources = toChatSources(chunks);

  const stream = new ReadableStream({
    async start(controller) {
      // Die Belegstellen zuerst: der Browser kann sie schon anzeigen,
      // waehrend die Antwort noch laeuft.
      controller.enqueue(encodeEvent({ type: "sources", sources }));

      let antwort = "";

      try {
        for await (const text of streamAnswer(
          systemPrompt,
          messages,
          request.signal,
        )) {
          antwort += text;
          controller.enqueue(encodeEvent({ type: "delta", text }));
        }

        // Gespeichert werden nur die Belege, auf die sich die Antwort
        // tatsaechlich beruft - dieselbe Auswahl, die das UI zeigt.
        await appendMessage(
          notebook.id,
          "assistant",
          antwort,
          usedSources(antwort, sources),
        );
      } catch (error) {
        /**
         * Bricht der Browser ab, ist das kein Fehler. Was bis dahin kam,
         * wird gesichert - der Nutzer hat es gelesen, und ein Verlauf, der
         * es verschweigt, waere gelogen.
         *
         * Aber es wird als Torso gekennzeichnet. Ohne die Markierung sieht
         * ein abgebrochener Halbsatz wie eine sehr knappe Antwort aus, und
         * niemand kann unterscheiden, ob das Modell wenig zu sagen hatte
         * oder ob die Verbindung wegbrach. Ein Druck auf Escape reicht dafuer:
         * der Browser stoppt damit laufende Anfragen.
         */
        if (request.signal.aborted) {
          if (antwort.length > 0) {
            await appendMessage(
              notebook.id,
              "assistant",
              `${antwort}${ABORTED_SUFFIX}`,
              usedSources(antwort, sources),
            ).catch((fehler) =>
              console.error("Teilantwort nicht gespeichert:", fehler),
            );
          }

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
