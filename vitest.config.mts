import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Testlauf fuer die reine Logik.
 *
 * Bewusst ohne Browserumgebung und ohne Datenbank: getestet wird, was ohne
 * Netz und ohne Zustand entscheidbar ist - Chunking, das Parsen der
 * Zitatmarker, Adress- und Hostpruefungen. Alles andere ist gegen die echte
 * Instanz geprueft worden und gehoert nicht in einen Unit-Test.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
