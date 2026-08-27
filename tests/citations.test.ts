import { describe, expect, it } from "vitest";

import type { ChatSource } from "@/app/api/chat/route";
import {
  describeSource,
  splitIntoSegments,
  usedSources,
} from "@/lib/chat/citations";

/**
 * Zitate sind der Kern des Produkts.
 *
 * Was hier falsch geht, fuehrt entweder zu einem Verweis, der ins Leere
 * zeigt, oder zu einer Aussage ohne sichtbaren Beleg. Beides ist schlimmer
 * als eine haessliche Oberflaeche.
 */

function quelle(marker: number, felder: Partial<ChatSource> = {}): ChatSource {
  return {
    marker,
    chunkId: `chunk-${marker}`,
    sourceId: `source-${marker}`,
    sourceType: "text",
    title: `Quelle ${marker}`,
    page: null,
    url: null,
    similarity: 0.8,
    content: `Inhalt ${marker}`,
    ...felder,
  };
}

describe("splitIntoSegments", () => {
  it("laesst Text ohne Belege unangetastet", () => {
    expect(splitIntoSegments("Ein Satz ohne Beleg.")).toEqual([
      { kind: "text", value: "Ein Satz ohne Beleg." },
    ]);
  });

  it("trennt Text und Belegnummer", () => {
    expect(splitIntoSegments("Aussage [1] Ende.")).toEqual([
      { kind: "text", value: "Aussage " },
      { kind: "citation", marker: 1 },
      { kind: "text", value: " Ende." },
    ]);
  });

  it("erkennt mehrere Belege direkt hintereinander", () => {
    expect(splitIntoSegments("Aussage [2][3].")).toEqual([
      { kind: "text", value: "Aussage " },
      { kind: "citation", marker: 2 },
      { kind: "citation", marker: 3 },
      { kind: "text", value: "." },
    ]);
  });

  it("laesst eine noch unvollstaendige Nummer als Text stehen", () => {
    // Waehrend des Streamens kommt "[1" an, bevor die Klammer da ist. Ein
    // halb erkannter Beleg waere schlimmer als gar keiner.
    expect(splitIntoSegments("Aussage [1")).toEqual([
      { kind: "text", value: "Aussage [1" },
    ]);
  });

  it("ignoriert Klammern ohne Zahl", () => {
    expect(splitIntoSegments("Ein [Hinweis] im Text.")).toEqual([
      { kind: "text", value: "Ein [Hinweis] im Text." },
    ]);
  });

  it("kommt mit leerem Text zurecht", () => {
    expect(splitIntoSegments("")).toEqual([]);
  });

  it("behaelt den vollstaendigen Text ueber alle Segmente", () => {
    const text = "Erst [1], dann [12] und zuletzt [3].";
    const zusammengesetzt = splitIntoSegments(text)
      .map((s) => (s.kind === "text" ? s.value : `[${s.marker}]`))
      .join("");

    expect(zusammengesetzt).toBe(text);
  });

  it("liest auch zweistellige Nummern", () => {
    expect(splitIntoSegments("Aussage [12].")[1]).toEqual({
      kind: "citation",
      marker: 12,
    });
  });
});

describe("usedSources", () => {
  const sources = [quelle(1), quelle(2), quelle(3)];

  it("gibt nur die zitierten Quellen zurueck", () => {
    const belege = usedSources("Aussage [1] und [3].", sources);
    expect(belege.map((s) => s.marker)).toEqual([1, 3]);
  });

  it("gibt nichts zurueck, wenn nichts zitiert wurde", () => {
    expect(usedSources("Eine Antwort ohne Beleg.", sources)).toEqual([]);
  });

  it("ignoriert Nummern ohne zugehoerige Quelle", () => {
    // Der Prompt verbietet erfundene Belege, aber ein Modell haelt sich
    // nicht immer daran.
    expect(usedSources("Aussage [9].", sources)).toEqual([]);
  });

  it("nennt jede Quelle nur einmal, auch bei mehrfachem Verweis", () => {
    const belege = usedSources("Erst [2], spaeter nochmal [2].", sources);
    expect(belege.map((s) => s.marker)).toEqual([2]);
  });

  it("behaelt die Reihenfolge der Quellen, nicht die der Erwaehnung", () => {
    const belege = usedSources("Zuerst [3], dann [1].", sources);
    expect(belege.map((s) => s.marker)).toEqual([1, 3]);
  });
});

describe("describeSource", () => {
  it("nennt Titel und Typ", () => {
    expect(describeSource(quelle(1, { title: "notiz.txt" }))).toBe(
      "notiz.txt (Text)",
    );
  });

  it("nennt bei PDFs die Seite", () => {
    expect(
      describeSource(
        quelle(1, { title: "handbuch.pdf", sourceType: "pdf", page: 2 }),
      ),
    ).toBe("handbuch.pdf (PDF, Seite 2)");
  });

  it("laesst die Seite weg, wo es keine gibt", () => {
    expect(
      describeSource(quelle(1, { title: "beispiel.de", sourceType: "url" })),
    ).toBe("beispiel.de (URL)");
  });
});
