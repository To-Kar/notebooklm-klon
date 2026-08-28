import { GEMINI_BASE, geminiRequest } from "@/lib/gemini";
import type { Source } from "@/lib/sources";

/**
 * Das Skript fuer die gesprochene Zusammenfassung.
 *
 * Ein kurzer Dialog zweier Sprecher - das ist die Form, die NotebookLM
 * bekannt gemacht hat, und sie traegt sich besser als ein Monolog.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

/** Die beiden Sprechernamen. Sie stehen so im Skript und in der Stimmzuordnung. */
export const SPEAKERS = ["Anna", "Ben"] as const;
export type Speaker = (typeof SPEAKERS)[number];

/**
 * Zeichenobergrenze fuer das Skript.
 *
 * Gemessen: 387 Zeichen ergaben 20,5 Sekunden Audio, also rund 19 Zeichen je
 * Sekunde. 650 Zeichen sind damit etwa 34 Sekunden - genug fuer einen
 * Ueberblick und sicher innerhalb der Laufzeit einer Serverless-Function.
 */
export const MAX_SCRIPT_CHARS = 650;

/** Was an Quellenmaterial ins Modell geht. */
const MAX_INPUT_CHARS = 6_000;

const RETRY_BUDGET_MS = 8_000;

export type ScriptLine = {
  speaker: Speaker;
  text: string;
};

const PROMPT = `Du schreibst ein kurzes Hoerstueck, in dem zwei Menschen ueber Dokumente sprechen.

Regeln:
1. Genau zwei Sprecher: Anna stellt vor und ordnet ein, Ben fragt nach.
2. Insgesamt hoechstens 650 Zeichen. Das ist wenig - komm sofort zur Sache, ohne Begruessung und ohne Abschiedsformel.
3. Nutze ausschliesslich die vorliegenden Beschreibungen. Erfinde nichts, ergaenze kein Vorwissen, nenne keine Zahlen, die nicht dastehen.
4. Sprich frei und gesprochen, nicht vorgelesen. Kurze Saetze.
5. Keine Regieanweisungen, keine Klammern, keine Emojis, keine Ueberschriften.
6. Auf Deutsch.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          speaker: { type: "STRING", enum: ["Anna", "Ben"] },
          text: { type: "STRING" },
        },
        required: ["speaker", "text"],
      },
    },
  },
  required: ["lines"],
} as const;

function readChatModel(): string {
  const model = process.env.LLM_MODEL;
  if (!model) throw new Error("Fehlende Env-Variable: LLM_MODEL");
  return model;
}

/**
 * Was das Modell ueber die Quellen erfaehrt.
 *
 * Bevorzugt die Kurzfassungen: die sind schon verdichtet, gepruefte
 * Modellausgabe und viel kuerzer als der Rohtext. Fehlt eine, wird die Quelle
 * wenigstens mit Titel und Typ genannt.
 */
export function buildSourceBrief(sources: Source[]): string {
  return sources
    .map((source) => {
      const themen =
        source.topics.length > 0 ? `\nThemen: ${source.topics.join(", ")}` : "";
      const text = source.summary ?? "(keine Beschreibung vorhanden)";

      return `Quelle: ${source.title} (${source.type})\n${text}${themen}`;
    })
    .join("\n\n")
    .slice(0, MAX_INPUT_CHARS);
}

/**
 * Kuerzt das Skript auf die Zeichengrenze, ohne einen Satz zu zerreissen -
 * und ohne mitten im Gespraech aufzuhoeren.
 *
 * Der zweite Teil ist der wichtigere. Beim ersten echten Durchlauf endete die
 * Aufnahme auf "Ben: Gibt es da auch Details zur Umsetzung?" - einer Frage,
 * die niemand beantwortet. Angehoert klingt das nach Abbruch, nicht nach
 * Ende. Ben fragt, Anna erklaert; also endet das Skript bei Anna.
 */
export function trimScript(
  lines: ScriptLine[],
  maxChars: number = MAX_SCRIPT_CHARS,
): ScriptLine[] {
  const behalten: ScriptLine[] = [];
  let verbraucht = 0;

  for (const line of lines) {
    const laenge = line.text.length;
    if (verbraucht + laenge > maxChars) break;

    behalten.push(line);
    verbraucht += laenge;
  }


  // Offene Frage am Ende wegnehmen.
  while (behalten.length > 1 && behalten[behalten.length - 1].speaker === "Ben") {
    behalten.pop();
  }

  // Lieber die erste Zeile allein als gar nichts.
  return behalten.length > 0 ? behalten : lines.slice(0, 1);
}

/** Die Form, in der das Skript an die Sprachausgabe geht. */
export function formatScript(lines: ScriptLine[]): string {
  return lines.map((line) => `${line.speaker}: ${line.text}`).join("\n");
}

type GenerateResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

/** Erzeugt den Dialog aus den Beschreibungen der Quellen. */
export async function generateScript(
  sources: Source[],
): Promise<ScriptLine[]> {
  if (sources.length === 0) {
    throw new Error("Ohne Quellen gibt es nichts zu besprechen.");
  }

  const model = readChatModel();

  const response = await geminiRequest(
    `${GEMINI_BASE}/models/${model}:generateContent`,
    {
      systemInstruction: { parts: [{ text: PROMPT }] },
      contents: [{ role: "user", parts: [{ text: buildSourceBrief(sources) }] }],
      generationConfig: {
        temperature: 0.4,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 600,
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
    throw new Error("Der Anbieter lieferte kein Skript.");
  }

  const geparst = JSON.parse(roh) as { lines?: Partial<ScriptLine>[] };

  const lines = (geparst.lines ?? [])
    .filter(
      (line): line is ScriptLine =>
        typeof line.text === "string" &&
        line.text.trim().length > 0 &&
        (line.speaker === "Anna" || line.speaker === "Ben"),
    )
    .map((line) => ({ speaker: line.speaker, text: line.text.trim() }));

  if (lines.length === 0) {
    throw new Error("Das Skript kam ohne verwertbare Zeilen zurueck.");
  }

  return trimScript(lines);
}
