import { SOURCE_TYPE_LABELS } from "@/lib/source-limits";

import type { RetrievedChunk } from "./retrieve";

/**
 * Systemprompt und Kontextaufbau fuer den quellengestuetzten Chat.
 *
 * Das ist die Stelle, an der das Produktversprechen steht oder faellt: eine
 * Antwort ohne Beleg ist in diesem Produkt kein Teilerfolg, sondern ein Fehler.
 */

/**
 * Mindestaehnlichkeit des BESTEN Treffers.
 *
 * Gemessen an den Testquellen:
 *   passende Fragen      Bestwert 0,63 bis 0,83
 *   unpassende Frage     Bestwert 0,50 ("Rezept fuer Kartoffelsalat")
 *
 * Geprueft wird bewusst nur der beste Treffer, nicht jeder einzelne: wenn
 * schon der beste Abschnitt kaum passt, enthaelt das Notebook zur Frage
 * nichts. Liegt er darueber, wandern auch die schwaecheren Treffer in den
 * Kontext - Zusammenhang hilft dem Modell, und die Anweisung verbietet ihm,
 * Unpassendes zu verwenden.
 *
 * Eine Heuristik auf schmaler Datenbasis. Wenn echte Fragen faelschlich
 * abgewiesen werden, gehoert dieser Wert nach unten.
 */
export const MIN_TOP_SIMILARITY = 0.55;

/**
 * Antwort, wenn das Notebook zur Frage nichts hergibt.
 *
 * Bewusst ohne LLM: kein Kontext, keine Antwort. Das Modell erst zu fragen
 * hiesse, es zum Erfinden einzuladen - und genau davor soll dieses Produkt
 * schuetzen.
 */
export const NO_CONTEXT_ANSWER =
  "Dazu finde ich nichts in deinen Quellen. Formulier die Frage anders " +
  "oder fueg eine passende Quelle hinzu.";

export const SYSTEM_PROMPT = `Du bist ein Rechercheassistent, der Fragen ausschliesslich anhand der unten stehenden Auszuege beantwortet.

Regeln:
1. Nutze ausschliesslich die Auszuege. Dein eigenes Vorwissen ist verboten, auch wenn du die Antwort zu kennen glaubst.
2. Belege jede inhaltliche Aussage mit der Nummer des Auszugs in eckigen Klammern, zum Beispiel [1] oder [2][3]. Setze den Beleg direkt hinter die Aussage.
3. Verwende nur Nummern, die es unten wirklich gibt. Erfinde keine Belege.
4. Beantworten die Auszuege die Frage nicht oder nur teilweise, sag das ausdruecklich. Eine unvollstaendige Antwort mit klarem Hinweis ist richtig; eine vollstaendig klingende Antwort ohne Deckung ist falsch.
5. Nicht jeder Auszug ist relevant. Ignoriere, was nicht zur Frage passt, statt es einzubauen.
6. Antworte auf Deutsch, sachlich und knapp.
7. Schreibe reinen Fliesstext ohne Markdown. Keine Sternchen, keine Rauten, keine Aufzaehlungszeichen. Brauchst du eine Aufzaehlung, nimm kurze Saetze in eigenen Zeilen.`;

/** Ueberschrift eines Auszugs, damit das Modell die Herkunft benennen kann. */
function describeChunk(chunk: RetrievedChunk, position: number): string {
  const type = SOURCE_TYPE_LABELS[chunk.sourceType];
  const page = chunk.page === null ? "" : `, Seite ${chunk.page}`;

  return `[${position}] ${chunk.sourceTitle} (${type}${page})`;
}

/**
 * Baut den Systemprompt samt nummerierten Auszuegen.
 *
 * Die Nummerierung ist die Bruecke zu den Zitaten: die Antwort verweist mit
 * [n], und der Aufrufer weiss aus derselben Reihenfolge, welcher Chunk das war.
 */
export function buildSystemPrompt(chunks: RetrievedChunk[]): string {
  const context = chunks
    .map(
      (chunk, index) =>
        `${describeChunk(chunk, index + 1)}\n${chunk.content.trim()}`,
    )
    .join("\n\n");

  return `${SYSTEM_PROMPT}\n\nAuszuege aus den Quellen:\n\n${context}`;
}

/**
 * Entscheidet, ob die Treffer als Grundlage taugen.
 * Leere Trefferliste oder ein zu schwacher Bestwert heisst: nicht antworten.
 */
export function hasUsableContext(chunks: RetrievedChunk[]): boolean {
  return chunks.length > 0 && chunks[0].similarity >= MIN_TOP_SIMILARITY;
}
