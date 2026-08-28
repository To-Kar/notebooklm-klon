/**
 * Auswahl der Abschnitte, aus denen die Karte entsteht.
 *
 * Reine Funktion ohne Abhaengigkeiten: Laengen rein, Indizes raus. Getrennt
 * von der Erzeugung, weil sich die Verteilung so pruefen laesst, ohne einen
 * Anbieter oder eine Datenbank zu brauchen.
 */

/**
 * Waehlt Indizes gleichmaessig ueber das Dokument verteilt.
 *
 * Zwei Grenzen zugleich: hoechstens `maxCount` Abschnitte, und zusammen
 * hoechstens `maxChars` Zeichen. Die Anzahl deckelt, wie viele Belegnummern
 * das Modell auseinanderhalten muss; das Zeichenbudget deckelt die Kosten.
 *
 * Die ersten n zu nehmen waere einfacher, wuerde bei einem langen Dokument
 * aber nur das Vorwort abbilden - dieselbe Ueberlegung wie bei der
 * Kurzfassung einer Quelle.
 *
 * Der Rueckgabewert ist aufsteigend sortiert und frei von Wiederholungen.
 */
export function selectIndices(
  lengths: number[],
  maxCount: number,
  maxChars: number,
): number[] {
  if (lengths.length === 0 || maxCount <= 0 || maxChars <= 0) return [];

  const anzahl = Math.min(lengths.length, maxCount);
  const schritt = lengths.length / anzahl;

  const gewaehlt: number[] = [];
  let verbraucht = 0;

  for (let i = 0; i < anzahl; i++) {
    const index = Math.min(lengths.length - 1, Math.floor(i * schritt));

    // Math.floor kann bei schritt < 1 denselben Index zweimal treffen.
    if (gewaehlt[gewaehlt.length - 1] === index) continue;

    const laenge = lengths[index];

    // Ein einzelner ueberlanger Abschnitt darf nicht die ganze Auswahl
    // leerlaufen lassen: der erste kommt mit, danach greift das Budget.
    if (gewaehlt.length > 0 && verbraucht + laenge > maxChars) break;

    gewaehlt.push(index);
    verbraucht += laenge;
  }

  return gewaehlt;
}
