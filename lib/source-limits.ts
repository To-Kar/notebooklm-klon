/**
 * Grenzwerte und Anzeigetexte rund um Quellen.
 *
 * Bewusst ohne Server-Abhaengigkeiten, damit Client-Komponenten sie
 * importieren koennen, ohne lib/supabase/server.ts in den Browser-Bundle
 * zu ziehen. Siehe lib/notebook-limits.ts.
 */

/** Verarbeitungsstand einer Quelle, siehe status-Check in 0001_init.sql. */
export type SourceStatus = "pending" | "processing" | "ready" | "error";

/** Herkunft einer Quelle, siehe type-Check in 0001_init.sql. */
export type SourceType = "pdf" | "text" | "url";

/** Anzeigetexte fuer den Verarbeitungsstand. */
export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = {
  pending: "Wartet",
  processing: "Wird verarbeitet",
  ready: "Bereit",
  error: "Fehler",
};

/** Anzeigetexte fuer die Herkunft. */
export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  pdf: "PDF",
  text: "Text",
  url: "URL",
};

/** Name des privaten Storage-Buckets aus supabase/migrations/0003_sources.sql. */
export const SOURCE_BUCKET = "source-files";

/**
 * Maximale Dateigroesse.
 *
 * Der Upload laeuft durch eine Server Action, deren Request-Body auf
 * Vercel bei 4,5 MB gedeckelt ist. 4 MiB laesst Platz fuer den Overhead
 * der Multipart-Kodierung und passt zu den demo-tauglichen
 * Dokumentgroessen aus CLAUDE.md.
 */
export const SOURCE_FILE_MAX_BYTES = 4 * 1024 * 1024;

/** Fuer Anzeigezwecke, damit Formular und Fehlermeldung dieselbe Zahl nennen. */
export const SOURCE_FILE_MAX_LABEL = "4 MB";

/**
 * Erlaubte Dateitypen, gemappt auf sources.type aus 0001_init.sql.
 * Dieselbe Liste steckt als allowed_mime_types im Bucket.
 */
export const SOURCE_FILE_TYPES = {
  "application/pdf": "pdf",
  "text/plain": "text",
} as const;

export type SourceFileMimeType = keyof typeof SOURCE_FILE_TYPES;

/** Wert fuer das accept-Attribut des Datei-Inputs. */
export const SOURCE_FILE_ACCEPT = ".pdf,.txt,application/pdf,text/plain";

export function isAllowedSourceMimeType(
  mimeType: string,
): mimeType is SourceFileMimeType {
  return mimeType in SOURCE_FILE_TYPES;
}

/** Obergrenze fuer den Titel einer Quelle. */
export const SOURCE_TITLE_MAX_LENGTH = 200;
