"use server";

import { SOURCE_BUCKET } from "@/lib/source-limits";
import { getSource } from "@/lib/sources";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Server Action, die den Weg zurueck zum Original oeffnet.
 *
 * Der Bucket ist privat, der Browser kommt nicht direkt an die Datei. Statt
 * ihn oeffentlich zu machen, erzeugen wir bei Bedarf eine kurzlebige
 * signierte URL - der Secret-Key bleibt dabei serverseitig.
 */

/** Wie lange ein Link gilt. Kurz: er dient dem Nachschlagen, nicht dem Teilen. */
const SIGNED_URL_TTL_SECONDS = 300;

export type SourceLinkResult =
  | { url: string; error: null }
  | { url: null; error: string };

/**
 * Liefert die Adresse, unter der die Quelle im Original zu sehen ist.
 *
 * Bei Web-Quellen ist das die hinterlegte URL, bei Dateien eine signierte
 * Storage-URL. Bei PDFs wird die Seitenzahl als Fragment angehaengt, damit
 * der Viewer direkt an der Belegstelle aufmacht.
 */
export async function getSourceLinkAction(
  sourceId: string,
  page: number | null,
): Promise<SourceLinkResult> {
  // Die id kommt aus dem Browser und ist ungeprueft.
  const source = await getSource(sourceId);

  if (!source) {
    return { url: null, error: "Diese Quelle gibt es nicht." };
  }

  if (source.type === "url") {
    return source.url
      ? { url: source.url, error: null }
      : { url: null, error: "Zu dieser Quelle ist keine Adresse hinterlegt." };
  }

  if (!source.storage_path) {
    return { url: null, error: "Zu dieser Quelle ist keine Datei hinterlegt." };
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase.storage
    .from(SOURCE_BUCKET)
    .createSignedUrl(source.storage_path, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    console.error("Signierte URL fehlgeschlagen:", error?.message);
    return { url: null, error: "Die Datei konnte nicht geöffnet werden." };
  }

  // PDF-Viewer im Browser springen ueber dieses Fragment auf die Seite.
  const fragment =
    source.type === "pdf" && page !== null ? `#page=${page}` : "";

  return { url: `${data.signedUrl}${fragment}`, error: null };
}
