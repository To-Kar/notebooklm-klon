import { listSelectedSourceIds } from "@/lib/sources";

import { collectChunks, generateMindmap } from "./generate";
import { claimMindmap, failMindmap, saveMindmap } from "./store";

/**
 * Erzeugt die Themenlandkarte eines Notebooks.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

export type MindmapResult =
  | { outcome: "ready" }
  | { outcome: "skipped"; reason: string }
  | { outcome: "error"; message: string };

export async function buildMindmap(
  notebookId: string,
): Promise<MindmapResult> {
  const belegt = await claimMindmap(notebookId);

  if (!belegt) {
    return {
      outcome: "skipped",
      reason: "Die Karte wird gerade schon erzeugt.",
    };
  }

  try {
    // Dieselbe Regel wie im Chat und beim Audio: nur ausgewaehlte,
    // verarbeitete Quellen. Wer eine Quelle abwaehlt, will sie nirgends.
    const sourceIds = await listSelectedSourceIds(notebookId);

    if (sourceIds.length === 0) {
      throw new Error(
        "Es ist keine verarbeitete Quelle ausgewaehlt, aus der sich eine Karte zeichnen liesse.",
      );
    }

    const chunks = await collectChunks(notebookId, sourceIds);

    if (chunks.length === 0) {
      throw new Error("Ohne Abschnitte laesst sich keine Karte zeichnen.");
    }

    const map = await generateMindmap(chunks);

    await saveMindmap(notebookId, { map, sources: chunks });

    return { outcome: "ready" };
  } catch (error) {
    console.error(`Karte fuer Notebook ${notebookId} fehlgeschlagen:`, error);

    const istVerstaendlich =
      error instanceof Error &&
      (error.name === "RateLimitError" ||
        error.message.startsWith("Es ist keine") ||
        error.message.startsWith("Ohne ") ||
        error.message.startsWith("Die Karte kam"));

    const message =
      istVerstaendlich && error instanceof Error
        ? error.message
        : "Die Karte konnte nicht erzeugt werden.";

    await failMindmap(notebookId, message);
    return { outcome: "error", message };
  }
}
