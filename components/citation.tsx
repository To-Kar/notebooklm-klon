"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatSource } from "@/app/api/chat/route";
import { getSourceLinkAction } from "@/app/notebooks/source-link-actions";
import { describeSource, splitIntoSegments } from "@/lib/chat/citations";
import { SOURCE_TYPE_LABELS } from "@/lib/source-limits";

/**
 * Zitate: der Weg von der Aussage zurueck zur Belegstelle.
 *
 * Das ist der Kern des Produkts. Eine Antwort ohne nachpruefbaren Beleg ist
 * hier kein Teilerfolg, sondern ein Fehler.
 */

/**
 * Der Antworttext mit anklickbaren Belegnummern.
 *
 * Eine Nummer, zu der es keinen Auszug gibt, bleibt schlichter Text. Der
 * Prompt verbietet erfundene Belege, aber ein Modell haelt sich nicht immer
 * daran - und ein Knopf, der ins Leere fuehrt, waere schlimmer als keiner.
 */
export function AnswerWithCitations({
  content,
  sources,
  onSelect,
}: {
  content: string;
  sources: ChatSource[];
  onSelect: (source: ChatSource) => void;
}) {
  const byMarker = new Map(sources.map((source) => [source.marker, source]));

  return (
    <p className="whitespace-pre-wrap text-sm">
      {splitIntoSegments(content).map((segment, index) => {
        if (segment.kind === "text") {
          return <span key={index}>{segment.value}</span>;
        }

        const source = byMarker.get(segment.marker);

        if (!source) {
          return <span key={index}>[{segment.marker}]</span>;
        }

        return (
          <button
            key={index}
            type="button"
            onClick={() => onSelect(source)}
            title={describeSource(source)}
            aria-label={`Belegstelle ${segment.marker} anzeigen: ${describeSource(source)}`}
            className="mx-0.5 rounded bg-neutral-200 px-1 align-baseline text-xs font-medium text-neutral-700 transition hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            {segment.marker}
          </button>
        );
      })}
    </p>
  );
}

/**
 * Zeigt die Belegstelle im Wortlaut und den Weg zum Original.
 *
 * Natives dialog-Element: kein zusaetzliches Paket, Fokusfalle und
 * Escape-Taste bringt der Browser mit. In der zweispaltigen Ansicht waere
 * eine Seitenleiste mit 20rem fuer einen Abschnitt dieser Laenge zu schmal.
 */
export function CitationDialog({
  source,
  onClose,
}: {
  source: ChatSource;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkFehler, setLinkFehler] = useState<string | null>(null);

  // Einmal beim Einhaengen oeffnen. showModal auf einem bereits offenen
  // Dialog wirft, deshalb die Abfrage.
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  /**
   * Schliesst den Dialog und meldet es dem Aufrufer.
   *
   * Beides ausdruecklich, statt sich auf das close-Ereignis zu verlassen:
   * es steigt nicht auf, wird von Reacts Delegation nicht gefangen, und in
   * automatisierten Umgebungen feuert es bei einem programmatischen close()
   * gar nicht. Bliebe die Meldung aus, haenge die Komponente weiter im Baum,
   * der Zustand zeigte auf denselben Beleg, und ein zweiter Klick auf
   * dieselbe Nummer bewirkte nichts.
   */
  const schliessen = useCallback(() => {
    dialog.current?.close();
    onClose();
  }, [onClose]);

  // Escape loest 'cancel' aus. Der Browser schliesst danach selbst, wir
  // muessen nur den Zustand nachziehen.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;

    element.addEventListener("cancel", onClose);
    element.addEventListener("close", onClose);
    return () => {
      element.removeEventListener("cancel", onClose);
      element.removeEventListener("close", onClose);
    };
  }, [onClose]);

  // Die Adresse erst beim Oeffnen holen: signierte URLs sind kurzlebig,
  // und die meisten Belege werden nie im Original aufgeschlagen.
  useEffect(() => {
    let verworfen = false;

    getSourceLinkAction(source.sourceId, source.page)
      .then((ergebnis) => {
        if (verworfen) return;
        if (ergebnis.error) setLinkFehler(ergebnis.error);
        else setLink(ergebnis.url);
      })
      .catch((fehler) => {
        if (verworfen) return;
        console.error("Link zur Quelle fehlgeschlagen:", fehler);
        setLinkFehler("Die Quelle konnte nicht geoeffnet werden.");
      });

    return () => {
      verworfen = true;
    };
  }, [source.sourceId, source.page]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="beleg-titel"
      className="w-[min(38rem,92vw)] rounded-xl border border-neutral-200 bg-background p-0 text-foreground backdrop:bg-neutral-900/40 dark:border-neutral-800"
    >
      <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
        <div>
          <p
            id="beleg-titel"
            className="text-sm font-semibold"
            title={source.title}
          >
            {source.title}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {SOURCE_TYPE_LABELS[source.sourceType]}
            {source.page === null ? "" : `, Seite ${source.page}`}
            {` · Beleg [${source.marker}]`}
            {source.similarity === null
              ? ""
              : ` · Aehnlichkeit ${source.similarity.toFixed(2)}`}
          </p>
        </div>

        <button
          type="button"
          onClick={schliessen}
          aria-label="Belegstelle schliessen"
          className="shrink-0 rounded-lg px-2 py-1 text-sm text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          Schliessen
        </button>
      </div>

      <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {source.content}
        </p>
      </div>

      <div className="border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
        {linkFehler ? (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {linkFehler}
          </p>
        ) : link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs font-medium underline underline-offset-2 transition hover:text-neutral-500 dark:hover:text-neutral-400"
          >
            {source.sourceType === "url"
              ? "Seite im Original oeffnen"
              : source.page === null
                ? "Datei oeffnen"
                : `Datei auf Seite ${source.page} oeffnen`}
          </a>
        ) : (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Adresse wird geholt ...
          </p>
        )}
      </div>
    </dialog>
  );
}
