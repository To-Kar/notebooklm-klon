import { listSources } from "@/lib/sources";

import { formatScript, generateScript } from "./script";
import {
  claimAudioOverview,
  failAudioOverview,
  saveAudioOverview,
} from "./store";
import { synthesizeScript } from "./tts";
import { pcmDurationSeconds } from "./wav";

/**
 * Erzeugt die gesprochene Zusammenfassung eines Notebooks.
 *
 * Skript, Sprachausgabe und Ablage in einem Durchgang. Das haelt die
 * Zustandsverwaltung einfach, deckelt aber die Laenge: eine
 * Serverless-Function hat 60 Sekunden, und die Sprachausgabe braucht
 * gemessen etwa 0,76 Sekunden je Sekunde Audio.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

export type AudioResult =
  | { outcome: "ready"; seconds: number }
  | { outcome: "skipped"; reason: string }
  | { outcome: "error"; message: string };

export async function generateAudioOverview(
  notebookId: string,
): Promise<AudioResult> {
  const belegt = await claimAudioOverview(notebookId);

  if (!belegt) {
    return {
      outcome: "skipped",
      reason: "Die Zusammenfassung wird gerade schon erzeugt.",
    };
  }

  try {
    // Nur ausgewaehlte, fertig verarbeitete Quellen - dieselbe Regel wie im
    // Chat. Wer eine Quelle abwaehlt, will sie auch hier nicht hoeren.
    const quellen = (await listSources(notebookId)).filter(
      (source) => source.selected && source.status === "ready",
    );

    if (quellen.length === 0) {
      throw new Error(
        "Es ist keine verarbeitete Quelle ausgewaehlt, ueber die gesprochen werden koennte.",
      );
    }

    const zeilen = await generateScript(quellen);
    const audio = await synthesizeScript(zeilen);
    const sekunden = pcmDurationSeconds(audio.pcmBytes, audio.format);

    await saveAudioOverview(
      notebookId,
      audio.wav,
      formatScript(zeilen),
      sekunden,
    );

    return { outcome: "ready", seconds: sekunden };
  } catch (error) {
    console.error(`Audio fuer Notebook ${notebookId} fehlgeschlagen:`, error);

    // Rate-Limits und die eigenen Abbruchgruende tragen eine Meldung, die
    // dem Nutzer weiterhilft. Alles andere bleibt allgemein.
    const istVerstaendlich =
      error instanceof Error &&
      (error.name === "RateLimitError" ||
        error.message.startsWith("Es ist keine") ||
        error.message.startsWith("Ohne "));

    const message =
      istVerstaendlich && error instanceof Error
        ? error.message
        : "Die Zusammenfassung konnte nicht erzeugt werden.";

    await failAudioOverview(notebookId, message);
    return { outcome: "error", message };
  }
}
