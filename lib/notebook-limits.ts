/**
 * Grenzwerte rund um Notebooks.
 *
 * Bewusst ohne Server-Abhaengigkeiten, damit Client-Komponenten sie
 * importieren koennen, ohne lib/supabase/server.ts in den Browser-Bundle
 * zu ziehen.
 */

/** Obergrenze fuer Notebook-Titel. Serverseitig geprueft, nicht nur im Formular. */
export const NOTEBOOK_TITLE_MAX_LENGTH = 200;
