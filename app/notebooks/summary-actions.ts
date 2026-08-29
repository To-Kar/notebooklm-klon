"use server";

import { revalidatePath } from "next/cache";

import { loadSourceChunks } from "@/lib/ingestion/ingest";
import { summarizeSource } from "@/lib/ingestion/summarize";
import { getSource, saveSourceSummary } from "@/lib/sources";

/**
 * Server Action zum Erneuern der Beschreibung einer Quelle.
 *
 * Beschreibung, Kernthemen und Einstiegsfragen entstehen sonst waehrend der
 * Ingestion. Quellen, die vor den Einstiegsfragen verarbeitet wurden, haben
 * deshalb keine - und ohne diesen Weg muesste man sie loeschen und neu
 * hochladen, was die Belege aller bisherigen Antworten ins Leere laufen
 * liesse.
 *
 * Bewusst von Hand angestossen, nicht automatisch: der Aufruf kostet vom
 * Tageskontingent, und das gibt der Nutzer aus, nicht die Anwendung.
 */
export type SummaryActionResult = {
  error: string | null;
};

export async function refreshSourceSummaryAction(
  sourceId: string,
): Promise<SummaryActionResult> {
  // Die id kommt aus dem Browser und ist ungeprueft.
  const source = await getSource(sourceId);

  if (!source) {
    return { error: "Diese Quelle gibt es nicht." };
  }

  if (source.status !== "ready") {
    return { error: "Die Quelle ist noch nicht verarbeitet." };
  }

  try {
    const chunks = await loadSourceChunks(source.id);

    if (chunks.length === 0) {
      return { error: "Zu dieser Quelle gibt es keine Abschnitte." };
    }

    const beschreibung = await summarizeSource(chunks);

    await saveSourceSummary(
      source.id,
      beschreibung.summary,
      beschreibung.topics,
      beschreibung.questions,
    );
  } catch (error) {
    console.error(`Beschreibung für Quelle ${sourceId} fehlgeschlagen:`, error);

    // Ein erschoepftes Kontingent traegt eine Meldung, die weiterhilft.
    const message =
      error instanceof Error && error.name === "RateLimitError"
        ? error.message
        : "Die Beschreibung konnte nicht erneuert werden.";

    return { error: message };
  }

  revalidatePath(`/notebooks/${source.notebook_id}`);

  return { error: null };
}
