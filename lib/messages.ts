import type { ChatSource } from "@/app/api/chat/route";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Der gespeicherte Chatverlauf eines Notebooks.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

export type MessageRole = "user" | "assistant";

export type StoredMessage = {
  id: string;
  role: MessageRole;
  content: string;
  /** Nur an Antworten, siehe Constraint in 0005_messages.sql. */
  citations: ChatSource[];
  created_at: string;
};

const MESSAGE_COLUMNS = "id, role, content, citations, created_at";

/**
 * Wie viele Nachrichten aus dem Verlauf an das Modell gehen.
 *
 * Ein Gespraech kann beliebig lang werden, der Kontext des Modells nicht.
 * Aeltere Nachrichten fallen weg, die Belege bleiben in der Datenbank.
 */
export const HISTORY_LIMIT = 20;

/** Der Verlauf eines Notebooks, aelteste zuerst. */
export async function listMessages(
  notebookId: string,
): Promise<StoredMessage[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("notebook_id", notebookId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Verlauf konnte nicht geladen werden: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Die juengsten Nachrichten, in zeitlicher Reihenfolge.
 *
 * Zum Abschneiden wird absteigend sortiert und danach gedreht - andersherum
 * bekaeme man die aeltesten statt der juengsten.
 */
export async function listRecentMessages(
  notebookId: string,
  limit: number = HISTORY_LIMIT,
): Promise<StoredMessage[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("notebook_id", notebookId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Verlauf konnte nicht geladen werden: ${error.message}`);
  }

  return (data ?? []).reverse();
}

/** Haengt eine Nachricht an den Verlauf an. */
export async function appendMessage(
  notebookId: string,
  role: MessageRole,
  content: string,
  citations: ChatSource[] = [],
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.from("messages").insert({
    notebook_id: notebookId,
    role,
    content,
    // Das Constraint erlaubt Belege nur an Antworten.
    citations: role === "assistant" ? citations : [],
  });

  if (error) {
    throw new Error(`Nachricht konnte nicht gespeichert werden: ${error.message}`);
  }
}

/** Loescht den gesamten Verlauf eines Notebooks. */
export async function clearMessages(notebookId: string): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("notebook_id", notebookId);

  if (error) {
    throw new Error(`Verlauf konnte nicht geloescht werden: ${error.message}`);
  }
}
