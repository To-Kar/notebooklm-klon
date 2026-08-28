"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  renameNotebookAction,
  renameSourceAction,
} from "@/app/notebooks/rename-actions";
import { NOTEBOOK_TITLE_MAX_LENGTH } from "@/lib/notebook-limits";
import { SOURCE_TITLE_MAX_LENGTH } from "@/lib/source-limits";

/**
 * Umbenennen an Ort und Stelle.
 *
 * Der Titel wird dort bearbeitet, wo er steht - kein Dialog, keine eigene
 * Seite. Wie beim Loeschen ist der Knopf zweistufig: erst erscheint das Feld,
 * dann wird gespeichert.
 */
function RenameForm({
  aktuellerTitel,
  maxLength,
  label,
  gross,
  action,
  onFertig,
}: {
  aktuellerTitel: string;
  maxLength: number;
  label: string;
  /** Ueberschrift oder Zeile in einer Liste - beeinflusst nur die Groesse. */
  gross: boolean;
  action: (titel: string) => Promise<{ error: string | null }>;
  onFertig: () => void;
}) {
  const router = useRouter();
  const [titel, setTitel] = useState(aktuellerTitel);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, startTransition] = useTransition();

  function speichern(event: React.FormEvent) {
    event.preventDefault();
    setFehler(null);

    // Unveraenderte Eingabe: nichts schicken, nur schliessen. Ein Aufruf, der
    // denselben Wert zurueckschreibt, ist Arbeit ohne Wirkung.
    if (titel.trim() === aktuellerTitel) {
      onFertig();
      return;
    }

    startTransition(async () => {
      const ergebnis = await action(titel);

      if (ergebnis.error) {
        setFehler(ergebnis.error);
        return;
      }

      router.refresh();
      onFertig();
    });
  }

  return (
    <form onSubmit={speichern} className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={titel}
          autoFocus
          onChange={(event) => setTitel(event.target.value)}
          // Escape bricht ab, ohne das Formular abzuschicken. Der Browser
          // macht das bei einem Textfeld nicht von allein.
          onKeyDown={(event) => {
            if (event.key === "Escape") onFertig();
          }}
          maxLength={maxLength}
          aria-label={label}
          disabled={laeuft}
          className={`min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-2 py-1 outline-none transition focus:border-neutral-500 disabled:opacity-60 dark:border-neutral-700 dark:focus:border-neutral-500 ${
            gross ? "text-xl font-semibold" : "text-sm"
          }`}
        />

        <button
          type="submit"
          disabled={laeuft || titel.trim().length === 0}
          className="rounded-lg bg-neutral-900 px-3 py-1 text-xs font-medium text-neutral-50 transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {laeuft ? "Speichert ..." : "Speichern"}
        </button>

        <button
          type="button"
          onClick={onFertig}
          disabled={laeuft}
          className="rounded-lg px-2 py-1 text-xs text-neutral-500 transition hover:text-neutral-900 disabled:opacity-60 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          Abbrechen
        </button>
      </div>

      {fehler ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {fehler}
        </p>
      ) : null}
    </form>
  );
}

/** Die Ueberschrift eines Notebooks, umbenennbar. */
export function NotebookTitle({
  notebookId,
  title,
}: {
  notebookId: string;
  title: string;
}) {
  const [bearbeitet, setBearbeitet] = useState(false);

  if (bearbeitet) {
    return (
      <RenameForm
        aktuellerTitel={title}
        maxLength={NOTEBOOK_TITLE_MAX_LENGTH}
        label="Titel des Notebooks"
        gross
        action={(titel) => renameNotebookAction(notebookId, titel)}
        onFertig={() => setBearbeitet(false)}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>

      <button
        type="button"
        onClick={() => setBearbeitet(true)}
        className="text-xs text-neutral-500 underline underline-offset-2 transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        Umbenennen
      </button>
    </div>
  );
}

/** Der Titel einer Quelle in der Seitenleiste, umbenennbar. */
export function SourceTitle({
  sourceId,
  title,
}: {
  sourceId: string;
  title: string;
}) {
  const [bearbeitet, setBearbeitet] = useState(false);
  const knopf = useRef<HTMLButtonElement | null>(null);

  if (bearbeitet) {
    return (
      <RenameForm
        aktuellerTitel={title}
        maxLength={SOURCE_TITLE_MAX_LENGTH}
        label="Titel der Quelle"
        gross={false}
        action={(titel) => renameSourceAction(sourceId, titel)}
        onFertig={() => {
          setBearbeitet(false);
          // Der Fokus lag im Feld, das gerade verschwindet. Ohne diesen
          // Schritt landet er beim Body, und Tastaturbedienung faengt oben
          // auf der Seite wieder an.
          queueMicrotask(() => knopf.current?.focus());
        }}
      />
    );
  }

  return (
    <button
      ref={knopf}
      type="button"
      onClick={() => setBearbeitet(true)}
      title={`${title} - zum Umbenennen klicken`}
      className="block w-full truncate text-left text-sm font-medium transition hover:text-neutral-500 dark:hover:text-neutral-400"
    >
      {title}
    </button>
  );
}
