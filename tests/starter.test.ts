import { describe, expect, it } from "vitest";

import { pickStarterQuestions } from "@/lib/chat/starter";

/**
 * Die Einstiegsfragen sind das Erste, was jemand von einem fremden Notebook
 * sieht. Stammen alle vier aus derselben Quelle, wirkt das Notebook schmaler,
 * als es ist - und die zweite hochgeladene Datei sieht aus, als waere sie
 * nicht angekommen.
 */

describe("pickStarterQuestions", () => {
  it("nimmt bei einer Quelle deren Fragen der Reihe nach", () => {
    expect(pickStarterQuestions([["A?", "B?", "C?"]], 4)).toEqual([
      "A?",
      "B?",
      "C?",
    ]);
  });

  it("bedient die Quellen reihum, nicht der Reihe nach", () => {
    const ergebnis = pickStarterQuestions(
      [
        ["A1?", "A2?", "A3?"],
        ["B1?", "B2?", "B3?"],
      ],
      4,
    );

    expect(ergebnis).toEqual(["A1?", "B1?", "A2?", "B2?"]);
  });

  it("laesst jede Quelle vorkommen, solange Plaetze reichen", () => {
    const quellen = [["A1?", "A2?"], ["B1?", "B2?"], ["C1?"], ["D1?"]];
    const ergebnis = pickStarterQuestions(quellen, 4);

    for (const kennung of ["A", "B", "C", "D"]) {
      expect(ergebnis.some((frage) => frage.startsWith(kennung))).toBe(true);
    }
  });

  it("haelt die Obergrenze ein", () => {
    const quellen = Array.from({ length: 5 }, (_, i) => [
      `${i}a?`,
      `${i}b?`,
      `${i}c?`,
    ]);

    for (const max of [1, 2, 4, 7]) {
      expect(pickStarterQuestions(quellen, max)).toHaveLength(max);
    }
  });

  it("kommt mit ungleich vielen Fragen je Quelle zurecht", () => {
    expect(
      pickStarterQuestions([["A1?"], ["B1?", "B2?", "B3?"]], 4),
    ).toEqual(["A1?", "B1?", "B2?", "B3?"]);
  });

  it("zeigt keine Frage doppelt", () => {
    const ergebnis = pickStarterQuestions(
      [
        ["Was ist RAG?", "A2?"],
        ["was ist rag?", "B2?"],
      ],
      4,
    );

    expect(ergebnis).toEqual(["Was ist RAG?", "A2?", "B2?"]);
  });

  it("gibt nichts zurueck, wenn es nichts gibt", () => {
    expect(pickStarterQuestions([], 4)).toEqual([]);
    expect(pickStarterQuestions([[], []], 4)).toEqual([]);
    expect(pickStarterQuestions([["A?"]], 0)).toEqual([]);
  });

  it("behaelt die Reihenfolge innerhalb einer Quelle", () => {
    // Die erste Frage einer Quelle ist die naheliegendste und darf nicht
    // hinter ihrer eigenen zweiten landen.
    const ergebnis = pickStarterQuestions(
      [
        ["A1?", "A2?"],
        ["B1?", "B2?"],
      ],
      4,
    );

    expect(ergebnis.indexOf("A1?")).toBeLessThan(ergebnis.indexOf("A2?"));
    expect(ergebnis.indexOf("B1?")).toBeLessThan(ergebnis.indexOf("B2?"));
  });
});
