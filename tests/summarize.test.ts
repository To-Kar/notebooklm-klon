import { describe, expect, it } from "vitest";

import type { SourceChunk } from "@/lib/ingestion/chunk";
import { sampleChunks } from "@/lib/ingestion/summarize";

/**
 * Die Auswahl der Abschnitte entscheidet, was die Beschreibung ueberhaupt
 * sehen kann. Nimmt sie nur den Anfang, beschreibt sie bei einem langen
 * Dokument das Vorwort statt des Inhalts - und das faellt niemandem auf,
 * weil das Ergebnis trotzdem plausibel klingt.
 */

function chunk(index: number, laenge: number): SourceChunk {
  return {
    index,
    content: `A${index}:`.padEnd(laenge, "x"),
    metadata: { start: 0, end: laenge },
  };
}

/** Aus welchen Abschnitten stammt die Auswahl? */
function indizes(auswahl: string[]): number[] {
  return auswahl.map((text) => Number(text.split(":")[0].slice(1)));
}

describe("sampleChunks", () => {
  it("gibt bei leerer Eingabe nichts zurueck", () => {
    expect(sampleChunks([])).toEqual([]);
  });

  it("nimmt alle Abschnitte, wenn sie ins Budget passen", () => {
    const chunks = [chunk(0, 100), chunk(1, 100), chunk(2, 100)];
    expect(sampleChunks(chunks, 1000)).toHaveLength(3);
  });

  it("haelt das Zeichenbudget ein", () => {
    const chunks = Array.from({ length: 200 }, (_, i) => chunk(i, 1000));
    const auswahl = sampleChunks(chunks, 15_000);
    const gesamt = auswahl.reduce((summe, text) => summe + text.length, 0);

    expect(gesamt).toBeLessThanOrEqual(15_000);
    expect(auswahl.length).toBeGreaterThan(0);
  });

  it("verteilt die Auswahl ueber das ganze Dokument", () => {
    // Der eigentliche Punkt: nicht nur der Anfang.
    const chunks = Array.from({ length: 200 }, (_, i) => chunk(i, 1000));
    const gewaehlt = indizes(sampleChunks(chunks, 15_000));

    expect(gewaehlt[0]).toBeLessThan(10);
    expect(gewaehlt.at(-1)).toBeGreaterThan(150);
  });

  it("nimmt nicht einfach die ersten Abschnitte", () => {
    const chunks = Array.from({ length: 100 }, (_, i) => chunk(i, 1000));
    const gewaehlt = indizes(sampleChunks(chunks, 10_000));

    // Waeren es die ersten zehn, stuende hier 0..9.
    expect(gewaehlt).not.toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("liefert die Abschnitte in Dokumentreihenfolge", () => {
    const chunks = Array.from({ length: 60 }, (_, i) => chunk(i, 1000));
    const gewaehlt = indizes(sampleChunks(chunks, 12_000));

    expect(gewaehlt).toEqual([...gewaehlt].sort((a, b) => a - b));
  });

  it("waehlt jeden Abschnitt hoechstens einmal", () => {
    const chunks = Array.from({ length: 40 }, (_, i) => chunk(i, 1000));
    const gewaehlt = indizes(sampleChunks(chunks, 12_000));

    expect(new Set(gewaehlt).size).toBe(gewaehlt.length);
  });

  it("kommt mit einem einzelnen ueberlangen Abschnitt zurecht", () => {
    // Darf nicht in eine Endlosschleife laufen und nichts Kaputtes liefern.
    const auswahl = sampleChunks([chunk(0, 50_000)], 15_000);
    expect(auswahl.length).toBeLessThanOrEqual(1);
  });
});
