import { describe, expect, it } from "vitest";

import { NOTEBOOK_TITLE_MAX_LENGTH } from "@/lib/notebook-limits";

/**
 * Rauchtest fuer die Testeinrichtung selbst.
 *
 * Prueft, dass der @-Alias aufgeloest wird - ohne ihn scheitert jeder andere
 * Test an seinen Importen, und die Ursache waere nicht auf Anhieb sichtbar.
 */
describe("Testeinrichtung", () => {
  it("loest den @-Alias auf Projektmodule auf", () => {
    expect(NOTEBOOK_TITLE_MAX_LENGTH).toBe(200);
  });
});
