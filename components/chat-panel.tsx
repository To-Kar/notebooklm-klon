"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type { ChatSource, ChatStreamEvent } from "@/app/api/chat/route";
import { clearConversationAction } from "@/app/notebooks/conversation-actions";
import { saveAnswerAsNoteAction } from "@/app/notebooks/note-actions";
import {
  AnswerWithCitations,
  CitationDialog,
} from "@/components/citation";
import { ConfirmButton } from "@/components/confirm-button";
import { describeSource, usedSources } from "@/lib/chat/citations";

/**
 * Der Chat eines Notebooks.
 *
 * Der Verlauf kommt vom Server und wird dort auch fortgeschrieben. Der
 * Browser haelt ihn nur, solange die Seite offen ist, und schickt bei einer
 * neuen Frage ausschliesslich diese - alles andere weiss der Server besser.
 */

export type ChatEntry = {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
};

/**
 * Sichert eine Antwort als Notiz - mitsamt ihren Belegen.
 *
 * Nur die tatsaechlich zitierten, dieselbe Auswahl wie in der Belegliste.
 * Alle acht Auszuege mitzuspeichern waere Ballast, den niemand liest.
 */
function SaveAsNoteButton({
  notebookId,
  entry,
}: {
  notebookId: string;
  entry: ChatEntry;
}) {
  const [gespeichert, setGespeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, startTransition] = useTransition();

  function speichern() {
    setFehler(null);

    startTransition(async () => {
      const ergebnis = await saveAnswerAsNoteAction(
        notebookId,
        entry.content,
        usedSources(entry.content, entry.sources ?? []),
      );

      if (ergebnis.error) {
        setFehler(ergebnis.error);
        return;
      }

      setGespeichert(true);
    });
  }

  if (gespeichert) {
    return (
      <span className="text-xs text-neutral-500 dark:text-neutral-400">
        Als Notiz gespeichert
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={speichern}
        disabled={laeuft}
        className="text-xs text-neutral-500 underline underline-offset-2 transition hover:text-neutral-900 disabled:opacity-60 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        {laeuft ? "Wird gespeichert ..." : "Als Notiz speichern"}
      </button>

      {fehler ? (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {fehler}
        </span>
      ) : null}
    </span>
  );
}

/** Die Belegliste unter einer Antwort. Auch von hier kommt man zur Stelle. */
function SourceList({
  entry,
  onSelect,
}: {
  entry: ChatEntry;
  onSelect: (source: ChatSource) => void;
}) {
  const belege = usedSources(entry.content, entry.sources ?? []);

  if (belege.length === 0) {
    return null;
  }

  return (
    <ol className="space-y-1 border-t border-neutral-200 pt-2 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
      {belege.map((source) => (
        <li key={source.chunkId}>
          <button
            type="button"
            onClick={() => onSelect(source)}
            className="text-left transition hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            <span className="font-medium">[{source.marker}]</span>{" "}
            {describeSource(source)}
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Warum gerade nicht gefragt werden kann - oder null, wenn es geht. */
export type ChatBlocker = "keine-quellen" | "keine-auswahl" | null;

export function ChatPanel({
  notebookId,
  blocker,
  initialEntries,
  starterQuestions,
}: {
  notebookId: string;
  blocker: ChatBlocker;
  /** Der gespeicherte Verlauf, vom Server geladen. */
  initialEntries: ChatEntry[];
  /**
   * Einstiegsfragen aus den ausgewaehlten Quellen.
   *
   * Nur im leeren Chat sichtbar: wer schon gefragt hat, weiss, was er
   * fragen will, und braucht keine Vorschlaege mehr.
   */
  starterQuestions: string[];
}) {
  const [entries, setEntries] = useState<ChatEntry[]>(initialEntries);
  const [frage, setFrage] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  /** Die gerade geoeffnete Belegstelle, null wenn keine offen ist. */
  const [beleg, setBeleg] = useState<ChatSource | null>(null);

  const kannFragen = blocker === null;

  const abbruch = useRef<AbortController | null>(null);
  const ende = useRef<HTMLDivElement | null>(null);

  // Beim Verlassen der Seite die laufende Anfrage abbrechen.
  useEffect(() => () => abbruch.current?.abort(), []);

  useEffect(() => {
    ende.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  function frageStellen(event: React.FormEvent) {
    event.preventDefault();
    void stelleFrage(frage);
  }

  /**
   * Schickt eine Frage ab.
   *
   * Getrennt vom Formular-Ereignis, damit die Einstiegsfragen denselben Weg
   * nehmen. Eine zweite Fassung dieser Funktion waere die Stelle, an der
   * spaeter genau ein Zweig vergessen wird.
   */
  async function stelleFrage(eingabe: string) {
    const text = eingabe.trim();
    if (text.length === 0 || laeuft || !kannFragen) return;

    const verlauf: ChatEntry[] = [
      ...entries,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ];

    setEntries(verlauf);
    setFrage("");
    setFehler(null);
    setLaeuft(true);

    const controller = new AbortController();
    abbruch.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        // Nur die Frage: den Verlauf kennt der Server aus der Datenbank.
        body: JSON.stringify({ notebookId, question: text }),
      });

      if (!response.ok || !response.body) {
        const info = await response.json().catch(() => null);
        throw new Error(info?.message ?? "Die Anfrage ist fehlgeschlagen.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let puffer = "";

      const letzteAktualisieren = (
        aendern: (entry: ChatEntry) => ChatEntry,
      ) => {
        setEntries((bisher) => {
          const kopie = [...bisher];
          kopie[kopie.length - 1] = aendern(kopie[kopie.length - 1]);
          return kopie;
        });
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        puffer += decoder.decode(value, { stream: true });

        // Eine JSON-Zeile je Ereignis; die letzte kann unvollstaendig sein.
        const zeilen = puffer.split("\n");
        puffer = zeilen.pop() ?? "";

        for (const zeile of zeilen) {
          if (zeile.trim().length === 0) continue;

          let ereignis: ChatStreamEvent;
          try {
            ereignis = JSON.parse(zeile) as ChatStreamEvent;
          } catch {
            continue;
          }

          if (ereignis.type === "sources") {
            letzteAktualisieren((entry) => ({
              ...entry,
              sources: ereignis.sources,
            }));
          } else if (ereignis.type === "delta") {
            letzteAktualisieren((entry) => ({
              ...entry,
              content: entry.content + ereignis.text,
            }));
          } else if (ereignis.type === "error") {
            setFehler(ereignis.message);
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;

      console.error("Chat fehlgeschlagen:", error);
      setFehler(
        error instanceof Error
          ? error.message
          : "Die Anfrage ist fehlgeschlagen.",
      );
    } finally {
      setLaeuft(false);
      abbruch.current = null;
    }
  }

  return (
    <section className="flex min-h-[28rem] flex-col rounded-xl border border-neutral-200 dark:border-neutral-800">
      {entries.length > 0 ? (
        <div className="flex justify-end border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <ConfirmButton
            size="klein"
            label="Gespraech leeren"
            question="Gespraech mit allen Antworten und Belegen leeren?"
            action={() => clearConversationAction(notebookId)}
            onDone={() => setEntries([])}
          />
        </div>
      ) : null}

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
            <p className="text-sm font-medium">Frag deine Quellen</p>
            <p className="mt-1 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
              {blocker === null
                ? "Jede Antwort verweist mit Nummern auf die Abschnitte, aus denen sie stammt."
                : blocker === "keine-auswahl"
                  ? "Waehl links mindestens eine Quelle aus, dann kannst du Fragen stellen."
                  : "Sobald eine Quelle verarbeitet ist, kannst du hier Fragen stellen."}
            </p>

            {kannFragen && starterQuestions.length > 0 ? (
              <div className="mt-5 w-full max-w-lg">
                <p className="text-xs text-neutral-400 dark:text-neutral-500">
                  Aus deinen Quellen
                </p>

                <ul className="mt-2 space-y-1.5">
                  {starterQuestions.map((vorschlag) => (
                    <li key={vorschlag}>
                      <button
                        type="button"
                        onClick={() => void stelleFrage(vorschlag)}
                        disabled={laeuft}
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm transition hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-800 dark:hover:border-neutral-600 dark:hover:bg-neutral-900"
                      >
                        {vorschlag}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={index}
              className={
                entry.role === "user" ? "flex justify-end" : "flex justify-start"
              }
            >
              <div
                className={
                  entry.role === "user"
                    ? "max-w-[85%] rounded-2xl rounded-br-sm bg-neutral-900 px-4 py-2 text-sm text-neutral-50 dark:bg-neutral-100 dark:text-neutral-900"
                    : "max-w-[85%] space-y-2"
                }
              >
                {entry.role === "user" ? (
                  <p className="whitespace-pre-wrap text-sm">{entry.content}</p>
                ) : entry.content.length === 0 ? (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    Sucht in den Quellen ...
                  </p>
                ) : (
                  <AnswerWithCitations
                    content={entry.content}
                    sources={entry.sources ?? []}
                    onSelect={setBeleg}
                  />
                )}

                {entry.role === "assistant" ? (
                  <SourceList entry={entry} onSelect={setBeleg} />
                ) : null}

                {entry.role === "assistant" && entry.content.length > 0 ? (
                  <SaveAsNoteButton notebookId={notebookId} entry={entry} />
                ) : null}
              </div>
            </div>
          ))
        )}

        <div ref={ende} />
      </div>

      {fehler ? (
        <p
          role="alert"
          className="border-t border-neutral-200 px-4 py-2 text-sm text-red-600 dark:border-neutral-800 dark:text-red-400"
        >
          {fehler}
        </p>
      ) : null}

      <form
        onSubmit={frageStellen}
        className="flex gap-2 border-t border-neutral-200 p-3 dark:border-neutral-800"
      >
        <input
          type="text"
          value={frage}
          onChange={(event) => setFrage(event.target.value)}
          placeholder={
            blocker === null
              ? "Frag etwas zu deinen Quellen"
              : blocker === "keine-auswahl"
                ? "Erst eine Quelle auswaehlen"
                : "Erst eine Quelle hinzufuegen"
          }
          aria-label="Frage an die Quellen"
          disabled={!kannFragen || laeuft}
          className="flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-500 disabled:opacity-60 dark:border-neutral-700 dark:placeholder:text-neutral-600 dark:focus:border-neutral-500"
        />
        <button
          type="submit"
          disabled={!kannFragen || laeuft || frage.trim().length === 0}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {laeuft ? "Antwortet ..." : "Fragen"}
        </button>
      </form>

      {beleg ? (
        // key: ein Wechsel des Belegs baut den Dialog neu auf, statt einen
        // veralteten Link stehen zu lassen.
        <CitationDialog
          key={beleg.chunkId}
          source={beleg}
          onClose={() => setBeleg(null)}
        />
      ) : null}
    </section>
  );
}
