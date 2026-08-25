import { createAdminClient } from "@/lib/supabase/server";

/**
 * Datenzugriff fuer Notebooks.
 *
 * WICHTIG: Nur aus Server-Code importieren (Server Components, Server Actions).
 * Das Modul haengt an lib/supabase/server.ts und damit am Secret-Key.
 */

/** Ein Notebook: der Arbeitsbereich, der spaeter Quellen und Chat gruppiert. */
export type Notebook = {
  id: string;
  title: string;
  created_at: string;
};

/** Spaltenliste fuer alle Notebook-Queries, damit die Auswahl zum Typ passt. */
const NOTEBOOK_COLUMNS = "id, title, created_at";

/** Alle Notebooks, neueste zuerst. */
export async function listNotebooks(): Promise<Notebook[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("notebooks")
    .select(NOTEBOOK_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Notebooks konnten nicht geladen werden: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Ein einzelnes Notebook.
 * Gibt null zurueck, wenn es die id nicht gibt. Echte DB-Fehler werfen.
 */
export async function getNotebook(id: string): Promise<Notebook | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("notebooks")
    .select(NOTEBOOK_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Notebook konnte nicht geladen werden: ${error.message}`);
  }

  return data;
}

/**
 * Legt ein Notebook an. Der Titel wird getrimmt und darf nicht leer sein.
 * Wirft bei ungueltiger Eingabe oder DB-Fehler.
 */
export async function createNotebook(title: string): Promise<Notebook> {
  const trimmedTitle = title.trim();

  if (trimmedTitle.length === 0) {
    throw new Error("Der Titel darf nicht leer sein.");
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("notebooks")
    .insert({ title: trimmedTitle })
    .select(NOTEBOOK_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Notebook konnte nicht angelegt werden: ${error.message}`);
  }

  return data;
}
