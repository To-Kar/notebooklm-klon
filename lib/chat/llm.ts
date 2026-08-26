import { GEMINI_BASE, geminiRequest } from "@/lib/gemini";

/**
 * LLM-Anbieter fuer den Chat.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 *
 * Nach aussen anbieterneutral: streamAnswer nimmt Systemprompt und Verlauf
 * und liefert die Antwort stueckweise. Der Gemini-spezifische Teil steckt in
 * buildPayload und parseSseLine.
 */

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

/**
 * Wartebudget bei Rate-Limit.
 *
 * Deutlich knapper als bei der Ingestion: dort laeuft ein Hintergrundschritt,
 * hier wartet ein Mensch vor einem leeren Chatfenster. Lieber nach wenigen
 * Sekunden ehrlich sagen, dass es gerade nicht geht.
 */
const RETRY_BUDGET_MS = 8_000;

/**
 * Niedrige Temperatur.
 *
 * Die Antwort soll die Quellen wiedergeben, nicht ausschmuecken. Kreativitaet
 * ist hier ein Fehler, kein Feature.
 */
const TEMPERATURE = 0.2;

/**
 * Kein internes "Nachdenken" vor der Antwort.
 *
 * Gemessen mit gemini-3.5-flash bei gleicher Frage und praktisch gleicher
 * Antwortlaenge:
 *   ohne Angabe        erstes Zeichen nach 7246 ms, fertig nach 8778 ms
 *   thinkingBudget 0   erstes Zeichen nach 1070 ms, fertig nach 3384 ms
 *
 * Sieben Sekunden vor einem leeren Chatfenster sind fuer eine Demo nicht
 * vertretbar. Und die Aufgabe rechtfertigt den Aufwand nicht: die Antwort
 * soll die gefundenen Abschnitte treu wiedergeben, nicht selbst schliessen.
 *
 * Gemini-spezifisch, deshalb steht es hier und nicht in der Schnittstelle
 * nach aussen.
 */
const THINKING_BUDGET = 0;

function readChatModel(): string {
  const model = process.env.LLM_MODEL;

  if (!model) {
    throw new Error("Fehlende Env-Variable: LLM_MODEL");
  }

  return model;
}

/** Gemini nennt die Assistentenrolle 'model'. */
function toGeminiRole(role: ChatRole): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

function buildPayload(
  systemPrompt: string,
  messages: ChatMessage[],
  maxOutputTokens?: number,
) {
  return {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: messages.map((message) => ({
      role: toGeminiRole(message.role),
      parts: [{ text: message.content }],
    })),
    generationConfig: {
      temperature: TEMPERATURE,
      thinkingConfig: { thinkingBudget: THINKING_BUDGET },
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    },
  };
}

type GenerateResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

/**
 * Eine kurze Antwort ohne Streaming.
 *
 * Fuer Zwischenschritte, deren Ergebnis der Nutzer nie zu sehen bekommt und
 * bei denen Streaming nur Umstand waere.
 */
export async function generateText(
  systemPrompt: string,
  messages: ChatMessage[],
  maxOutputTokens: number,
  signal?: AbortSignal,
): Promise<string> {
  const model = readChatModel();

  const response = await geminiRequest(
    `${GEMINI_BASE}/models/${model}:generateContent`,
    buildPayload(systemPrompt, messages, maxOutputTokens),
    { budgetMs: RETRY_BUDGET_MS, signal },
  );

  const json = (await response.json()) as GenerateResponse;

  return (json.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

type StreamChunk = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
};

/**
 * Zieht den Text aus einer SSE-Zeile.
 * Gibt null zurueck, wenn die Zeile kein Datenpaket ist oder keinen Text traegt.
 */
function parseSseLine(line: string): { text: string | null; blocked: string | null } {
  if (!line.startsWith("data:")) {
    return { text: null, blocked: null };
  }

  const payload = line.slice(5).trim();

  if (payload.length === 0 || payload === "[DONE]") {
    return { text: null, blocked: null };
  }

  let parsed: StreamChunk;
  try {
    parsed = JSON.parse(payload) as StreamChunk;
  } catch {
    // Unvollstaendige Zeile: der Aufrufer puffert weiter.
    return { text: null, blocked: null };
  }

  const blockReason = parsed.promptFeedback?.blockReason;
  if (blockReason) {
    return { text: null, blocked: blockReason };
  }

  const candidate = parsed.candidates?.[0];
  const finishReason = candidate?.finishReason;

  if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
    return { text: null, blocked: finishReason };
  }

  const text = (candidate?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("");

  return { text: text.length > 0 ? text : null, blocked: null };
}

/**
 * Streamt die Antwort des Modells.
 *
 * Liefert Textstuecke in der Reihenfolge, in der sie ankommen. Der Aufrufer
 * entscheidet, was er damit macht - der Route Handler reicht sie an den
 * Browser weiter.
 */
export async function* streamAnswer(
  systemPrompt: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (messages.length === 0) {
    throw new Error("Ohne Nachricht gibt es nichts zu beantworten.");
  }

  const model = readChatModel();

  const response = await geminiRequest(
    `${GEMINI_BASE}/models/${model}:streamGenerateContent?alt=sse`,
    buildPayload(systemPrompt, messages),
    { budgetMs: RETRY_BUDGET_MS, signal },
  );

  if (!response.body) {
    throw new Error("Der Anbieter lieferte keinen Datenstrom.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let hatText = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE trennt Ereignisse durch Zeilenumbrueche. Der Rest bleibt im
      // Puffer, bis die Zeile vollstaendig ist.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const { text, blocked } = parseSseLine(line.trim());

        if (blocked) {
          throw new Error(`Die Antwort wurde abgebrochen: ${blocked}`);
        }

        if (text) {
          hatText = true;
          yield text;
        }
      }
    }

    const { text } = parseSseLine(buffer.trim());
    if (text) {
      hatText = true;
      yield text;
    }
  } finally {
    // Bricht der Aufrufer ab, soll auch der Anbieter nicht weiterliefern.
    await reader.cancel().catch(() => {});
  }

  if (!hatText) {
    throw new Error("Der Anbieter lieferte eine leere Antwort.");
  }
}
