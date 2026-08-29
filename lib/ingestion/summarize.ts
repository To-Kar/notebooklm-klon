import { GEMINI_BASE, geminiRequest } from "@/lib/gemini";

import type { SourceChunk } from "./chunk";

/**
 * Kurzfassung und Kernthemen einer Quelle.
 *
 * Laeuft einmal am Ende der Ingestion, nicht bei jeder Frage. Quellen kommen
 * selten hinzu, Fragen oft - und das Tageskontingent des Anbieters ist knapp.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

/**
 * Zeichenbudget fuer den Text, der ins Modell geht.
 *
 * Eine Quelle darf 200 Chunks haben, also rund 200.000 Zeichen - zu viel fuer
 * einen Aufruf und unnoetig teuer. 15.000 Zeichen reichen, um zu erfassen,
 * worum es geht.
 */
const MAX_INPUT_CHARS = 15_000;

/** Knapp halten: die Kurzfassung steht in einer schmalen Seitenleiste. */
const MAX_OUTPUT_TOKENS = 600;

/** Wie viele Einstiegsfragen eine Quelle hoechstens beisteuert. */
export const MAX_QUESTIONS_PER_SOURCE = 3;

/** Laenge einer Einstiegsfrage. Was nicht in eine Zeile passt, lockt niemanden. */
const MAX_QUESTION_LENGTH = 120;

/** Wartebudget bei Rate-Limit. Kurz, weil ein Beiwerk niemanden aufhalten darf. */
const RETRY_BUDGET_MS = 8_000;

export type SourceSummary = {
  summary: string;
  topics: string[];
  /**
   * Fragen, die sich aus dieser Quelle beantworten lassen.
   *
   * Kommen aus demselben Aufruf wie die Kurzfassung. Eine eigene Erzeugung
   * waere bei 20 Anfragen am Tag nicht zu rechtfertigen - und der Aufruf,
   * der die Quelle ohnehin gelesen hat, weiss am besten, was in ihr steht.
   */
  questions: string[];
};

const PROMPT = `Du beschreibst, was in einem Dokument steht.

Regeln:
1. Zwei bis drei Saetze, die sagen, worum es geht und was jemand darin findet.
2. Nutze ausschliesslich den vorliegenden Text. Erfinde nichts und ergaenze kein Vorwissen.
3. Dazu drei bis sechs Kernthemen, jeweils ein bis drei Woerter.
4. Schreibe auf Deutsch, sachlich, ohne Werbesprache und ohne Einleitungsfloskeln.
5. Der Text kann Ausschnitte aus verschiedenen Stellen enthalten. Beschreibe das Ganze, nicht nur den Anfang.
6. Dazu drei Fragen, die jemand an dieses Dokument stellen wuerde und die sich aus dem vorliegenden Text auch wirklich beantworten lassen.
7. Die Fragen sind vollstaendige Saetze mit Fragezeichen, hoechstens zwoelf Woerter, und stehen fuer sich - ohne "hier", "dieses Dokument" oder andere Rueckbezuege.
8. Frag nach dem Inhalt, nicht ueber das Dokument. Also nicht "Worum geht es in dem Text?", sondern nach der Sache selbst.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    topics: { type: "ARRAY", items: { type: "STRING" } },
    questions: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["summary", "topics", "questions"],
} as const;

/**
 * Waehlt Abschnitte gleichmaessig ueber das Dokument verteilt aus.
 *
 * Einfach die ersten zu nehmen waere bequemer, wuerde bei einem langen
 * Dokument aber nur das Vorwort beschreiben. Die gleichmaessige Verteilung
 * erfasst Anfang, Mitte und Ende.
 */
export function sampleChunks(
  chunks: SourceChunk[],
  maxChars: number = MAX_INPUT_CHARS,
): string[] {
  if (chunks.length === 0) return [];

  const gesamt = chunks.reduce((summe, c) => summe + c.content.length, 0);
  if (gesamt <= maxChars) {
    return chunks.map((c) => c.content);
  }

  // Wie viele Abschnitte passen im Schnitt ins Budget?
  const durchschnitt = gesamt / chunks.length;
  const anzahl = Math.max(1, Math.floor(maxChars / durchschnitt));
  const schritt = chunks.length / anzahl;

  const auswahl: string[] = [];
  let verbraucht = 0;

  for (let i = 0; i < anzahl; i++) {
    const chunk = chunks[Math.min(chunks.length - 1, Math.floor(i * schritt))];
    if (verbraucht + chunk.content.length > maxChars) break;

    auswahl.push(chunk.content);
    verbraucht += chunk.content.length;
  }

  return auswahl;
}

type GenerateResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

function readChatModel(): string {
  const model = process.env.LLM_MODEL;
  if (!model) throw new Error("Fehlende Env-Variable: LLM_MODEL");
  return model;
}

/**
 * Beschreibt eine Quelle anhand ihrer Abschnitte.
 *
 * Wirft bei Problemen - der Aufrufer entscheidet, ob das den Lauf scheitern
 * laesst. Bei der Ingestion tut es das bewusst nicht.
 */
export async function summarizeSource(
  chunks: SourceChunk[],
): Promise<SourceSummary> {
  const ausschnitte = sampleChunks(chunks);

  if (ausschnitte.length === 0) {
    throw new Error("Ohne Abschnitte laesst sich nichts beschreiben.");
  }

  const model = readChatModel();

  const response = await geminiRequest(
    `${GEMINI_BASE}/models/${model}:generateContent`,
    {
      systemInstruction: { parts: [{ text: PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [{ text: ausschnitte.join("\n\n---\n\n") }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
      },
    },
    { budgetMs: RETRY_BUDGET_MS },
  );

  const json = (await response.json()) as GenerateResponse;
  const roh = (json.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (roh.length === 0) {
    throw new Error("Der Anbieter lieferte keine Beschreibung.");
  }

  const geparst = JSON.parse(roh) as Partial<SourceSummary>;

  if (typeof geparst.summary !== "string" || geparst.summary.trim().length === 0) {
    throw new Error("Die Beschreibung kam ohne Text zurueck.");
  }

  return {
    summary: geparst.summary.trim(),
    topics: (geparst.topics ?? [])
      .filter((thema): thema is string => typeof thema === "string")
      .map((thema) => thema.trim())
      .filter((thema) => thema.length > 0)
      .slice(0, 6),
    questions: cleanQuestions(geparst.questions),
  };
}

/**
 * Sortiert aus, was als Einstiegsfrage nicht taugt.
 *
 * Reine Funktion, exportiert und getestet: der Prompt bittet um Fragesaetze,
 * aber eine Bitte ist keine Garantie. Eine Aufforderung ohne Fragezeichen
 * oder eine halbe Zeile Fliesstext im Fragenknopf faellt sofort auf.
 */
export function cleanQuestions(roh: unknown): string[] {
  if (!Array.isArray(roh)) return [];

  const gesehen = new Set<string>();
  const fragen: string[] = [];

  for (const eintrag of roh) {
    if (typeof eintrag !== "string") continue;

    const frage = eintrag.replace(/\s+/g, " ").trim();

    if (!frage.endsWith("?")) continue;
    if (frage.length > MAX_QUESTION_LENGTH) continue;

    // Gross- und Kleinschreibung ignorieren: zwei Quellen zum selben Thema
    // liefern gern dieselbe Frage in leicht anderer Schreibung.
    const schluessel = frage.toLowerCase();
    if (gesehen.has(schluessel)) continue;

    gesehen.add(schluessel);
    fragen.push(frage);

    if (fragen.length === MAX_QUESTIONS_PER_SOURCE) break;
  }

  return fragen;
}
