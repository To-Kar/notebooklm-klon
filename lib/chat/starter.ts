/**
 * Auswahl der Einstiegsfragen, die unter dem leeren Chat stehen.
 *
 * Reine Funktion ohne Abhaengigkeiten: Fragen je Quelle rein, Auswahl raus.
 */

/** Wie viele Fragen hoechstens angeboten werden. */
export const MAX_STARTER_QUESTIONS = 4;

/**
 * Mischt die Fragen der Quellen reihum.
 *
 * Erst alle Fragen der ersten Quelle zu nehmen waere einfacher, wuerde bei
 * vier Vorschlaegen und drei Fragen je Quelle aber bedeuten, dass die zweite
 * Quelle gerade noch mit einer Frage vorkommt und jede weitere gar nicht.
 * Reihum bekommt jede Quelle zuerst eine Frage, bevor eine ihre zweite
 * bekommt - und wer zwei Dokumente hochgeladen hat, sieht auch beide.
 *
 * Die Reihenfolge innerhalb einer Quelle bleibt erhalten: die erste Frage
 * ist die naheliegendste.
 */
export function pickStarterQuestions(
  perSource: string[][],
  max: number = MAX_STARTER_QUESTIONS,
): string[] {
  if (max <= 0) return [];

  const gewaehlt: string[] = [];
  const gesehen = new Set<string>();
  const tiefe = Math.max(0, ...perSource.map((fragen) => fragen.length));

  for (let runde = 0; runde < tiefe; runde++) {
    for (const fragen of perSource) {
      const frage = fragen[runde];
      if (frage === undefined) continue;

      // Zwei Quellen zum selben Thema koennen dieselbe Frage liefern.
      const schluessel = frage.toLowerCase();
      if (gesehen.has(schluessel)) continue;

      gesehen.add(schluessel);
      gewaehlt.push(frage);

      if (gewaehlt.length === max) return gewaehlt;
    }
  }

  return gewaehlt;
}
