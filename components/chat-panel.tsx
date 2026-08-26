"use client";

import { useEffect, useRef, useState } from "react";

import type { ChatSource, ChatStreamEvent } from "@/app/api/chat/route";

/**
 * Der Chat eines Notebooks.
 *
 * Der Verlauf lebt bewusst nur im Browser: es gibt keine messages-Tabelle,
 * und ein Reload beginnt ein neues Gespraech. Eine bewusste Demo-Entscheidung.
 */

type ChatEntry = {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
};

/** Beschreibt eine Belegstelle so, wie sie unter der Antwort steht. */
function describeSource(source: ChatSource): string {
  return source.page === null
    ? source.title
    : `${source.title}, Seite ${source.page}`;
}

/**
 * Nur die Belege zeigen, auf die sich die Antwort wirklich beruft.
 *
 * Der Kontext enthaelt acht Auszuege, zitiert werden meist zwei oder drei.
 * Alle aufzulisten macht die Belegliste wertlos: bei mehreren Auszuegen aus
 * derselben Quelle stuenden dort sechs identische Zeilen, und der Nutzer
 * koennte nicht erkennen, worauf die Antwort tatsaechlich fusst.
 */
function usedSources(content: string, sources: ChatSource[]): ChatSource[] {
  const marker = new Set(
    [...content.matchAll(/\[(\d+)\]/g)].map((treffer) => Number(treffer[1])),
  );

  return sources.filter((source) => marker.has(source.marker));
}

/** Die Belegliste unter einer Antwort. */
function SourceList({ entry }: { entry: ChatEntry }) {
  const belege = usedSources(entry.content, entry.sources ?? []);

  if (belege.length === 0) {
    return null;
  }

  return (
    <ol className="space-y-1 border-t border-neutral-200 pt-2 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
      {belege.map((source) => (
        <li key={source.chunkId}>
          <span className="font-medium">[{source.marker}]</span>{" "}
          {describeSource(source)}
        </li>
      ))}
    </ol>
  );
}

export function ChatPanel({
  notebookId,
  hasReadySources,
}: {
  notebookId: string;
  hasReadySources: boolean;
}) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [frage, setFrage] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const abbruch = useRef<AbortController | null>(null);
  const ende = useRef<HTMLDivElement | null>(null);

  // Beim Verlassen der Seite die laufende Anfrage abbrechen.
  useEffect(() => () => abbruch.current?.abort(), []);

  useEffect(() => {
    ende.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  async function frageStellen(event: React.FormEvent) {
    event.preventDefault();

    const text = frage.trim();
    if (text.length === 0 || laeuft) return;

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
        body: JSON.stringify({
          notebookId,
          // Die leere Antwort am Ende gehoert nicht in die Anfrage.
          messages: verlauf
            .slice(0, -1)
            .map(({ role, content }) => ({ role, content })),
        }),
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
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
            <p className="text-sm font-medium">Frag deine Quellen</p>
            <p className="mt-1 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
              {hasReadySources
                ? "Jede Antwort verweist mit Nummern auf die Abschnitte, aus denen sie stammt."
                : "Sobald eine Quelle verarbeitet ist, kannst du hier Fragen stellen."}
            </p>
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
                {entry.role === "assistant" && entry.content.length === 0 ? (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    Sucht in den Quellen ...
                  </p>
                ) : (
                  <p className="whitespace-pre-wrap text-sm">{entry.content}</p>
                )}

                {entry.role === "assistant" ? (
                  <SourceList entry={entry} />
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
            hasReadySources
              ? "Frag etwas zu deinen Quellen"
              : "Erst eine Quelle hinzufuegen"
          }
          aria-label="Frage an die Quellen"
          disabled={!hasReadySources || laeuft}
          className="flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-500 disabled:opacity-60 dark:border-neutral-700 dark:placeholder:text-neutral-600 dark:focus:border-neutral-500"
        />
        <button
          type="submit"
          disabled={!hasReadySources || laeuft || frage.trim().length === 0}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {laeuft ? "Antwortet ..." : "Fragen"}
        </button>
      </form>
    </section>
  );
}
