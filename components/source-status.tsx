"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ingestSourceAction } from "@/app/notebooks/ingest-actions";
import {
  SOURCE_STATUS_LABELS,
  type SourceStatus,
} from "@/lib/source-limits";

/**
 * Merkt sich ueber Remounts hinweg, welche Quellen dieser Tab schon
 * angestossen hat.
 *
 * React fuehrt Effekte im Entwicklungsmodus doppelt aus. Die Datenbank
 * faengt Doppellaeufe zwar ab (claimSource dreht den Status bedingt), aber
 * ein zweiter Aufruf waere trotzdem verschwendete Zeit und Kontingent.
 */
const angestossen = new Set<string>();

const statusClass: Record<SourceStatus, string> = {
  pending: "text-neutral-500 dark:text-neutral-400",
  processing: "text-neutral-500 dark:text-neutral-400",
  ready: "text-emerald-600 dark:text-emerald-400",
  error: "text-red-600 dark:text-red-400",
};

/**
 * Zeigt den Verarbeitungsstand einer Quelle und stoesst sie an.
 *
 * Neue Quellen kommen auf 'pending' an und werden hier automatisch
 * verarbeitet. Nach einem Fehler kann von Hand erneut angestossen werden.
 */
export function SourceStatusBadge({
  sourceId,
  status,
  storedError,
}: {
  sourceId: string;
  status: SourceStatus;
  /** Grund des letzten Fehlversuchs aus der Datenbank. */
  storedError: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const laeuft = useRef(false);

  function verarbeite() {
    if (laeuft.current) return;

    laeuft.current = true;
    angestossen.add(sourceId);
    setError(null);

    startTransition(async () => {
      try {
        const ergebnis = await ingestSourceAction(sourceId);
        if (ergebnis.error) setError(ergebnis.error);
      } catch (fehler) {
        console.error("Verarbeitung fehlgeschlagen:", fehler);
        setError("Die Verarbeitung konnte nicht gestartet werden.");
      } finally {
        laeuft.current = false;
        router.refresh();
      }
    });
  }

  useEffect(() => {
    if (status === "pending" && !angestossen.has(sourceId)) {
      verarbeite();
    }
    // Absichtlich nur an sourceId und status gebunden: verarbeite() haengt an
    // Router und Transition und wuerde den Effekt sonst erneut ausloesen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, status]);

  const angezeigterStatus: SourceStatus =
    isPending && status === "pending" ? "processing" : status;

  /**
   * Die Meldung des laufenden Versuchs hat Vorrang vor der gespeicherten.
   * Wer gerade auf "Erneut versuchen" gedrueckt hat, will sehen, woran es
   * DIESES Mal lag - nicht, woran es beim letzten Mal lag.
   */
  const angezeigterFehler = error ?? (status === "error" ? storedError : null);

  return (
    <>
      <span className={statusClass[angezeigterStatus]}>
        {SOURCE_STATUS_LABELS[angezeigterStatus]}
      </span>

      {status === "error" && !isPending ? (
        <button
          type="button"
          onClick={verarbeite}
          className="text-neutral-500 underline underline-offset-2 transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          Erneut versuchen
        </button>
      ) : null}

      {angezeigterFehler ? (
        <span role="alert" className="basis-full text-red-600 dark:text-red-400">
          {angezeigterFehler}
        </span>
      ) : null}
    </>
  );
}
