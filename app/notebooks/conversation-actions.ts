"use server";

import { revalidatePath } from "next/cache";

import { clearMessages } from "@/lib/messages";
import { getNotebook } from "@/lib/notebooks";

/**
 * Server Action zum Leeren eines Gespraechs.
 *
 * Bewusst getrennt vom Loeschen des Notebooks: wer neu anfangen will, soll
 * nicht seine Quellen mit wegwerfen muessen.
 */
export type ClearResult = {
  error: string | null;
};

export async function clearConversationAction(
  notebookId: string,
): Promise<ClearResult> {
  // Die id kommt aus dem Browser und ist ungeprueft.
  const notebook = await getNotebook(notebookId);

  if (!notebook) {
    return { error: "Dieses Notebook gibt es nicht." };
  }

  try {
    await clearMessages(notebook.id);
  } catch (error) {
    console.error("Gespraech leeren fehlgeschlagen:", error);
    return { error: "Das Gespraech konnte nicht geleert werden." };
  }

  revalidatePath(`/notebooks/${notebook.id}`);
  return { error: null };
}
