"use server";

import { revalidatePath } from "next/cache";

import type { ChatSource } from "@/app/api/chat/route";
import { createNote, deleteNote } from "@/lib/notes";
import { getNotebook } from "@/lib/notebooks";

/**
 * Server Actions fuer Notizen.
 *
 * Kein LLM im Spiel: Notizen funktionieren auch dann, wenn das Tageskontingent
 * des Anbieters erschoepft ist.
 */
export type NoteResult = {
  error: string | null;
};

export async function saveAnswerAsNoteAction(
  notebookId: string,
  content: string,
  citations: ChatSource[],
): Promise<NoteResult> {
  // Beides kommt aus dem Browser und ist ungeprueft.
  const notebook = await getNotebook(notebookId);

  if (!notebook) {
    return { error: "Dieses Notebook gibt es nicht." };
  }

  if (content.trim().length === 0) {
    return { error: "Diese Antwort ist leer." };
  }

  try {
    await createNote(notebook.id, "answer", content, citations);
  } catch (error) {
    console.error("Antwort als Notiz speichern fehlgeschlagen:", error);
    return { error: "Die Notiz konnte nicht gespeichert werden." };
  }

  revalidatePath(`/notebooks/${notebook.id}`);
  return { error: null };
}

export async function createNoteAction(
  notebookId: string,
  content: string,
): Promise<NoteResult> {
  const notebook = await getNotebook(notebookId);

  if (!notebook) {
    return { error: "Dieses Notebook gibt es nicht." };
  }

  if (content.trim().length === 0) {
    return { error: "Schreib zuerst etwas in die Notiz." };
  }

  try {
    await createNote(notebook.id, "manual", content);
  } catch (error) {
    console.error("Notiz anlegen fehlgeschlagen:", error);
    return { error: "Die Notiz konnte nicht gespeichert werden." };
  }

  revalidatePath(`/notebooks/${notebook.id}`);
  return { error: null };
}

export async function deleteNoteAction(noteId: string): Promise<NoteResult> {
  try {
    const notebookId = await deleteNote(noteId);

    if (notebookId) {
      revalidatePath(`/notebooks/${notebookId}`);
    }
  } catch (error) {
    console.error("Notiz loeschen fehlgeschlagen:", error);
    return { error: "Die Notiz konnte nicht geloescht werden." };
  }

  return { error: null };
}
