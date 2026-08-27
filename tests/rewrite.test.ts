import { describe, expect, it } from "vitest";

import { brauchtVerlauf } from "@/lib/chat/rewrite";

/**
 * Die Vorpruefung vor dem Umschreiben.
 *
 * Sie entscheidet, ob eine Folgefrage einen zusaetzlichen LLM-Aufruf wert
 * ist. Das ist keine Feinheit: die kostenlose Stufe erlaubt 20 Chat-Anfragen
 * pro Tag, blindes Umschreiben wuerde dieses Budget halbieren.
 *
 * Eine Heuristik - deshalb pruefen die Tests die Richtung, nicht die
 * Perfektion. Trifft sie daneben, wird mit der Rohfrage gesucht, also genau
 * so, wie es ohne das Umschreiben ohnehin waere.
 */
describe("brauchtVerlauf", () => {
  it.each([
    "Wofuer wird das eingesetzt?",
    "Auf welcher Seite steht das?",
    "Und dafuer?",
    "Wie funktioniert es?",
    "Was bedeutet dieser Begriff genau in diesem Zusammenhang?",
    "Wer hat sie geschrieben?",
  ])("erkennt den Rueckbezug in %j", (frage) => {
    expect(brauchtVerlauf(frage)).toBe(true);
  });

  it.each(["Warum?", "Nenne Beispiele.", "Und weiter?"])(
    "behandelt die sehr kurze Frage %j als abhaengig",
    (frage) => {
      expect(brauchtVerlauf(frage)).toBe(true);
    },
  );

  it.each([
    "Welche Chunkgroesse verwendet die Ingestion beim Zerlegen von Dokumenten?",
    "Wie viele Embedding-Dimensionen nutzt die Datenbank fuer die Vektorsuche?",
    "Welche Schritte durchlaeuft ein hochgeladenes PDF bis zur fertigen Antwort?",
  ])("laesst die eigenstaendige Frage %j ohne Aufruf durch", (frage) => {
    expect(brauchtVerlauf(frage)).toBe(false);
  });

  it("sieht in einer leeren Frage nichts aufzuloesen", () => {
    expect(brauchtVerlauf("")).toBe(false);
    expect(brauchtVerlauf("   ")).toBe(false);
  });

  it("erkennt Rueckbezuege unabhaengig von der Schreibweise", () => {
    expect(brauchtVerlauf("Und WAS BEDEUTET DAS fuer die Praxis im Alltag?")).toBe(
      true,
    );
  });

  it("laesst sich von Satzzeichen nicht taeuschen", () => {
    // "das" haengt hier an einem Komma - die Wortzerlegung muss das trennen.
    expect(
      brauchtVerlauf("Erklaer mir bitte genauer,das war zu knapp formuliert"),
    ).toBe(true);
  });

  it("haelt ein Wort nicht faelschlich fuer einen Rueckbezug", () => {
    // "Sieger" enthaelt "sie" nur als Zeichenfolge, "Datenbank" nichts.
    // Geprueft werden ganze Woerter, nicht Teilzeichenfolgen.
    expect(
      brauchtVerlauf(
        "Welcher Sieger wurde in der Datenbank fuer Turnierjahre vermerkt",
      ),
    ).toBe(false);
  });

  it("loest bei einem Artikel-'das' faelschlich aus (bekannte Grenze)", () => {
    // Im Deutschen ist "das" weit haeufiger Artikel als Rueckbezug. Die
    // Heuristik kann beides nicht unterscheiden und schlaegt hier an,
    // obwohl die Frage fuer sich steht.
    //
    // Bewusst so belassen: die Kosten sind ein zusaetzlicher LLM-Aufruf,
    // der Preis der Gegenrichtung waere eine Folgefrage, deren Rueckbezug
    // ungeloest in die Suche geht - und das trifft den Kern des Produkts.
    // Dieser Test haelt die Entscheidung fest, damit sie nicht unbemerkt
    // kippt.
    expect(
      brauchtVerlauf(
        "Welcher Sieger wurde in der Datenbank fuer das Turnierjahr vermerkt",
      ),
    ).toBe(true);
  });
});
