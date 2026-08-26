/**
 * Gemeinsamer Zugang zur Gemini-API.
 *
 * Wird von lib/embeddings.ts und lib/chat/llm.ts genutzt. Beide brauchen
 * dieselbe Behandlung von Rate-Limits und Serverfehlern; sie zweimal zu
 * pflegen waere eine Einladung, dass sie auseinanderlaufen.
 *
 * WICHTIG: Nur aus Server-Code importieren. LLM_API_KEY darf niemals in den
 * Browser gelangen.
 */

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Signalisiert ein erschoepftes Kontingent des Anbieters.
 *
 * Eigener Typ, damit die Aufrufer daraus eine verstaendliche Meldung machen
 * koennen statt eines generischen Fehlers - der Nutzer soll wissen, dass ein
 * spaeterer Versuch hilft.
 */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export function readGeminiApiKey(): string {
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    throw new Error("Fehlende Env-Variable: LLM_API_KEY");
  }

  return apiKey;
}

export function geminiHeaders(apiKey: string): HeadersInit {
  return {
    // Key im Header, nicht in der URL: URLs landen in Logs.
    "x-goog-api-key": apiKey,
    "Content-Type": "application/json",
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * Schickt eine Anfrage und wiederholt bei Rate-Limit oder Serverfehler.
 *
 * Gibt die erfolgreiche Response unausgewertet zurueck, damit der Aufrufer
 * entscheidet, ob er sie als JSON liest oder als Stream verarbeitet.
 *
 * Das Wartebudget begrenzt die Wiederholungen nach oben. Laenger zu warten
 * waere oft erfolgreich, wuerde aber die Laufzeit der Serverless-Function
 * aufbrauchen; ein sauberer RateLimitError ist besser als ein Timeout.
 */
export async function geminiRequest(
  url: string,
  body: unknown,
  options: { budgetMs: number; signal?: AbortSignal },
): Promise<Response> {
  let spentMs = 0;
  let attempt = 0;

  for (;;) {
    attempt += 1;

    const response = await fetch(url, {
      method: "POST",
      headers: geminiHeaders(readGeminiApiKey()),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (response.ok) {
      return response;
    }

    const detail = await response.text();
    const isRateLimit = response.status === 429;
    const isRetryable = isRateLimit || response.status >= 500;

    const failHard = () => {
      if (isRateLimit) {
        throw new RateLimitError(
          "Das Kontingent des Anbieters ist erschoepft. " +
            "Versuch es in ein paar Minuten noch einmal.",
        );
      }

      throw new Error(
        `Anbieter antwortete mit ${response.status}: ${detail.slice(0, 300)}`,
      );
    };

    if (!isRetryable) {
      failHard();
    }

    // Vorschlag des Anbieters, sonst 2s, 4s, 8s ...
    const waitMs = readRetryDelayMs(detail) ?? 2 ** attempt * 1000;

    if (spentMs + waitMs > options.budgetMs) {
      failHard();
    }

    await delay(waitMs);
    spentMs += waitMs;
  }
}
