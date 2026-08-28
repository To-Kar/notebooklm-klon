import { describe, expect, it } from "vitest";

import { selectIndices } from "@/lib/mindmap/select";

/**
 * Die Auswahl entscheidet, was das Modell ueberhaupt zu sehen bekommt. Ein
 * Fehler hier faellt in der fertigen Karte nicht auf - sie sieht dann nur
 * einseitig aus, ohne dass jemand merkt, dass die zweite Haelfte des
 * Dokuments nie im Prompt stand.
 */

/** Gleich lange Abschnitte, damit nur die Verteilung geprueft wird. */
function gleichlang(anzahl: number, laenge = 100): number[] {
  return Array.from({ length: anzahl }, () => laenge);
}

describe("selectIndices", () => {
  it("nimmt alles, wenn beide Grenzen reichen", () => {
    expect(selectIndices(gleichlang(5), 10, 10_000)).toEqual([0, 1, 2, 3, 4]);
  });

  it("haelt die Obergrenze der Anzahl ein", () => {
    for (const anzahl of [1, 3, 7, 24]) {
      expect(selectIndices(gleichlang(200), anzahl, 10_000_000)).toHaveLength(
        anzahl,
      );
    }
  });

  it("haelt das Zeichenbudget ein", () => {
    const laengen = gleichlang(100, 300);
    const gewaehlt = selectIndices(laengen, 50, 1000);
    const summe = gewaehlt.reduce((s, i) => s + laengen[i], 0);

    expect(summe).toBeLessThanOrEqual(1000);
  });

  it("liefert aufsteigende, verschiedene Indizes", () => {
    const gewaehlt = selectIndices(gleichlang(37), 9, 10_000_000);

    expect(new Set(gewaehlt).size).toBe(gewaehlt.length);
    expect([...gewaehlt].sort((a, b) => a - b)).toEqual(gewaehlt);
  });

  it("bleibt im gueltigen Bereich", () => {
    for (const gesamt of [1, 2, 13, 200]) {
      for (const index of selectIndices(gleichlang(gesamt), 7, 10_000_000)) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(gesamt);
      }
    }
  });

  /**
   * Die eigentliche Eigenschaft: die Auswahl deckt das ganze Dokument ab,
   * nicht nur den Anfang. Nimmt jemand spaeter die ersten n, faellt genau
   * dieser Test um.
   */
  it("erreicht auch die zweite Haelfte eines langen Dokuments", () => {
    const gewaehlt = selectIndices(gleichlang(200), 12, 10_000_000);

    expect(Math.max(...gewaehlt)).toBeGreaterThan(100);
    expect(Math.min(...gewaehlt)).toBeLessThan(20);
  });

  it("verteilt die Auswahl ungefaehr gleichmaessig", () => {
    const gewaehlt = selectIndices(gleichlang(100), 10, 10_000_000);
    const abstaende = gewaehlt
      .slice(1)
      .map((index, i) => index - gewaehlt[i]);

    // Bei 100 Abschnitten und 10 Stueck sind das Schritte von 10.
    for (const abstand of abstaende) {
      expect(abstand).toBeGreaterThanOrEqual(9);
      expect(abstand).toBeLessThanOrEqual(11);
    }
  });

  it("nimmt einen einzelnen ueberlangen Abschnitt trotzdem mit", () => {
    // Sonst kaeme aus einer Quelle mit einem sehr langen Abschnitt gar nichts,
    // und die Karte ignorierte sie stillschweigend.
    expect(selectIndices([50_000], 5, 1000)).toEqual([0]);
  });

  it("gibt bei leerer Eingabe oder Grenze null nichts zurueck", () => {
    expect(selectIndices([], 5, 1000)).toEqual([]);
    expect(selectIndices(gleichlang(5), 0, 1000)).toEqual([]);
    expect(selectIndices(gleichlang(5), 5, 0)).toEqual([]);
  });
});
