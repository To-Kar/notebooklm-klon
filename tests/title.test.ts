import { describe, expect, it } from "vitest";

import { checkTitle } from "@/lib/title";

/**
 * Titel landen in der Ueberschrift, in der Seitenleiste, im Belegdialog und
 * im Prompt fuer die Karte. Ein Zeilenumbruch darin zerreisst all diese
 * Stellen auf einmal - und faellt beim Tippen niemandem auf, weil das
 * Eingabefeld einzeilig aussieht.
 */

describe("checkTitle", () => {
  it("nimmt einen gewoehnlichen Titel unveraendert", () => {
    expect(checkTitle("Jahresbericht 2025", 200)).toEqual({
      ok: true,
      title: "Jahresbericht 2025",
    });
  });

  it("entfernt Leerraum am Rand", () => {
    expect(checkTitle("  Bericht  ", 200)).toEqual({
      ok: true,
      title: "Bericht",
    });
  });

  it("zieht Leerraum im Inneren zusammen", () => {
    expect(checkTitle("Zwei    Woerter", 200)).toEqual({
      ok: true,
      title: "Zwei Woerter",
    });
  });

  it("macht aus Zeilenumbruechen und Tabs einzelne Leerzeichen", () => {
    for (const eingabe of [
      "Erste\nZweite",
      "Erste\r\nZweite",
      "Erste\tZweite",
      "Erste\n\n\nZweite",
      "Erste \n Zweite",
    ]) {
      expect(checkTitle(eingabe, 200)).toEqual({
        ok: true,
        title: "Erste Zweite",
      });
    }
  });

  it("laesst nie Leerraum uebrig, der eine Zeile brechen koennte", () => {
    const eingaben = [
      "  a\nb\tc  ",
      "\n\nTitel\n\n",
      "a  b  c",
      "\tTabelle\t1\t",
    ];

    for (const eingabe of eingaben) {
      const ergebnis = checkTitle(eingabe, 200);
      expect(ergebnis.ok).toBe(true);

      if (ergebnis.ok) {
        expect(ergebnis.title).not.toMatch(/[\n\r\t]/);
        expect(ergebnis.title).not.toMatch(/ {2}/);
        expect(ergebnis.title).toBe(ergebnis.title.trim());
      }
    }
  });

  it("lehnt leere Eingaben ab", () => {
    for (const eingabe of ["", "   ", "\n", "\t\t", " \r\n "]) {
      const ergebnis = checkTitle(eingabe, 200);
      expect(ergebnis.ok).toBe(false);

      if (!ergebnis.ok) {
        expect(ergebnis.reason).toContain("leer");
      }
    }
  });

  it("lehnt zu lange Titel ab, statt sie zu kuerzen", () => {
    // Stillschweigend kuerzen waere schlimmer: der Nutzer sieht nicht, dass
    // etwas fehlt, und haelt es fuer seinen eigenen Tippfehler.
    const ergebnis = checkTitle("x".repeat(201), 200);

    expect(ergebnis.ok).toBe(false);
    if (!ergebnis.ok) expect(ergebnis.reason).toContain("200");
  });

  it("misst die Laenge nach dem Zusammenziehen, nicht davor", () => {
    // Fuenf Zeichen, aber viel Leerraum dazwischen. Wer das ablehnt, misst
    // die Rohfassung und weist eine gueltige Eingabe zurueck.
    expect(checkTitle("a    b    c", 5)).toEqual({ ok: true, title: "a b c" });
  });

  it("laesst genau die Hoechstlaenge zu", () => {
    expect(checkTitle("x".repeat(200), 200)).toEqual({
      ok: true,
      title: "x".repeat(200),
    });
  });
});
