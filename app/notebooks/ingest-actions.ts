"use server";

import { revalidatePath } from "next/cache";

import { ingestSource } from "@/lib/ingestion/ingest";
import { getSource } from "@/lib/sources";

/**
 * Server Action zum Verarbeiten einer Quelle.
 *
 * Bewusst getrennt vom Hinzufuegen: so bleibt der Upload schnell, und der
 * Status wandert sichtbar von 'pending' ueber 'processing' nach 'ready'.
 */
export type IngestActionState = {
  error: string | null;
};

export async function ingestSourceAction(
  sourceId: string,
): Promise<IngestActionState> {
  // Die id kommt aus dem Browser und ist ungeprueft. Das zugehoerige Notebook
  // holen wir aus der Quelle selbst, statt es uebergeben zu lassen - sonst
  // koennten die beiden Angaben auseinanderfallen.
  const source = await getSource(sourceId);

  if (!source) {
    return { error: "Diese Quelle gibt es nicht." };
  }

  const result = await ingestSource(source.id);

  revalidatePath(`/notebooks/${source.notebook_id}`);

  if (result.outcome === "error") {
    return { error: result.message };
  }

  return { error: null };
}
