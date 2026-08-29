"use server";

import { revalidatePath } from "next/cache";

import { generateAudioOverview } from "@/lib/audio/generate";
import { createAudioUrl, getAudioOverview } from "@/lib/audio/store";
import { getNotebook } from "@/lib/notebooks";

/**
 * Server Actions fuer die gesprochene Zusammenfassung.
 */
export type AudioActionResult = {
  error: string | null;
};

export async function generateAudioAction(
  notebookId: string,
): Promise<AudioActionResult> {
  // Die id kommt aus dem Browser und ist ungeprueft.
  const notebook = await getNotebook(notebookId);

  if (!notebook) {
    return { error: "Dieses Notebook gibt es nicht." };
  }

  const ergebnis = await generateAudioOverview(notebook.id);

  revalidatePath(`/notebooks/${notebook.id}`);

  if (ergebnis.outcome === "error") {
    return { error: ergebnis.message };
  }

  if (ergebnis.outcome === "skipped") {
    return { error: ergebnis.reason };
  }

  return { error: null };
}

/**
 * Adresse zum Abspielen.
 *
 * Erst beim Bedarf geholt, wie beim Beleg-Dialog: signierte URLs sind
 * kurzlebig, und die meisten Seitenaufrufe spielen nichts ab.
 */
export async function getAudioUrlAction(
  notebookId: string,
): Promise<{ url: string | null; error: string | null }> {
  const notebook = await getNotebook(notebookId);

  if (!notebook) {
    return { url: null, error: "Dieses Notebook gibt es nicht." };
  }

  const eintrag = await getAudioOverview(notebook.id);

  if (!eintrag?.storage_path || eintrag.status !== "ready") {
    return { url: null, error: "Es gibt noch keine Aufnahme." };
  }

  const url = await createAudioUrl(eintrag.storage_path);

  return url
    ? { url, error: null }
    : { url: null, error: "Die Aufnahme konnte nicht geöffnet werden." };
}
