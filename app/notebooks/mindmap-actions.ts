"use server";

import { revalidatePath } from "next/cache";

import { buildMindmap } from "@/lib/mindmap/build";
import { getNotebook } from "@/lib/notebooks";

/**
 * Server Action fuer die Themenlandkarte.
 */
export type MindmapActionResult = {
  error: string | null;
};

export async function generateMindmapAction(
  notebookId: string,
): Promise<MindmapActionResult> {
  // Die id kommt aus dem Browser und ist ungeprueft.
  const notebook = await getNotebook(notebookId);

  if (!notebook) {
    return { error: "Dieses Notebook gibt es nicht." };
  }

  const ergebnis = await buildMindmap(notebook.id);

  revalidatePath(`/notebooks/${notebook.id}`);

  if (ergebnis.outcome === "error") {
    return { error: ergebnis.message };
  }

  if (ergebnis.outcome === "skipped") {
    return { error: ergebnis.reason };
  }

  return { error: null };
}
