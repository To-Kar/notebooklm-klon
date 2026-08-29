"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { refreshSourceSummaryAction } from "@/app/notebooks/summary-actions";

/**
 * Kurzfassung und Kernthemen einer Quelle.
 *
 * Steht in einer schmalen Seitenleiste neben allem anderen, deshalb
 * eingeklappt: sichtbar ist, DASS es eine Beschreibung gibt, aufgeklappt
 * wird sie nur bei Interesse. Ausgeklappt waeren drei Saetze je Quelle mehr
 * Rauschen als Hilfe.
 */
export function SourceSummary({
  sourceId,
  summary,
  topics,
  hatFragen,
}: {
  sourceId: string;
  summary: string;
  topics: string[];
  /**
   * Ob zu dieser Quelle schon Einstiegsfragen vorliegen.
   *
   * Quellen, die vor den Einstiegsfragen verarbeitet wurden, haben keine.
   * Statt sie stillschweigend fehlen zu lassen, steht hier ein Angebot,
   * sie nachzuholen - mit dem Hinweis, dass es Kontingent kostet.
   */
  hatFragen: boolean;
}) {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, startTransition] = useTransition();

  function erneuern() {
    setFehler(null);

    startTransition(async () => {
      const ergebnis = await refreshSourceSummaryAction(sourceId);

      if (ergebnis.error) {
        setFehler(ergebnis.error);
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOffen((bisher) => !bisher)}
        aria-expanded={offen}
        className="text-xs text-neutral-500 underline underline-offset-2 transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        {offen ? "Beschreibung ausblenden" : "Worum geht es?"}
      </button>

      {offen ? (
        <div className="mt-1.5 space-y-2">
          <p className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
            {summary}
          </p>

          {topics.length > 0 ? (
            <ul className="flex flex-wrap gap-1">
              {topics.map((thema) => (
                <li
                  key={thema}
                  className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {thema}
                </li>
              ))}
            </ul>
          ) : null}

          {hatFragen ? null : (
            <div className="space-y-1">
              <button
                type="button"
                onClick={erneuern}
                disabled={laeuft}
                className="text-xs text-neutral-500 underline underline-offset-2 transition hover:text-neutral-900 disabled:opacity-60 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                {laeuft
                  ? "Wird erneuert ..."
                  : "Einstiegsfragen nachholen (kostet einen Aufruf)"}
              </button>

              {fehler ? (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {fehler}
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
