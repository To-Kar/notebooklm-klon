import {
  SOURCE_BUCKET,
  SOURCE_FILE_MAX_BYTES,
  SOURCE_FILE_TYPES,
  SOURCE_TITLE_MAX_LENGTH,
  type SourceStatus,
  type SourceType,
  isAllowedSourceMimeType,
} from "@/lib/source-limits";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Datenzugriff fuer Quellen.
 *
 * WICHTIG: Nur aus Server-Code importieren (Server Components, Server Actions).
 * Das Modul haengt an lib/supabase/server.ts und damit am Secret-Key.
 */

export type { SourceStatus, SourceType };

export type Source = {
  id: string;
  notebook_id: string;
  title: string;
  type: SourceType;
  status: SourceStatus;
  storage_path: string | null;
  url: string | null;
  /** Grund des letzten Fehlversuchs, nur bei status === 'error' gesetzt. */
  error_message: string | null;
  /** Wird diese Quelle bei Fragen beruecksichtigt? */
  selected: boolean;
  /** Kurzfassung aus der Ingestion, null solange keine erzeugt wurde. */
  summary: string | null;
  /** Kernthemen, leer solange keine Kurzfassung vorliegt. */
  topics: string[];
  created_at: string;
};

/**
 * Die Spaltenliste aller Quellen-Queries.
 *
 * Exportiert, damit sie an genau einer Stelle steht: eine zweite Kopie
 * wuerde beim naechsten Spaltenzuwachs stehenbleiben, und die Luecke faele
 * erst auf, wenn irgendwo ein Feld fehlt.
 */
export const SOURCE_COLUMNS =
  "id, notebook_id, title, type, status, storage_path, url, error_message, selected, summary, topics, created_at";

/**
 * Die Anzeigetexte liegen in lib/source-limits.ts, weil auch
 * Client-Komponenten sie brauchen und dieses Modul den Server-Client
 * mitbringt.
 */

/** Dateiendung aus dem Mime-Type, nicht aus dem Dateinamen des Nutzers. */
const EXTENSION_BY_MIME_TYPE = {
  "application/pdf": "pdf",
  "text/plain": "txt",
} as const;

/** Alle Quellen eines Notebooks, neueste zuerst. */
export async function listSources(notebookId: string): Promise<Source[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("sources")
    .select(SOURCE_COLUMNS)
    .eq("notebook_id", notebookId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Quellen konnten nicht geladen werden: ${error.message}`);
  }

  return data ?? [];
}

/** Eine einzelne Quelle. Gibt null zurueck, wenn die id unbekannt ist. */
export async function getSource(id: string): Promise<Source | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("sources")
    .select(SOURCE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Quelle konnte nicht geladen werden: ${error.message}`);
  }

  return data;
}

/**
 * Entfernt Dateien aus dem Bucket.
 *
 * Foreign Keys raeumen beim Loeschen einer Quelle die Chunks ab, aber der
 * Storage kennt kein Kaskadieren - die Datei bliebe unsichtbar liegen. Diese
 * Funktion ist die einzige Stelle, an der Objekte entfernt werden.
 */
export async function removeSourceFiles(paths: string[]): Promise<void> {
  const vorhandene = paths.filter((path) => path.length > 0);

  if (vorhandene.length === 0) {
    return;
  }

  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from(SOURCE_BUCKET)
    .remove(vorhandene);

  if (error) {
    throw new Error(`Dateien konnten nicht entfernt werden: ${error.message}`);
  }
}

/**
 * Loescht eine Quelle samt Datei und Chunks.
 *
 * Reihenfolge mit Absicht: erst die Datei, dann die Zeile. Schlaegt das
 * Loeschen der Zeile danach fehl, bleibt eine sichtbare Quelle ohne Datei
 * zurueck - ein Zustand, den der Nutzer sieht und durch erneutes Loeschen
 * beheben kann. Andersherum bliebe eine verwaiste Datei im Bucket, die
 * niemand mehr findet.
 */
