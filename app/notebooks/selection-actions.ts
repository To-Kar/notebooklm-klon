"use server";

import { revalidatePath } from "next/cache";

import { getNotebook } from "@/lib/notebooks";
import {
  getSource,
  setAllSourcesSelected,
  setSourceSelected,
} from "@/lib/sources";

/**
 * Server Actions fuer die Quellenauswahl.
 *
 * Die Auswahl liegt in der Datenbank, nicht im Browser: sie gehoert zum
 * Notebook, nicht zur Sitzung, und der Chat-Endpunkt liest sie serverseitig.
 */
export type SelectionResult = {
  error: string | null;
};

export async function toggleSourceAction(
  sourceId: string,
  selected: boolean,
): Promise<SelectionResult> {
  // Die id kommt aus dem Browser und ist ungeprueft.
  const source = await getSource(sourceId);

  if (!source) {
    return { error: "Diese Quelle gibt es nicht." };
  }

  try {
    await setSourceSelected(source.id, selected);
  } catch (error) {
    console.error("Auswahl umschalten fehlgeschlagen:", error);
    return { error: "Die Auswahl konnte nicht gespeichert werden." };
  }

  revalidatePath(`/notebooks/${source.notebook_id}`);
  return { error: null };
}

export async function selectAllSourcesAction(
  notebookId: string,
  selected: boolean,
): Promise<SelectionResult> {
  const notebook = await getNotebook(notebookId);

  if (!notebook) {
    return { error: "Dieses Notebook gibt es nicht." };
  }

  try {
    await setAllSourcesSelected(notebook.id, selected);
  } catch (error) {
    console.error("Auswahl umschalten fehlgeschlagen:", error);
    return { error: "Die Auswahl konnte nicht gespeichert werden." };
  }

  revalidatePath(`/notebooks/${notebook.id}`);
  return { error: null };
}
