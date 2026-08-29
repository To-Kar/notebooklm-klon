"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  selectAllSourcesAction,
  toggleSourceAction,
} from "@/app/notebooks/selection-actions";

/**
 * Quellen an- und abwaehlen.
 *
 * Die Auswahl entscheidet, worin der Chat sucht. Ohne sie verdraengt eine
 * grosse Quelle eine kleine: gemessen an einem Notebook mit 19 Chunks aus
 * einem Artikel und 3 aus einem PDF war unter den besten acht Treffern kein
 * einziger aus dem PDF.
 */

/** Kaestchen an einer einzelnen Quelle. */
export function SourceCheckbox({
  sourceId,
  selected,
  title,
  disabled,
}: {
  sourceId: string;
  selected: boolean;
  title: string;
  /** Nicht verarbeitete Quellen tragen nichts bei. */
  disabled: boolean;
}) {
  const router = useRouter();
  const [laeuft, startTransition] = useTransition();
  /**
   * Sofort umschalten, damit das Kaestchen nicht auf den Server wartet.
   *
   * useOptimistic statt useState: der Wert faellt nach der Transition von
   * selbst auf den Serverstand zurueck. Das deckt zwei Faelle ab, die mit
   * useState eigens behandelt werden muessten - einen Fehlschlag der Action,
   * und ein Umschalten von aussen ueber "Alle auswaehlen".
   */
  const [optimistisch, setOptimistisch] = useOptimistic(selected);

  function umschalten(neu: boolean) {
    startTransition(async () => {
      setOptimistisch(neu);

      const ergebnis = await toggleSourceAction(sourceId, neu);

      if (ergebnis.error) {
        console.error(ergebnis.error);
        return;
      }

      router.refresh();
    });
  }

  return (
    <input
      type="checkbox"
      checked={optimistisch}
      disabled={disabled || laeuft}
      onChange={(event) => umschalten(event.target.checked)}
      aria-label={`${title} bei Fragen berücksichtigen`}
      className="mt-0.5 size-4 shrink-0 cursor-pointer accent-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 dark:accent-neutral-100"
    />
  );
}

/** Alle an- oder abwaehlen. */
export function SelectAllSources({
  notebookId,
  alleAusgewaehlt,
}: {
  notebookId: string;
  alleAusgewaehlt: boolean;
}) {
  const router = useRouter();
  const [laeuft, startTransition] = useTransition();

  function umschalten() {
    startTransition(async () => {
      const ergebnis = await selectAllSourcesAction(
        notebookId,
        !alleAusgewaehlt,
      );

      if (ergebnis.error) {
        console.error(ergebnis.error);
        return;
      }

      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={umschalten}
      disabled={laeuft}
      className="text-xs text-neutral-500 underline underline-offset-2 transition hover:text-neutral-900 disabled:opacity-60 dark:text-neutral-400 dark:hover:text-neutral-100"
    >
      {alleAusgewaehlt ? "Keine auswählen" : "Alle auswählen"}
    </button>
  );
}
