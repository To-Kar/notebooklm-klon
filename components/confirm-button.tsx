"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Ein Knopf, der vor der Ausfuehrung zurueckfragt.
 *
 * Zweistufig statt window.confirm: der Browserdialog blockiert den ganzen
 * Tab, sieht auf jedem System anders aus und laesst sich nicht beschriften.
 * Hier steht die Frage da, wo der Klick passiert ist.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel = "Loeschen",
  pendingLabel = "Loescht ...",
  action,
  onDone,
  size = "normal",
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  pendingLabel?: string;
  action: () => Promise<{ error: string | null }>;
  /** Laeuft nach erfolgreicher Ausfuehrung, etwa zum Weiterleiten. */
  onDone?: () => void;
  size?: "normal" | "klein";
}) {
  const router = useRouter();
  const [fragt, setFragt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, startTransition] = useTransition();

  const textClass = size === "klein" ? "text-xs" : "text-sm";

  function ausfuehren() {
    setFehler(null);

    startTransition(async () => {
      try {
        const ergebnis = await action();

        if (ergebnis.error) {
          setFehler(ergebnis.error);
          return;
        }

        setFragt(false);
        // revalidatePath erneuert die Server-Daten, refresh holt sie ab.
        router.refresh();
        onDone?.();
      } catch (error) {
        console.error("Aktion fehlgeschlagen:", error);
        setFehler("Das hat nicht geklappt. Bitte versuch es erneut.");
      }
    });
  }

  if (!fragt) {
    return (
      <button
        type="button"
        onClick={() => setFragt(true)}
        className={`${textClass} text-neutral-500 underline underline-offset-2 transition hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400`}
      >
        {label}
      </button>
    );
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${textClass}`}>
      <span className="text-neutral-600 dark:text-neutral-300">{question}</span>

      <button
        type="button"
        onClick={ausfuehren}
        disabled={laeuft}
        className="rounded bg-red-600 px-2 py-0.5 font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
      >
        {laeuft ? pendingLabel : confirmLabel}
      </button>

      <button
        type="button"
        onClick={() => {
          setFragt(false);
          setFehler(null);
        }}
        disabled={laeuft}
        className="text-neutral-500 underline underline-offset-2 transition hover:text-neutral-900 disabled:opacity-60 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        Abbrechen
      </button>

      {fehler ? (
        <span role="alert" className="basis-full text-red-600 dark:text-red-400">
          {fehler}
        </span>
      ) : null}
    </span>
  );
}
