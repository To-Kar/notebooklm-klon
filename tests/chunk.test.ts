import { describe, expect, it } from "vitest";

import {
  MAX_CHUNK_LENGTH,
  chunkSegments,
  normalizeText,
} from "@/lib/ingestion/chunk";

/**
 * Der Chunker entscheidet ueber die Retrieval-Qualitaet.
 *
 * Zwei Fehler in diesem Modul sind beim Bauen nur aufgefallen, weil ein
 * solcher Test lief: die Ueberlappung griff ueberhaupt nie, und harte
 * Zeilenumbrueche gingen unveraendert ins Embedding. Beide haetten nicht
 * gekracht, sondern still die Trefferqualitaet ruiniert. Genau deshalb
 * pruefen die Tests hier Eigenschaften, nicht bloss Rueckgabewerte.
 */

const WOERTER = [
  "Ingestion", "Chunk", "Embedding", "Zitat", "Quelle", "Abschnitt",
  "Retrieval", "Vektor", "Datenbank", "Antwort", "Beleg", "Seite",
];

/**
 * Baut einen Absatz aus vorhersagbaren Woertern.
 *
 * Die Seed-Nummer steht im Text, damit jeder Absatz eindeutig ist. Ohne das
 * wiederholen sich die Absaetze (der Wortvorrat ist endlich), und Pruefungen
 * mit "enthaelt" gehen dann zufaellig durch, statt etwas zu belegen.
 */
function absatz(woerter: number, seed: number): string {
  const koerper = Array.from(
    { length: woerter },
    (_, i) => WOERTER[(i * 5 + seed) % WOERTER.length],
  ).join(" ");

  return `Absatz ${seed}: ${koerper}.`;
}

describe("normalizeText", () => {
  it("macht aus einzelnen Zeilenumbruechen Leerzeichen", () => {
    // Genau das Muster, das jede PDF-Extraktion erzeugt.
    const roh = "Dieser Satz wurde\nvom PDF-Export\nhart umbrochen.";
    expect(normalizeText(roh)).toBe(
      "Dieser Satz wurde vom PDF-Export hart umbrochen.",
    );
  });

  it("laesst Leerzeilen als Absatzgrenze stehen", () => {
    expect(normalizeText("Erster Absatz.\n\nZweiter Absatz.")).toBe(
      "Erster Absatz.\n\nZweiter Absatz.",
    );
  });

  it("staucht mehr als zwei Umbrueche auf eine Absatzgrenze", () => {
    expect(normalizeText("Eins.\n\n\n\nZwei.")).toBe("Eins.\n\nZwei.");
  });
});

