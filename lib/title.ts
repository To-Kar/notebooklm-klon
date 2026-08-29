/**
 * Pruefung und Normalisierung von Titeln.
 *
 * Reine Funktion, keine Abhaengigkeiten: Notebook und Quelle teilen sie sich,
 * und Server Action wie Datenzugriff pruefen damit dieselbe Regel. Zwei
 * Kopien wuerden auseinanderlaufen, sobald eine davon angepasst wird.
 */

export type TitleCheck =
  | { ok: true; title: string }
  | { ok: false; reason: string };

/**
 * Trimmt, vereinheitlicht Leerraum und prueft die Laenge.
 *
 * Der Leerraum wird bewusst zusammengezogen: ein eingefuegter Titel bringt
 * gern Zeilenumbrueche mit, und die zerreissen jede Zeile, in der er spaeter
 * steht - in der Seitenleiste, im Belegdialog, in der Ueberschrift.
 * Kuerzen waere die bequemere Loesung, ist aber falsch: ein stillschweigend
 * abgeschnittener Titel sieht aus wie ein Eingabefehler des Nutzers.
 */
export function checkTitle(input: string, maxLength: number): TitleCheck {
  const title = input.replace(/\s+/g, " ").trim();

  if (title.length === 0) {
    return { ok: false, reason: "Der Titel darf nicht leer sein." };
  }

  if (title.length > maxLength) {
    return {
      ok: false,
      reason: `Der Titel darf höchstens ${maxLength} Zeichen lang sein.`,
    };
  }

  return { ok: true, title };
}
