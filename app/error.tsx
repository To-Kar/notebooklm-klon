"use client";

import { useEffect } from "react";

/**
 * Fehler-Boundary fuer die App.
 *
 * Faengt zum Beispiel eine nicht erreichbare Datenbank oder fehlende
 * Supabase-Env-Variablen ab, statt den Nutzer auf einer weissen Seite
 * stehen zu lassen. Die eigentliche Ursache wird geloggt, nicht versteckt.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unerwarteter Fehler:", error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="rounded-xl border border-red-200 px-6 py-12 text-center dark:border-red-900/60">
        <h1 className="text-lg font-semibold">Da ist etwas schiefgelaufen</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
          Die Seite konnte nicht geladen werden. Prüf die Supabase-Verbindung
          und versuch es noch einmal.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Erneut versuchen
        </button>
      </div>
    </main>
  );
}