export async function deleteSource(id: string): Promise<void> {
  const source = await getSource(id);

  if (!source) {
    return;
  }

  if (source.storage_path) {
    await removeSourceFiles([source.storage_path]);
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("sources").delete().eq("id", id);

  if (error) {
    throw new Error(`Quelle konnte nicht geloescht werden: ${error.message}`);
  }
}

/** Die Storage-Pfade aller Dateien eines Notebooks. */
export async function listSourceFilePaths(
  notebookId: string,
): Promise<string[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("sources")
    .select("storage_path")
    .eq("notebook_id", notebookId)
    .not("storage_path", "is", null);

  if (error) {
    throw new Error(`Dateipfade konnten nicht geladen werden: ${error.message}`);
  }

  return ((data ?? []) as { storage_path: string | null }[])
    .map((row) => row.storage_path)
    .filter((path): path is string => path !== null);
}

/**
 * Speichert Kurzfassung und Kernthemen.
 *
 * Getrennt vom Status: die Beschreibung entsteht nach der eigentlichen
 * Verarbeitung und darf deren Ergebnis nicht mehr anfassen.
 */
export async function saveSourceSummary(
  id: string,
  summary: string,
  topics: string[],
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("sources")
    .update({ summary, topics })
    .eq("id", id);

  if (error) {
    throw new Error(
      `Beschreibung konnte nicht gespeichert werden: ${error.message}`,
    );
  }
}

/** Waehlt eine Quelle an oder ab. */
export async function setSourceSelected(
  id: string,
  selected: boolean,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("sources")
    .update({ selected })
    .eq("id", id);

  if (error) {
    throw new Error(`Auswahl konnte nicht gespeichert werden: ${error.message}`);
  }
}

/** Setzt die Auswahl fuer alle Quellen eines Notebooks auf denselben Wert. */
export async function setAllSourcesSelected(
  notebookId: string,
  selected: boolean,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("sources")
    .update({ selected })
    .eq("notebook_id", notebookId);

  if (error) {
    throw new Error(`Auswahl konnte nicht gespeichert werden: ${error.message}`);
  }
}

/**
 * Die ids der Quellen, die bei einer Frage beruecksichtigt werden.
 *
 * Nur fertig verarbeitete Quellen zaehlen: eine ausgewaehlte Quelle ohne
 * Chunks traegt nichts bei, wuerde die Liste aber unnoetig aufblaehen.
 */
export async function listSelectedSourceIds(
  notebookId: string,
): Promise<string[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("sources")
    .select("id")
    .eq("notebook_id", notebookId)
    .eq("selected", true)
    .eq("status", "ready");

  if (error) {
    throw new Error(`Auswahl konnte nicht geladen werden: ${error.message}`);
  }

  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

/** Schneidet einen Titel auf die erlaubte Laenge und entfernt Leerraum. */
function normalizeTitle(title: string): string {
  return title.trim().slice(0, SOURCE_TITLE_MAX_LENGTH);
}

/**
 * Prueft eine vom Nutzer eingegebene URL.
 * Erlaubt nur http und https - javascript:, data: und file: waeren sonst
 * eine offene Tuer, sobald wir die URL spaeter abrufen oder verlinken.
 * Gibt null zurueck, wenn die Eingabe keine brauchbare URL ist.
 */
export function parseSourceUrl(input: string): URL | null {
  let parsed: URL;

  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  return parsed;
}

/**
 * Legt eine Web-Quelle an. Der Inhalt wird hier noch nicht abgerufen,
 * das passiert in der Ingestion. Die Quelle startet deshalb auf 'pending'.
 */
export async function createUrlSource(
  notebookId: string,
  url: URL,
  title?: string,
): Promise<Source> {
  const supabase = createAdminClient();

  const fallbackTitle = `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  const finalTitle = normalizeTitle(title ?? "") || normalizeTitle(fallbackTitle);

  const { data, error } = await supabase
    .from("sources")
    .insert({
      notebook_id: notebookId,
      title: finalTitle,
      type: "url",
      url: url.toString(),
      status: "pending",
    })
    .select(SOURCE_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Quelle konnte nicht angelegt werden: ${error.message}`);
  }

  return data;
}

/**
 * Laedt eine Datei in den privaten Bucket und legt die zugehoerige Quelle an.
 *
 * Reihenfolge mit Absicht: erst hochladen, dann die Zeile schreiben. Schlaegt
 * das Insert fehl, wird die Datei wieder entfernt, damit keine verwaisten
 * Objekte im Bucket zurueckbleiben.
 */
export async function createFileSource(
  notebookId: string,
  file: File,
): Promise<Source> {
  if (file.size === 0) {
    throw new Error("Die Datei ist leer.");
  }

  if (file.size > SOURCE_FILE_MAX_BYTES) {
    throw new Error("Die Datei ist zu gross.");
  }

  if (!isAllowedSourceMimeType(file.type)) {
    throw new Error(`Dateityp nicht unterstuetzt: ${file.type || "unbekannt"}`);
  }

  const sourceType = SOURCE_FILE_TYPES[file.type];
  const extension = EXTENSION_BY_MIME_TYPE[file.type];
  const storagePath = `${notebookId}/${crypto.randomUUID()}.${extension}`;

  const supabase = createAdminClient();

  const { error: uploadError } = await supabase.storage
    .from(SOURCE_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    throw new Error(
      `Datei konnte nicht hochgeladen werden: ${uploadError.message}`,
    );
  }

  const { data, error } = await supabase
    .from("sources")
    .insert({
      notebook_id: notebookId,
      title: normalizeTitle(file.name) || "Unbenannte Datei",
      type: sourceType,
      storage_path: storagePath,
      status: "pending",
    })
    .select(SOURCE_COLUMNS)
    .single();

  if (error) {
    const { error: cleanupError } = await supabase.storage
      .from(SOURCE_BUCKET)
      .remove([storagePath]);

    if (cleanupError) {
      console.error(
        `Verwaiste Datei im Bucket: ${storagePath}`,
        cleanupError.message,
      );
    }

    throw new Error(`Quelle konnte nicht angelegt werden: ${error.message}`);
  }

  return data;
}
