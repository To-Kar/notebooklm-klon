import { embedQuery } from "@/lib/embeddings";
import type { SourceType } from "@/lib/source-limits";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Retrieval: die zur Frage passenden Abschnitte eines Notebooks.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

/** Wie viele Abschnitte pro Frage in den Kontext wandern. */
export const DEFAULT_MATCH_COUNT = 8;

/**
 * Ein Treffer, angereichert um alles, was Antwort und Zitat brauchen.
 * Die Herkunft (Titel, Seite) ist kein Beiwerk: ohne sie kann die Antwort
 * nicht auf ihre Belegstelle zurueckverweisen.
 */
export type RetrievedChunk = {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  chunkIndex: number;
  content: string;
  similarity: number;
  /** Seitenzahl bei PDFs, sonst null. */
  page: number | null;
};

/** Was match_chunks zurueckgibt, siehe 0001_init.sql. */
type MatchRow = {
  id: string;
  source_id: string;
  content: string;
  chunk_index: number;
  similarity: number;
};

/** Zeile aus dem Nachladen von Metadaten und Quellenangaben. */
type ChunkDetailRow = {
  id: string;
  metadata: { page?: number } | null;
  sources: {
    id: string;
    title: string;
    type: SourceType;
    url: string | null;
  } | null;
};

/**
 * Sucht die aehnlichsten Abschnitte im Notebook.
 *
 * Zwei Abfragen mit Absicht: match_chunks liefert die Rangfolge, gibt aber
 * weder metadata noch Angaben zur Quelle zurueck. Die Funktion dafuer
 * umzubauen hiesse, ihre Signatur mit vector(1536) neu zu schreiben - und
 * damit die Embedding-Dimension an einer dritten Stelle zu fuehren. Genau
 * das verbietet die Projektkonvention, und zu Recht: eine Dimension, die an
 * drei Stellen gepflegt werden muss, laeuft irgendwann auseinander.
 */
export async function retrieveChunks(
  notebookId: string,
  question: string,
  matchCount: number = DEFAULT_MATCH_COUNT,
): Promise<RetrievedChunk[]> {
  const trimmedQuestion = question.trim();

  if (trimmedQuestion.length === 0) {
    return [];
  }

  const supabase = createAdminClient();
  const embedding = await embedQuery(trimmedQuestion);

  const { data, error } = await supabase.rpc("match_chunks", {
    // pgvector nimmt die Textform entgegen, wie beim Schreiben der Chunks.
    query_embedding: JSON.stringify(embedding),
    match_notebook_id: notebookId,
    match_count: matchCount,
  });

  if (error) {
    throw new Error(`Retrieval fehlgeschlagen: ${error.message}`);
  }

  const matches = (data ?? []) as MatchRow[];

  if (matches.length === 0) {
    return [];
  }

  const { data: details, error: detailError } = await supabase
    .from("chunks")
    .select("id, metadata, sources(id, title, type, url)")
    .in(
      "id",
      matches.map((match) => match.id),
    );

  if (detailError) {
    throw new Error(
      `Angaben zu den Treffern fehlen: ${detailError.message}`,
    );
  }

  const detailById = new Map<string, ChunkDetailRow>(
    ((details ?? []) as unknown as ChunkDetailRow[]).map((row) => [row.id, row]),
  );

  // Die Reihenfolge von match_chunks ist die Rangfolge und bleibt erhalten.
  return matches.map((match) => {
    const detail = detailById.get(match.id);
    const page = detail?.metadata?.page;

    return {
      chunkId: match.id,
      sourceId: match.source_id,
      sourceTitle: detail?.sources?.title ?? "Unbekannte Quelle",
      sourceType: detail?.sources?.type ?? "text",
      sourceUrl: detail?.sources?.url ?? null,
      chunkIndex: match.chunk_index,
      content: match.content,
      similarity: match.similarity,
      page: typeof page === "number" ? page : null,
    };
  });
}