describe("chunkSegments", () => {
  it("gibt kurzen Text unveraendert als einen Chunk zurueck", () => {
    const chunks = chunkSegments([{ text: "Ein einzelner kurzer Satz." }]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Ein einzelner kurzer Satz.");
    expect(chunks[0].metadata.page).toBeUndefined();
  });

  it("liefert fuer leeren Text und reinen Leerraum nichts", () => {
    expect(chunkSegments([{ text: "" }])).toHaveLength(0);
    expect(chunkSegments([{ text: "   \n\n  \t " }])).toHaveLength(0);
  });

  describe("langer Text aus vielen Absaetzen", () => {
    const absaetze = Array.from({ length: 40 }, (_, i) => absatz(30, i));
    const text = absaetze.join("\n\n");
    const chunks = chunkSegments([{ text }]);
    const normalisiert = normalizeText(text);

    it("zerlegt in mehrere Chunks", () => {
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("haelt jeden Chunk unter der Obergrenze", () => {
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_LENGTH);
      }
    });

    it("gibt keinen leeren Chunk aus", () => {
      for (const chunk of chunks) {
        expect(chunk.content.trim().length).toBeGreaterThan(0);
      }
    });

    it("nummeriert lueckenlos und in Reihenfolge", () => {
      expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    });

    it("verliert keinen Absatz", () => {
      // Vollstaendigkeit ist die Eigenschaft, die zaehlt: was hier
      // verlorengeht, ist im Chat nicht mehr auffindbar.
      const fehlend = absaetze.filter(
        (a) => !chunks.some((c) => c.content.includes(a)),
      );
      expect(fehlend).toEqual([]);
    });

    it("laesst aufeinanderfolgende Chunks ueberlappen", () => {
      // Der Fehler, der beim Bauen auffiel: die Ueberlappung war absatzweise
      // gebaut und uebertrug nur Absaetze unter 200 Zeichen - reale Absaetze
      // sind laenger, also entstand nie eine.
      for (let i = 1; i < chunks.length; i++) {
        const anfang = chunks[i].content.slice(0, 50);
        expect(chunks[i - 1].content).toContain(anfang);
      }
    });

    it("setzt Offsets, die in den Text zeigen", () => {
      for (const chunk of chunks) {
        expect(chunk.metadata.start).toBeGreaterThanOrEqual(0);
        expect(chunk.metadata.end).toBeLessThanOrEqual(normalisiert.length);
        expect(chunk.metadata.start).toBeLessThan(chunk.metadata.end);
      }
    });

    it("setzt Offsets, die auf den Chunkinhalt zeigen", () => {
      for (const chunk of chunks) {
        const ausschnitt = normalisiert.slice(
          chunk.metadata.start,
          chunk.metadata.end,
        );
        expect(ausschnitt).toContain(chunk.content.split("\n\n")[0].slice(0, 40));
      }
    });
  });

  it("zerlegt einen Absatz, der laenger als die Obergrenze ist", () => {
    const riese = Array.from({ length: 60 }, (_, i) => absatz(20, i)).join(" ");
    const chunks = chunkSegments([{ text: riese }]);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_LENGTH);
    }
  });

  it("schneidet auch ohne jede Satzgrenze", () => {
    const wall = "x".repeat(5000);
    const chunks = chunkSegments([{ text: wall }]);

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_LENGTH);
    }
  });

  describe("PDF-Seiten", () => {
    const seiten = Array.from({ length: 5 }, (_, s) => ({
      text: Array.from({ length: 12 }, (_, i) => absatz(30, s * 10 + i)).join(
        "\n\n",
      ),
      page: s + 1,
    }));
    const chunks = chunkSegments(seiten);

    it("gibt jedem Chunk eine Seitenzahl", () => {
      for (const chunk of chunks) {
        expect(typeof chunk.metadata.page).toBe("number");
      }
    });

    it("laesst den Index ueber Seiten hinweg durchlaufen", () => {
      expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    });

    it("mischt nie den Inhalt zweier Seiten", () => {
      // Ein Chunk aus zwei Seiten wuerde die Seitenzahl im Zitat zur Luege
      // machen - und das Zitat ist der Kern des Produkts.
      for (const chunk of chunks) {
        const seite = seiten[chunk.metadata.page! - 1];
        expect(normalizeText(seite.text)).toContain(
          chunk.content.split("\n\n")[0],
        );
      }
    });
  });

  it("behaelt Absatzgrenzen und glaettet Zeilenumbrueche", () => {
    const pdfArtig =
      "Dieser Satz wurde\nvom PDF-Export\nhart umbrochen.\n\nEin zweiter Absatz.";
    const chunks = chunkSegments([{ text: pdfArtig, page: 1 }]);

    expect(chunks[0].content).toContain(
      "Dieser Satz wurde vom PDF-Export hart umbrochen.",
    );
    expect(chunks[0].content).toContain("\n\nEin zweiter Absatz.");
  });

  it("terminiert auch bei Laengen genau an den Grenzen", () => {
    // Absicherung gegen eine Endlosschleife im Zusammenspiel von
    // Zielgroesse, Obergrenze und Ueberlappung.
    for (const laenge of [999, 1000, 1001, 1399, 1400, 1401, 2000]) {
      const chunks = chunkSegments([
        { text: "Wort ".repeat(Math.ceil(laenge / 5)) },
      ]);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.length).toBeLessThan(50);
    }
  });
});
