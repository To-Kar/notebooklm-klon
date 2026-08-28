"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  generateAudioAction,
  getAudioUrlAction,
} from "@/app/notebooks/audio-actions";
import type { AudioStatus } from "@/lib/audio/store";

/**
 * Die gesprochene Zusammenfassung.
 *
 * Rund eine halbe Minute, zwei Stimmen. Bewusst kurz: Skript und
 * Sprachausgabe laufen in einer Serverless-Function mit 60 Sekunden, und die
 * Sprachausgabe braucht gemessen etwa 0,76 Sekunden je Sekunde Audio.
 */
export function AudioPanel({
  notebookId,
  status,
  script,
  durationSeconds,
  storedError,
  canGenerate,
}: {
  notebookId: string;
  status: AudioStatus | null;
  script: string | null;
  durationSeconds: number | null;
  storedError: string | null;
  /** Ohne ausgewaehlte, verarbeitete Quelle gibt es nichts zu besprechen. */
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [laeuft, startTransition] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  /**
   * Adresse erst holen, wenn es etwas abzuspielen gibt.
   *
   * Kein Zuruecksetzen im Effekt - das leitet sich weiter unten beim Rendern
   * aus dem Status ab. Zustand im Effekt zu setzen ist in React 19 nicht mehr
   * das empfohlene Muster, und hier braucht es das auch nicht.
   */
  useEffect(() => {
    if (status !== "ready") return;

    let verworfen = false;

    getAudioUrlAction(notebookId)
      .then((ergebnis) => {
        if (verworfen) return;
        if (ergebnis.url) setUrl(ergebnis.url);
      })
      .catch((error) => console.error("Audio-Adresse fehlgeschlagen:", error));

    return () => {
      verworfen = true;
    };
  }, [notebookId, status]);

  function erzeugen() {
    setFehler(null);

    startTransition(async () => {
      const ergebnis = await generateAudioAction(notebookId);

      if (ergebnis.error) setFehler(ergebnis.error);
      router.refresh();
    });
  }

  const angezeigterFehler = fehler ?? (status === "error" ? storedError : null);

  // Waehrend eines neuen Laufs zeigt der Status nicht mehr 'ready' - dann
  // gehoert auch die alte Adresse nicht mehr angezeigt.
  const abspielUrl = status === "ready" ? url : null;
  const knopfText = laeuft
    ? "Wird erzeugt ..."
    : status === "ready"
      ? "Neu erzeugen"
      : "Zusammenfassung erzeugen";

  return (
    <section className="flex min-h-[28rem] flex-col gap-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Gesprochene Zusammenfassung</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Zwei Stimmen sprechen ueber die ausgewaehlten Quellen, rund eine halbe
          Minute.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={erzeugen}
          disabled={laeuft || !canGenerate}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {knopfText}
        </button>

        {!canGenerate ? (
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            Waehl zuerst eine verarbeitete Quelle aus.
          </span>
        ) : null}

        {laeuft ? (
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            Das dauert etwa eine halbe Minute.
          </span>
        ) : null}
      </div>

      {angezeigterFehler ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {angezeigterFehler}
        </p>
      ) : null}

      {status === "ready" ? (
        <div className="space-y-3">
          {abspielUrl ? (
            <audio
              controls
              src={abspielUrl}
              className="w-full"
              aria-label="Gesprochene Zusammenfassung"
            />
          ) : (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Aufnahme wird geladen ...
            </p>
          )}

          {durationSeconds ? (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              {durationSeconds.toFixed(0)} Sekunden
            </p>
          ) : null}

          {script ? (
            <div className="space-y-1">
              {/*
                Das Skript steht dabei, weil es zum Kern des Produkts passt:
                wer hoert, was ein Modell erzeugt hat, soll nachlesen koennen,
                was es gesagt hat.
              */}
              <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Skript
              </h3>
              <p className="whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-sm leading-relaxed dark:bg-neutral-900">
                {script}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
