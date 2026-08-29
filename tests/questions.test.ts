import { describe, expect, it } from "vitest";

import {
  MAX_QUESTIONS_PER_SOURCE,
  cleanQuestions,
} from "@/lib/ingestion/summarize";

/**
 * Einstiegsfragen landen als Knoepfe unter dem leeren Chat - das Erste, was
 * jemand von diesem Notebook sieht. Der Prompt bittet um Fragesaetze, aber
 * eine Bitte ist keine Garantie: was das Modell liefert, wird geprueft, nicht
 * geglaubt.
 */

describe("cleanQuestions", () => {
  it("nimmt gewoehnliche Fragen", () => {
    expect(
      cleanQuestions([
        "Was ist Retrieval-Augmented Generation?",
        "Welche vier Stufen hat RAG?",
      ]),
    ).toEqual([
      "Was ist Retrieval-Augmented Generation?",
      "Welche vier Stufen hat RAG?",
    ]);
  });

  it("wirft weg, was keine Frage ist", () => {
    // Ohne Fragezeichen ist es eine Ueberschrift oder eine Aufforderung.
    // Beides sieht in einem Fragenknopf falsch aus.
    expect(
      cleanQuestions([
        "Die vier Stufen von RAG",
        "Erklaere mir das Chunking.",
        "Was ist Chunking?",
      ]),
    ).toEqual(["Was ist Chunking?"]);
  });

  it("zieht Leerraum zusammen", () => {
    expect(cleanQuestions(["  Was   ist\nRAG?  "])).toEqual(["Was ist RAG?"]);
  });

  it("wirft zu lange Fragen weg", () => {
    const lang = `${"Wort ".repeat(40)}?`;

    expect(cleanQuestions([lang, "Kurz genug?"])).toEqual(["Kurz genug?"]);
  });

  it("entfernt Wiederholungen unabhaengig von der Schreibung", () => {
    // Zwei Quellen zum selben Thema liefern gern dieselbe Frage.
    expect(
      cleanQuestions(["Was ist RAG?", "was ist rag?", "Wozu dient RAG?"]),
    ).toEqual(["Was ist RAG?", "Wozu dient RAG?"]);
  });

  it("deckelt die Anzahl je Quelle", () => {
    const viele = Array.from(
      { length: 10 },
      (_, i) => `Frage Nummer ${i} zum Thema?`,
    );

    expect(cleanQuestions(viele)).toHaveLength(MAX_QUESTIONS_PER_SOURCE);
  });

  it("uebersteht alles, was kein Array von Texten ist", () => {
    expect(cleanQuestions(undefined)).toEqual([]);
    expect(cleanQuestions(null)).toEqual([]);
    expect(cleanQuestions("Was ist RAG?")).toEqual([]);
    expect(cleanQuestions([1, true, null, { frage: "Was?" }])).toEqual([]);
    expect(cleanQuestions([42, "Was ist RAG?"])).toEqual(["Was ist RAG?"]);
  });

  it("laesst nichts durch, was leer oder nur Zeichensetzung ist", () => {
    const ergebnis = cleanQuestions(["", "   ", "\n"]);

    expect(ergebnis).toEqual([]);
  });

  it("behaelt die Reihenfolge des Modells", () => {
    // Die erste Frage ist die naheliegendste; sie steht auch als erste da.
    expect(
      cleanQuestions(["Erste Frage?", "Zweite Frage?", "Dritte Frage?"]),
    ).toEqual(["Erste Frage?", "Zweite Frage?", "Dritte Frage?"]);
  });
});
