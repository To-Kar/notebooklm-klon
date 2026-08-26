import { GEMINI_BASE, RateLimitError, geminiRequest } from "@/lib/gemini";

/**
 * Embedding-Anbieter.
 *
 * WICHTIG: Nur aus Server-Code importieren. LLM_API_KEY darf niemals in den
 * Browser gelangen.
 *
 * Nach aussen ist dieses Modul anbieterneutral: embedDocuments und embedQuery.
 * Der Gemini-spezifische Teil steckt unten und ist die einzige Stelle, die
 * beim Anbieterwechsel angefasst werden muss.
 */

/** Weiterhin von hier exportiert, damit Aufrufer nur ein Modul kennen muessen. */
export { RateLimitError };

/**
 * Dimension der Vektoren.
 *
 * MUSS mit supabase/migrations/0001_init.sql uebereinstimmen: dort steht sie
 * in der Spalte chunks.embedding und in der Signatur von match_chunks.
 * Passt sie nicht, wirft embedDocuments, statt unbrauchbare Vektoren zu
 * schreiben.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/** Vom Endpunkt erzwungenes Maximum pro Batch-Aufruf. */
const MAX_BATCH_SIZE = 100;

/**
 * Gemini unterscheidet, ob ein Text als Dokument abgelegt oder als Frage
 * gestellt wird. Die dokumentierte Verwendung fuer Retrieval.
 */
type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

function readEmbeddingModel(): string {
  const model = process.env.EMBEDDING_MODEL;

  if (!model) {
    throw new Error("Fehlende Env-Variable: EMBEDDING_MODEL");
  }

  return model;
}

/**
 * Auf Laenge 1 bringen.
 *
 * Gekuerzte Gemini-Vektoren kommen unnormalisiert zurueck. Fuer die
 * Cosine-Distanz ist das egal, die ist skaleninvariant. Wir normalisieren
 * trotzdem, damit ein spaeterer Wechsel auf Inner-Product-Suche nicht
 * stillschweigend falsche Ergebnisse liefert.
 */
function normalize(vector: number[]): number[] {
  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;

  const length = Math.sqrt(sumOfSquares);
  if (length === 0) {
    throw new Error("Embedding besteht nur aus Nullen.");
  }

  return vector.map((value) => value / length);
}

function assertDimensions(vector: number[]): number[] {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding hat ${vector.length} Dimensionen, erwartet sind ` +
        `${EMBEDDING_DIMENSIONS}. Entweder passt EMBEDDING_MODEL nicht, oder ` +
        `die Dimension in supabase/migrations/0001_init.sql muss angepasst werden.`,
    );
  }

  return vector;
}

/**
 * Gesamtes Wartebudget ueber alle Wiederholungen.
 *
 * Gemessen an der kostenlosen Stufe: 100 Embed-Requests pro Minute und Modell
 * (quotaId EmbedContentRequestsPerMinutePerUserPerProjectPerModel-FreeTier),
 * wobei jedes Element eines Batches einzeln zaehlt. Ein zweiter Batch muss
 * also auf das naechste Minutenfenster warten; der Anbieter nennt dafuer
 * typischerweise 10 bis 20 Sekunden.
 *
 * Nach oben begrenzt die Laufzeit der Serverless-Function. Reicht das Budget
 * nicht, brechen wir mit RateLimitError ab, setzen die Quelle auf 'error' und
 * lassen den Nutzer erneut anstossen - besser als eine Function, die ins
 * Timeout laeuft.
 */
const RETRY_BUDGET_MS = 45_000;

type BatchResponse = {
  embeddings?: { values?: number[] }[];
};

async function embedBatch(
  texts: string[],
  taskType: TaskType,
): Promise<number[][]> {
  const model = readEmbeddingModel();

  const payload = {
    requests: texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMENSIONS,
      taskType,
    })),
  };

  const response = await geminiRequest(
    `${GEMINI_BASE}/models/${model}:batchEmbedContents`,
    payload,
    { budgetMs: RETRY_BUDGET_MS },
  );

  const json = (await response.json()) as BatchResponse;

  const embeddings = json.embeddings ?? [];

  if (embeddings.length !== texts.length) {
    throw new Error(
      `Anbieter lieferte ${embeddings.length} Embeddings fuer ${texts.length} Texte.`,
    );
  }

  return embeddings.map((embedding) =>
    normalize(assertDimensions(embedding.values ?? [])),
  );
}

/**
 * Embeddings fuer Dokumentabschnitte.
 * Die Reihenfolge der Rueckgabe entspricht der Reihenfolge der Eingabe.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const results: number[][] = [];

  for (let start = 0; start < texts.length; start += MAX_BATCH_SIZE) {
    const batch = texts.slice(start, start + MAX_BATCH_SIZE);
    results.push(...(await embedBatch(batch, "RETRIEVAL_DOCUMENT")));
  }

  return results;
}

/** Embedding einer Suchanfrage. */
export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embedBatch([text], "RETRIEVAL_QUERY");
  return embedding;
}
