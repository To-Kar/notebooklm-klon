import { generateText, type ChatMessage } from "./llm";

/**
 * Macht aus einer Folgefrage eine eigenstaendige Suchanfrage.
 *
 * Das Retrieval sieht immer nur einen Text. Bei "Wofuer wird das eingesetzt?"
 * fehlt darin genau das Wort, auf das es ankommt - die Suche greift dann ins
 * Leere oder holt Zufaelliges. Der Chat selbst bekommt weiterhin den vollen
 * Verlauf; umgeschrieben wird ausschliesslich der Text, mit dem gesucht wird.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

/** Eine Suchanfrage ist kurz. Mehr Token braucht es nicht. */
const MAX_QUERY_TOKENS = 100;

/** Wie viele vorherige Nachrichten dem Modell als Zusammenhang reichen. */
const HISTORY_WINDOW = 6;

/**
 * Woerter, die auf etwas zuvor Gesagtes verweisen.
 * Steht keines davon in der Frage, gibt es vermutlich nichts aufzuloesen.
 */
const RUECKBEZUEGE = [
  "das", "dass", "dies", "diese", "dieser", "dieses", "jene", "jener",
  "dafuer", "dafür", "damit", "dabei", "davon", "dazu", "daran", "darauf",
  "darin", "darueber", "darüber", "deren", "dessen", "er", "sie", "es",
  "ihn", "ihm", "ihr", "ihre", "sowas", "solche", "beides", "beide",
];

/** Ab wie vielen Woertern eine Frage als eigenstaendig durchgeht. */
const EIGENSTAENDIG_AB_WOERTERN = 8;

/**
 * Braucht diese Frage ueberhaupt den Verlauf?
 *
 * Die kostenlose Stufe erlaubt nur 20 Chat-Anfragen pro Tag
 * (quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier). Jede
 * Folgefrage blind umzuschreiben wuerde dieses Budget halbieren. Deshalb
 * diese Vorpruefung: sie kostet nichts und faengt die Faelle ab, in denen
 * ohnehin nichts aufzuloesen waere.
 *
 * Eine Heuristik. Trifft sie daneben, wird mit der Rohfrage gesucht - also
 * genau so, wie es ohne das Umschreiben ohnehin waere.
 */
function brauchtVerlauf(frage: string): boolean {
  const woerter = frage
    .toLowerCase()
    .split(/[^a-zäöüß]+/)
    .filter((wort) => wort.length > 0);

  if (woerter.length === 0) {
    return false;
  }

  if (woerter.some((wort) => RUECKBEZUEGE.includes(wort))) {
    return true;
  }

  // Sehr kurze Fragen haengen fast immer am Vorherigen.
  return woerter.length < EIGENSTAENDIG_AB_WOERTERN;
}

const REWRITE_PROMPT = `Du formulierst Suchanfragen fuer eine Dokumentensuche.

Aus dem Gespraechsverlauf und der letzten Frage machst du eine einzige, fuer sich stehende Suchanfrage.

Regeln:
1. Loese Rueckbezuege auf. Aus "Wofuer wird das eingesetzt?" wird "Wofuer wird Retrieval-Augmented Generation eingesetzt?".
2. Behalte die Begriffe des Nutzers bei. Erfinde keine Fachbegriffe dazu.
3. Ist die letzte Frage bereits eigenstaendig, gib sie unveraendert zurueck.
4. Antworte ausschliesslich mit der Suchanfrage. Keine Anfuehrungszeichen, keine Erklaerung, kein Praefix.`;

/**
 * Liefert den Text, mit dem gesucht werden soll.
 *
 * Faellt bei jedem Problem auf die Rohfrage zurueck. Ein misslungenes
 * Umschreiben darf die Suche nicht verhindern - schlechteres Retrieval ist
 * immer noch besser als gar keine Antwort.
 */
export async function buildSearchQuery(
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const last = messages[messages.length - 1];

  if (!last || last.role !== "user") {
    return "";
  }

  const history = messages.slice(0, -1);

  // Erste Frage im Gespraech: nichts aufzuloesen, also kein Aufruf und
  // keine zusaetzliche Wartezeit.
  if (history.length === 0) {
    return last.content;
  }

  // Steht die Frage fuer sich, sparen wir den Aufruf.
  if (!brauchtVerlauf(last.content)) {
    return last.content;
  }

  const verlauf = history
    .slice(-HISTORY_WINDOW)
    .map(
      (message) =>
        `${message.role === "user" ? "Nutzer" : "Assistent"}: ${message.content}`,
    )
    .join("\n");

  try {
    const query = await generateText(
      REWRITE_PROMPT,
      [
        {
          role: "user",
          content: `Bisheriges Gespraech:\n${verlauf}\n\nLetzte Frage:\n${last.content}`,
        },
      ],
      MAX_QUERY_TOKENS,
      signal,
    );

    // Leere oder absurd lange Antwort: dann lieber das Original.
    if (query.length === 0 || query.length > last.content.length + 300) {
      return last.content;
    }

    return query;
  } catch (error) {
    console.error("Umschreiben der Suchanfrage fehlgeschlagen:", error);
    return last.content;
  }
}
