import type { ChatSource } from "@/app/api/chat/route";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Notizen eines Notebooks.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

/** Woher die Notiz stammt. Siehe Constraint in 0008_notes.sql. */
export type NoteOrigin = "manual" | "answer";

export type Note = {
  id: string;
  origin: NoteOrigin;
  content: string;
  /** Nur an gesicherten Antworten, sonst leer. */
  citations: ChatSource[];
  created_at: string;
};

const NOTE_COLUMNS = "id, origin, content, citations, created_at";

/** Obergrenze fuer eine selbst geschriebene Notiz. */
export const NOTE_MAX_LENGTH = 5_000;

/** Alle Notizen eines Notebooks, neueste zuerst. */
export async function listNotes(notebookId: string): Promise<Note[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .eq("notebook_id", notebookId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Notizen konnten nicht geladen werden: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Legt eine Notiz an.
 *
 * Belege werden nur bei einer gesicherten Antwort uebernommen - das Constraint
 * in der Datenbank verlangt es, und der Aufrufer soll sich nicht darauf
 * verlassen muessen, daran zu denken.
 */
export async function createNote(
  notebookId: string,
  origin: NoteOrigin,
  content: string,
  citations: ChatSource[] = [],
): Promise<void> {
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    throw new Error("Eine leere Notiz ergibt keinen Sinn.");
  }

  const supabase = createAdminClient();

  const { error } = await supabase.from("notes").insert({
    notebook_id: notebookId,
    origin,
    content: trimmed.slice(0, NOTE_MAX_LENGTH),
    citations: origin === "answer" ? citations : [],
  });

  if (error) {
    throw new Error(`Notiz konnte nicht gespeichert werden: ${error.message}`);
  }
}

/** Loescht eine Notiz. Gibt das zugehoerige Notebook zurueck, sonst null. */
export async function deleteNote(id: string): Promise<string | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("notes")
    .delete()
    .eq("id", id)
    .select("notebook_id")
    .maybeSingle();

  if (error) {
    throw new Error(`Notiz konnte nicht gelöscht werden: ${error.message}`);
  }

  return (data as { notebook_id: string } | null)?.notebook_id ?? null;
}
