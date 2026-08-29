"use server";

import { revalidatePath } from "next/cache";

import { deleteNotebook } from "@/lib/notebooks";
import { deleteSource, getSource } from "@/lib/sources";

/**
 * Server Actions zum Loeschen.
 *
 * Loeschen ist nicht rueckgaengig zu machen. Die Rueckfrage steht im UI, hier
 * wird nur noch geprueft, ob es das Ziel ueberhaupt gibt.
 */
export type DeleteResult = {
  error: string | null;
};

export async function deleteSourceAction(
  sourceId: string,
): Promise<DeleteResult> {
  // Die id kommt aus dem Browser und ist ungeprueft. Das Notebook holen wir
  // aus der Quelle selbst, damit die richtige Seite aktualisiert wird.
  const source = await getSource(sourceId);

  if (!source) {
    return { error: "Diese Quelle gibt es nicht." };
  }

  try {
    await deleteSource(source.id);
  } catch (error) {
    console.error("Quelle löschen fehlgeschlagen:", error);
    return { error: "Die Quelle konnte nicht gelöscht werden." };
  }

  revalidatePath(`/notebooks/${source.notebook_id}`);
  return { error: null };
}

export async function deleteNotebookAction(
  notebookId: string,
): Promise<DeleteResult> {
  try {
    await deleteNotebook(notebookId);
  } catch (error) {
    console.error("Notebook löschen fehlgeschlagen:", error);
    return { error: "Das Notebook konnte nicht gelöscht werden." };
  }

  revalidatePath("/");
  return { error: null };
}
