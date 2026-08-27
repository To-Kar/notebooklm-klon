import { NOTEBOOK_TITLE_MAX_LENGTH } from "@/lib/notebook-limits";
import { listSourceFilePaths, removeSourceFiles } from "@/lib/sources";
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

/**
 * Anzeigeformat fuer created_at.
 * Feste Zeitzone, damit das Datum nicht von der Server-Zeitzone abhaengt
 * (Vercel-Functions laufen in UTC).
 */
const notebookDateFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeZone: "Europe/Berlin",
});

export function formatNotebookDate(createdAt: string): string {
  return notebookDateFormatter.format(new Date(createdAt));
}

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
 * Postgres bricht ab, wenn ein Wert kein gueltiges UUID ist. Eine id aus der
 * URL kann alles sein, deshalb pruefen wir die Form, bevor wir fragen.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ein einzelnes Notebook.
 * Gibt null zurueck, wenn die id unbekannt oder kein UUID ist.
 * Echte DB-Fehler werfen.
 */
export async function getNotebook(id: string): Promise<Notebook | null> {
  if (!UUID_PATTERN.test(id)) {
    return null;
  }

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
 * Loescht ein Notebook mit allem, was daran haengt.
 *
 * Sources und Chunks raeumen die Foreign Keys ab. Die hochgeladenen Dateien
 * nicht - die muessen vor dem Loeschen der Zeilen eingesammelt werden, danach
 * waere nicht mehr auffindbar, welche zu diesem Notebook gehoerten.
 */
export async function deleteNotebook(id: string): Promise<void> {
  if (!UUID_PATTERN.test(id)) {
    return;
  }

  const paths = await listSourceFilePaths(id);
  await removeSourceFiles(paths);

  const supabase = createAdminClient();
  const { error } = await supabase.from("notebooks").delete().eq("id", id);

  if (error) {
    throw new Error(`Notebook konnte nicht geloescht werden: ${error.message}`);
  }
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

  if (trimmedTitle.length > NOTEBOOK_TITLE_MAX_LENGTH) {
    throw new Error(
      `Der Titel darf hoechstens ${NOTEBOOK_TITLE_MAX_LENGTH} Zeichen lang sein.`,
    );
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
