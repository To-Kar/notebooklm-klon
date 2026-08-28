import { describe, expect, it } from "vitest";

import {
  MAX_SCRIPT_CHARS,
  formatScript,
  trimScript,
  type ScriptLine,
} from "@/lib/audio/script";

/**
 * Das Skript bestimmt, was zu hoeren ist - und Fehler fallen erst beim
 * Hoeren auf, nicht beim Lesen einer Fehlermeldung.
 */

function zeile(speaker: "Anna" | "Ben", laenge: number): ScriptLine {
  return { speaker, text: "x".repeat(laenge) };
}

describe("trimScript", () => {
  it("laesst ein kurzes Skript unveraendert", () => {
    const lines = [zeile("Anna", 50), zeile("Ben", 30), zeile("Anna", 40)];
    expect(trimScript(lines)).toHaveLength(3);
  });

  it("haelt die Zeichengrenze ein", () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
      zeile(i % 2 === 0 ? "Anna" : "Ben", 100),
    );
    const gekuerzt = trimScript(lines, 300);
    const gesamt = gekuerzt.reduce((summe, l) => summe + l.text.length, 0);

    expect(gesamt).toBeLessThanOrEqual(300);
  });

  it("endet nicht auf einer Frage von Ben", () => {
    // Der Fehler aus dem ersten echten Durchlauf: die Aufnahme hoerte mit
    // einer unbeantworteten Frage auf.
    const lines = [
      zeile("Anna", 100),
      zeile("Ben", 50),
      zeile("Anna", 100),
      zeile("Ben", 50),
      zeile("Anna", 500),
    ];

    // Budget reicht bis einschliesslich der zweiten Ben-Zeile.
    const gekuerzt = trimScript(lines, 320);
    expect(gekuerzt.at(-1)?.speaker).toBe("Anna");
  });

  it("laesst eine Ben-Zeile stehen, wenn sonst nichts bleibt", () => {
    // Lieber eine Zeile als ein leeres Skript.
    expect(trimScript([zeile("Ben", 900)], 100)).toHaveLength(1);
  });

  it("gibt bei zu langer erster Zeile trotzdem etwas zurueck", () => {
    const gekuerzt = trimScript([zeile("Anna", 5_000)], MAX_SCRIPT_CHARS);
    expect(gekuerzt).toHaveLength(1);
  });

  it("behaelt die Reihenfolge", () => {
    const lines = [
      { speaker: "Anna" as const, text: "eins" },
      { speaker: "Ben" as const, text: "zwei" },
      { speaker: "Anna" as const, text: "drei" },
    ];
    expect(trimScript(lines).map((l) => l.text)).toEqual([
      "eins",
      "zwei",
      "drei",
    ]);
  });
});

describe("formatScript", () => {
  it("stellt jeder Zeile den Sprecher voran", () => {
    // Genau diese Form wertet das Sprachmodell aus, um die Stimmen
    // zuzuordnen. Ohne den Namen spraeche alles eine Stimme.
    expect(
      formatScript([
        { speaker: "Anna", text: "Hallo." },
        { speaker: "Ben", text: "Und?" },
      ]),
    ).toBe("Anna: Hallo.\nBen: Und?");
  });
});
