"use server";

import { revalidatePath } from "next/cache";

import { getNotebook, renameNotebook } from "@/lib/notebooks";
import { getSource, renameSource } from "@/lib/sources";

/**
 * Server Actions fuers Umbenennen.
 */
export type RenameResult = {
  error: string | null;
};

export async function renameNotebookAction(
  notebookId: string,
  title: string,
): Promise<RenameResult> {
  // Die id kommt aus dem Browser und ist ungeprueft.
  const notebook = await getNotebook(notebookId);

  if (!notebook) {
    return { error: "Dieses Notebook gibt es nicht." };
  }

  try {
    await renameNotebook(notebook.id, title);
  } catch (error) {
    console.error("Notebook umbenennen fehlgeschlagen:", error);
    return { error: fehlermeldung(error, "Das Notebook") };
  }

  // Beide Seiten: die Uebersicht zeigt den Titel in der Liste, die
  // Detailseite in der Ueberschrift.
  revalidatePath("/");
  revalidatePath(`/notebooks/${notebook.id}`);

  return { error: null };
}

export async function renameSourceAction(
  sourceId: string,
  title: string,
): Promise<RenameResult> {
  const source = await getSource(sourceId);

  if (!source) {
    return { error: "Diese Quelle gibt es nicht." };
  }

  try {
    await renameSource(source.id, title);
  } catch (error) {
    console.error("Quelle umbenennen fehlgeschlagen:", error);
    return { error: fehlermeldung(error, "Die Quelle") };
  }

  revalidatePath(`/notebooks/${source.notebook_id}`);

  return { error: null };
}

/**
 * Reicht Regelverstoesse im Wortlaut durch, alles andere neutral.
 *
 * "Der Titel darf nicht leer sein" hilft dem Nutzer weiter; die Meldung einer
 * fehlgeschlagenen Datenbankabfrage nicht, und sie koennte Interna verraten.
 */
function fehlermeldung(error: unknown, was: string): string {
  if (error instanceof Error && error.message.startsWith("Der Titel")) {
    return error.message;
  }

  return `${was} konnte nicht umbenannt werden.`;
}
