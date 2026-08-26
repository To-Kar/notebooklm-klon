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

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Gemini unterscheidet, ob ein Text als Dokument abgelegt oder als Frage
 * gestellt wird. Die dokumentierte Verwendung fuer Retrieval.
 */
type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

function readConfig() {
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.EMBEDDING_MODEL;

  if (!apiKey || !model) {
    throw new Error(
      "Fehlende Env-Variablen: LLM_API_KEY / EMBEDDING_MODEL",
    );
  }

  return { apiKey, model };
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

/** Wartet die angegebene Zeit. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Signalisiert ein erschoepftes Kontingent des Anbieters.
 *
 * Eigener Typ, damit die Ingestion daraus eine verstaendliche Meldung machen
 * kann statt eines generischen Fehlers - der Nutzer soll wissen, dass ein
 * spaeterer Versuch hilft.
 */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
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

/**
 * Gemini legt einem 429 ein RetryInfo-Detail bei, etwa { retryDelay: "27s" }.
 * Diese Angabe ist brauchbarer als ein geratenes Backoff.
 */
function readRetryDelayMs(errorBody: string): number | null {
  try {
    const parsed = JSON.parse(errorBody) as {
      error?: { details?: { retryDelay?: string }[] };
    };

    for (const detail of parsed.error?.details ?? []) {
      const match = detail.retryDelay?.match(/^([\d.]+)s$/);
      if (match) {
        return Math.ceil(Number(match[1]) * 1000);
      }
    }
  } catch {
    // Kein JSON oder unerwartete Form: dann eben geraten.
  }

  return null;
}

/**
 * Ruft den Endpunkt auf und wiederholt bei Rate-Limit oder Serverfehler.
 *
 * Ohne Wiederholung liefe ein Ingestion-Lauf ueber mehrere Batches mitten im
 * Dokument auf 429 und liesse die Quelle halb verarbeitet zurueck.
 */
async function postWithRetry(
  url: string,
  body: unknown,
  apiKey: string,
): Promise<unknown> {
  let spentMs = 0;
  let attempt = 0;

  for (;;) {
    attempt += 1;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        // Key im Header, nicht in der URL: URLs landen in Logs.
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return response.json();
    }

    const detail = await response.text();
    const isRateLimit = response.status === 429;
    const isRetryable = isRateLimit || response.status >= 500;

    if (!isRetryable) {
      throw new Error(
        `Embedding-Anbieter antwortete mit ${response.status}: ${detail.slice(0, 300)}`,
      );
    }

    // Vorschlag des Anbieters, sonst 2s, 4s, 8s ...
    const suggested = readRetryDelayMs(detail);
    const waitMs = suggested ?? 2 ** attempt * 1000;

    if (spentMs + waitMs > RETRY_BUDGET_MS) {
      if (isRateLimit) {
        throw new RateLimitError(
          "Das Kontingent des Embedding-Anbieters ist erschoepft. " +
            "Versuch es in ein paar Minuten noch einmal.",
        );
      }

      throw new Error(
        `Embedding-Anbieter antwortete mit ${response.status}: ${detail.slice(0, 300)}`,
      );
    }

    await delay(waitMs);
    spentMs += waitMs;
  }
}

type BatchResponse = {
  embeddings?: { values?: number[] }[];
};

async function embedBatch(
  texts: string[],
  taskType: TaskType,
): Promise<number[][]> {
  const { apiKey, model } = readConfig();

  const payload = {
    requests: texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMENSIONS,
      taskType,
    })),
  };

  const json = (await postWithRetry(
    `${GEMINI_BASE}/models/${model}:batchEmbedContents`,
    payload,
    apiKey,
  )) as BatchResponse;

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
