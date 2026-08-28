import type { ChatSource } from "@/app/api/chat/route";
import { createAdminClient } from "@/lib/supabase/server";

import type { Mindmap } from "./layout";

/**
 * Zugriff auf die Themenlandkarte eines Notebooks.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

export type MindmapStatus = "pending" | "processing" | "ready" | "error";

/**
 * Was in der Spalte data liegt.
 *
 * Der Baum und seine Belege zusammen: ein Knoten verweist mit [n] auf einen
 * Abschnitt, und ohne die dazugehoerige Liste waere die Nummer nach einem
 * Neuladen bedeutungslos.
 */
export type MindmapData = {
  map: Mindmap;
  sources: ChatSource[];
};

export type MindmapRow = {
  id: string;
  notebook_id: string;
  status: MindmapStatus;
  data: MindmapData | null;
  error_message: string | null;
  created_at: string;
};

const COLUMNS = "id, notebook_id, status, data, error_message, created_at";

/** Die Karte eines Notebooks, oder null. */
export async function getMindmap(
  notebookId: string,
): Promise<MindmapRow | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("mindmaps")
    .select(COLUMNS)
    .eq("notebook_id", notebookId)
    .maybeSingle();

  if (error) {
    throw new Error(`Karte konnte nicht geladen werden: ${error.message}`);
  }

  return data as MindmapRow | null;
}

/**
 * Beansprucht das Notebook fuer einen Lauf.
 *
 * Dieselbe Sperre wie bei der Audio-Zusammenfassung: der Statuswechsel
 * entscheidet, wer erzeugen darf. Zwei gleichzeitige Klicks kosten sonst
 * zweimal Kontingent, und das ist bei 20 Anfragen am Tag spuerbar.
 */
export async function claimMindmap(notebookId: string): Promise<boolean> {
  const supabase = createAdminClient();

  const { data: vorhanden, error: leseFehler } = await supabase
    .from("mindmaps")
    .select("id")
    .eq("notebook_id", notebookId)
    .maybeSingle();

  if (leseFehler) {
    throw new Error(`Karte konnte nicht geladen werden: ${leseFehler.message}`);
  }

  if (!vorhanden) {
    const { error } = await supabase
      .from("mindmaps")
      .insert({ notebook_id: notebookId, status: "processing" });

    // Verletzt ein zweiter Klick die unique-Bedingung, hat der erste gewonnen.
    return !error;
  }

  const { data, error } = await supabase
    .from("mindmaps")
    .update({ status: "processing", error_message: null })
    .eq("id", vorhanden.id)
    .in("status", ["pending", "ready", "error"])
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Karte konnte nicht belegt werden: ${error.message}`);
  }

  return data !== null;
}

/** Traegt die fertige Karte ein. */
export async function saveMindmap(
  notebookId: string,
  data: MindmapData,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("mindmaps")
    .update({ status: "ready", data, error_message: null })
    .eq("notebook_id", notebookId);

  if (error) {
    throw new Error(`Karte konnte nicht gespeichert werden: ${error.message}`);
  }
}

/** Haelt einen Fehlschlag fest. */
export async function failMindmap(
  notebookId: string,
  message: string,
): Promise<void> {
  const supabase = createAdminClient();

  // data bleibt stehen: eine aeltere Karte ist mehr wert als eine leere
  // Flaeche, und der Status sagt dem Nutzer, dass sie nicht mehr aktuell ist.
  const { error } = await supabase
    .from("mindmaps")
    .update({ status: "error", error_message: message })
    .eq("notebook_id", notebookId);

  if (error) {
    console.error(
      `Fehlerzustand fuer Notebook ${notebookId} nicht gespeichert:`,
      error.message,
    );
  }
}
