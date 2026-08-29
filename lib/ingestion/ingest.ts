import { embedDocuments } from "@/lib/embeddings";
import { SOURCE_COLUMNS, saveSourceSummary, type Source } from "@/lib/sources";
import { createAdminClient } from "@/lib/supabase/server";

import {
  MAX_CHUNKS_PER_SOURCE,
  chunkSegments,
  type ChunkMetadata,
  type SourceChunk,
} from "./chunk";
import { ExtractionError, extractSourceSegments } from "./extract";
import { summarizeSource } from "./summarize";

/**
 * Verarbeitet eine Quelle zu durchsuchbaren Chunks.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

/** Wie viele Chunkzeilen pro Insert. Ein Vektor sind 1536 Zahlen. */
const INSERT_BATCH_SIZE = 50;

export type IngestResult =
  | { outcome: "ready"; chunkCount: number }
  | { outcome: "skipped"; reason: string }
  | { outcome: "error"; message: string };

/**
 * Beansprucht die Quelle fuer diesen Lauf.
 *
 * Die Bedingung auf den bisherigen Status macht das Update zur Sperre: zwei
 * gleichzeitige Auslaeufer (zweiter Tab, doppelt ausgeloester Effekt) koennen
 * nicht beide dieselbe Quelle verarbeiten und doppelte Chunks schreiben.
 * Nur wer die Zeile von 'pending' oder 'error' auf 'processing' dreht,
 * bekommt sie zurueck.
 */
async function claimSource(sourceId: string): Promise<Source | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("sources")
    // Die Meldung des letzten Versuchs faellt mit weg: sie gehoert zu einem
    // Lauf, der vorbei ist, und das Constraint erlaubt sie ohnehin nur bei
    // status = 'error'.
    .update({ status: "processing", error_message: null })
    .eq("id", sourceId)
    .in("status", ["pending", "error"])
    .select(SOURCE_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(`Quelle konnte nicht belegt werden: ${error.message}`);
  }

  return data;
}

async function setStatus(
  sourceId: string,
  status: Source["status"],
  errorMessage: string | null = null,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("sources")
    .update({ status, error_message: errorMessage })
    .eq("id", sourceId);

  if (error) {
    // Nicht werfen: der eigentliche Fehler ist wichtiger als das Nachtragen
    // des Status. Sichtbar bleiben muss es trotzdem.
    console.error(
      `Status von Quelle ${sourceId} konnte nicht auf '${status}' gesetzt werden:`,
      error.message,
    );
  }
}

/**
 * Schreibt die Chunks einer Quelle.
 * Vorher werden vorhandene geloescht, damit ein zweiter Lauf nach einem
 * Fehler nicht dupliziert.
 */
async function writeChunks(
  source: Source,
  chunks: { index: number; content: string; metadata: unknown }[],
  embeddings: number[][],
): Promise<void> {
  const supabase = createAdminClient();

  const { error: deleteError } = await supabase
    .from("chunks")
    .delete()
    .eq("source_id", source.id);

  if (deleteError) {
    throw new Error(
      `Alte Chunks konnten nicht entfernt werden: ${deleteError.message}`,
    );
  }

  const rows = chunks.map((chunk, position) => ({
    source_id: source.id,
    notebook_id: source.notebook_id,
    chunk_index: chunk.index,
    content: chunk.content,
    // pgvector nimmt die Textform '[0.1,0.2,...]' entgegen.
    embedding: JSON.stringify(embeddings[position]),
    metadata: chunk.metadata,
  }));

  for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
    const batch = rows.slice(start, start + INSERT_BATCH_SIZE);
    const { error } = await supabase.from("chunks").insert(batch);

    if (error) {
      throw new Error(`Chunks konnten nicht gespeichert werden: ${error.message}`);
    }
  }
}

/**
 * Fuehrt eine Quelle von 'pending' nach 'ready'.
 *
 * Gibt Fehler als Ergebnis zurueck statt zu werfen, damit die Server Action
 * daraus eine verstaendliche Meldung machen kann. Unerwartetes wird geloggt.
 */
/**
 * Laedt die gespeicherten Abschnitte einer Quelle.
 *
 * Fuer Laeufe, die nach der Ingestion noch einmal auf den Text schauen -
 * etwa das Erneuern der Beschreibung. Die Einbettungen bleiben aussen vor:
 * sie werden dafuer nicht gebraucht und waeren 1536 Zahlen je Zeile.
 */
export async function loadSourceChunks(
  sourceId: string,
): Promise<SourceChunk[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("chunks")
    .select("chunk_index, content, metadata")
    .eq("source_id", sourceId)
    .order("chunk_index", { ascending: true });

  if (error) {
    throw new Error(`Abschnitte konnten nicht geladen werden: ${error.message}`);
  }

  return ((data ?? []) as {
    chunk_index: number;
    content: string;
    metadata: ChunkMetadata | null;
  }[]).map((zeile) => ({
    index: zeile.chunk_index,
    content: zeile.content,
    metadata: zeile.metadata ?? { start: 0, end: zeile.content.length },
  }));
}

export async function ingestSource(sourceId: string): Promise<IngestResult> {
  const source = await claimSource(sourceId);

  if (!source) {
    return {
      outcome: "skipped",
      reason: "Die Quelle wird bereits verarbeitet oder ist schon fertig.",
    };
  }

  try {
    const segments = await extractSourceSegments(source);
    const chunks = chunkSegments(segments);

    if (chunks.length === 0) {
      throw new ExtractionError("Aus dieser Quelle entstand kein einziger Chunk.");
    }

    if (chunks.length > MAX_CHUNKS_PER_SOURCE) {
      throw new ExtractionError(
        `Diese Quelle ergibt ${chunks.length} Abschnitte, erlaubt sind ` +
          `${MAX_CHUNKS_PER_SOURCE}. Nimm ein kleineres Dokument.`,
      );
    }

    const embeddings = await embedDocuments(chunks.map((c) => c.content));
    await writeChunks(source, chunks, embeddings);
    await setStatus(source.id, "ready");

    // Erst nach 'ready', und ausdruecklich ohne den Lauf zu gefaehrden.
    //
    // Die Quelle ist ohne Beschreibung voll benutzbar - Chunks, Embeddings
    // und Zitate stehen. Eine funktionierende Quelle als "Fehler" zu
    // markieren, weil ein Beiwerk fehlt, waere eine Verschlechterung.
    try {
      const beschreibung = await summarizeSource(chunks);
      await saveSourceSummary(
        source.id,
        beschreibung.summary,
        beschreibung.topics,
        beschreibung.questions,
      );
    } catch (error) {
      console.error(
        `Beschreibung fuer Quelle ${source.id} fehlgeschlagen:`,
        error,
      );
    }

    return { outcome: "ready", chunkCount: chunks.length };
  } catch (error) {
    console.error(`Ingestion von Quelle ${source.id} fehlgeschlagen:`, error);

    // Erwartete Fehler tragen eine Meldung, die dem Nutzer weiterhilft.
    const isExpected =
      error instanceof ExtractionError ||
      (error instanceof Error && error.name === "RateLimitError");

    const message =
      isExpected && error instanceof Error
        ? error.message
        : "Die Quelle konnte nicht verarbeitet werden.";

    // Die Meldung wandert in die Zeile, damit sie einen Reload ueberlebt.
    // Vorher lebte sie nur im Browser, und wer die Seite neu lud, sah
    // "Fehler" ohne jeden Hinweis, woran es lag.
    await setStatus(source.id, "error", message);

    return { outcome: "error", message };
  }
}
