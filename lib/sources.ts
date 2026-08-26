import {
  SOURCE_BUCKET,
  SOURCE_FILE_MAX_BYTES,
  SOURCE_FILE_TYPES,
  SOURCE_TITLE_MAX_LENGTH,
  isAllowedSourceMimeType,
} from "@/lib/source-limits";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Datenzugriff fuer Quellen.
 *
 * WICHTIG: Nur aus Server-Code importieren (Server Components, Server Actions).
 * Das Modul haengt an lib/supabase/server.ts und damit am Secret-Key.
 */

/** Verarbeitungsstand einer Quelle, siehe status-Check in 0001_init.sql. */
export type SourceStatus = "pending" | "processing" | "ready" | "error";

/** Herkunft einer Quelle, siehe type-Check in 0001_init.sql. */
export type SourceType = "pdf" | "text" | "url";

export type Source = {
  id: string;
  notebook_id: string;
  title: string;
  type: SourceType;
  status: SourceStatus;
  storage_path: string | null;
  url: string | null;
  created_at: string;
};

const SOURCE_COLUMNS =
  "id, notebook_id, title, type, status, storage_path, url, created_at";

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
