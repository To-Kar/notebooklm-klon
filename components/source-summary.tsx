"use client";

import { useState } from "react";

/**
 * Kurzfassung und Kernthemen einer Quelle.
 *
 * Steht in einer schmalen Seitenleiste neben allem anderen, deshalb
 * eingeklappt: sichtbar ist, DASS es eine Beschreibung gibt, aufgeklappt
 * wird sie nur bei Interesse. Ausgeklappt waeren drei Saetze je Quelle mehr
 * Rauschen als Hilfe.
 */
export function SourceSummary({
  summary,
  topics,
}: {
  summary: string;
  topics: string[];
}) {
  const [offen, setOffen] = useState(false);

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
        </div>
      ) : null}
    </div>
  );
}
