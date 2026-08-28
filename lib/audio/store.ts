import { createAdminClient } from "@/lib/supabase/server";

/**
 * Zugriff auf die gesprochene Zusammenfassung eines Notebooks.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

export const AUDIO_BUCKET = "audio-overviews";

export type AudioStatus = "pending" | "processing" | "ready" | "error";

export type AudioOverview = {
  id: string;
  notebook_id: string;
  status: AudioStatus;
  script: string | null;
  storage_path: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  created_at: string;
};

const COLUMNS =
  "id, notebook_id, status, script, storage_path, duration_seconds, error_message, created_at";

/** Die Zusammenfassung eines Notebooks, oder null. */
export async function getAudioOverview(
  notebookId: string,
): Promise<AudioOverview | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("audio_overviews")
    .select(COLUMNS)
    .eq("notebook_id", notebookId)
    .maybeSingle();

  if (error) {
    throw new Error(`Audio konnte nicht geladen werden: ${error.message}`);
  }

  return data;
}

/**
 * Beansprucht das Notebook fuer einen Lauf.
 *
 * Wie bei der Ingestion macht der Statuswechsel die Sperre: zwei gleichzeitige
 * Klicks duerfen nicht beide erzeugen und sich gegenseitig ueberschreiben.
 * Die Zeile wird angelegt, falls es noch keine gibt.
 */
export async function claimAudioOverview(
  notebookId: string,
): Promise<boolean> {
  const supabase = createAdminClient();

  const { data: vorhanden, error: leseFehler } = await supabase
    .from("audio_overviews")
    .select("id, status")
    .eq("notebook_id", notebookId)
    .maybeSingle();

  if (leseFehler) {
    throw new Error(`Audio konnte nicht geladen werden: ${leseFehler.message}`);
  }

  if (!vorhanden) {
    const { error } = await supabase.from("audio_overviews").insert({
      notebook_id: notebookId,
      status: "processing",
    });

    // Ein gleichzeitiger zweiter Klick verletzt die unique-Bedingung. Das ist
    // kein Fehler, sondern genau die Sperre, die wir wollen.
    return !error;
  }

  const { data, error } = await supabase
    .from("audio_overviews")
    .update({ status: "processing", error_message: null })
    .eq("id", vorhanden.id)
    .in("status", ["pending", "ready", "error"])
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Audio konnte nicht belegt werden: ${error.message}`);
  }

  return data !== null;
}

/** Legt die fertige Datei ab und traegt sie ein. */
export async function saveAudioOverview(
  notebookId: string,
  wav: Uint8Array,
  script: string,
  durationSeconds: number,
): Promise<void> {
  const supabase = createAdminClient();

  // Fester Pfad je Notebook, mit upsert: eine neue Fassung ersetzt die alte,
  // statt Dateien anzuhaeufen, die niemand mehr findet.
  const storagePath = `${notebookId}/overview.wav`;

  const { error: uploadError } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(storagePath, wav, { contentType: "audio/wav", upsert: true });

  if (uploadError) {
    throw new Error(`Audio konnte nicht abgelegt werden: ${uploadError.message}`);
  }

  const { error } = await supabase
    .from("audio_overviews")
    .update({
      status: "ready",
      script,
      storage_path: storagePath,
      duration_seconds: Number(durationSeconds.toFixed(1)),
      error_message: null,
    })
    .eq("notebook_id", notebookId);

  if (error) {
    throw new Error(`Audio konnte nicht eingetragen werden: ${error.message}`);
  }
}

/** Haelt einen Fehlschlag fest. */
export async function failAudioOverview(
  notebookId: string,
  message: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("audio_overviews")
    .update({ status: "error", error_message: message })
    .eq("notebook_id", notebookId);

  if (error) {
    console.error(
      `Fehlerzustand fuer Notebook ${notebookId} nicht gespeichert:`,
      error.message,
    );
  }
}

/** Kurzlebige Adresse zum Abspielen. */
export async function createAudioUrl(
  storagePath: string,
  ttlSeconds = 3600,
): Promise<string | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);

  if (error || !data) {
    console.error("Signierte Audio-URL fehlgeschlagen:", error?.message);
    return null;
  }

  return data.signedUrl;
}
