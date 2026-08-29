"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { ChatSource } from "@/app/api/chat/route";
import {
  createNoteAction,
  deleteNoteAction,
} from "@/app/notebooks/note-actions";
import { CitationDialog } from "@/components/citation";
import { ConfirmButton } from "@/components/confirm-button";
import { describeSource } from "@/lib/chat/citations";

/**
 * Die Notizen eines Notebooks.
 *
 * Gesicherte Antworten behalten ihre Belege und bleiben anklickbar - eine
 * Notiz wird ja gerade aufgehoben, um spaeter nachschlagen zu koennen. Eine
 * Notiz mit toten Verweisen waere in diesem Produkt besonders daneben.
 */

export type NoteEntry = {
  id: string;
  origin: "manual" | "answer";
  content: string;
  citations: ChatSource[];
  created_at: string;
};

const datumsformat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});

export function NotesPanel({
  notebookId,
  notes,
}: {
  notebookId: string;
  notes: NoteEntry[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, startTransition] = useTransition();
  const [beleg, setBeleg] = useState<ChatSource | null>(null);

  function anlegen(event: React.FormEvent) {
    event.preventDefault();

    const inhalt = text.trim();
    if (inhalt.length === 0 || laeuft) return;

    setFehler(null);

    startTransition(async () => {
      const ergebnis = await createNoteAction(notebookId, inhalt);

      if (ergebnis.error) {
        setFehler(ergebnis.error);
        return;
      }

      setText("");
      router.refresh();
    });
  }

  return (
    <section className="flex min-h-[28rem] flex-col rounded-xl border border-neutral-200 dark:border-neutral-800">
      <form
        onSubmit={anlegen}
        className="space-y-2 border-b border-neutral-200 p-3 dark:border-neutral-800"
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          placeholder="Eigene Notiz schreiben"
          aria-label="Eigene Notiz"
          disabled={laeuft}
          className="w-full resize-y rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-500 disabled:opacity-60 dark:border-neutral-700 dark:placeholder:text-neutral-600 dark:focus:border-neutral-500"
        />

        <div className="flex items-center justify-between gap-3">
          {fehler ? (
            <span role="alert" className="text-sm text-red-600 dark:text-red-400">
              {fehler}
            </span>
          ) : (
            <span />
          )}

          <button
            type="submit"
            disabled={laeuft || text.trim().length === 0}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            {laeuft ? "Wird gespeichert ..." : "Notiz speichern"}
          </button>
        </div>
      </form>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {notes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
            <p className="text-sm font-medium">Noch keine Notizen</p>
            <p className="mt-1 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
              Schreib oben eine Notiz, oder sichere eine Antwort aus dem Chat —
              die behaelt ihre Belege.
            </p>
          </div>
        ) : (
          notes.map((note) => (
            <article
              key={note.id}
              className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800"
            >
              <p className="whitespace-pre-wrap text-sm">{note.content}</p>

              {note.citations.length > 0 ? (
                <ol className="mt-2 space-y-1 border-t border-neutral-200 pt-2 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  {note.citations.map((source) => (
                    <li key={source.chunkId}>
                      <button
                        type="button"
                        onClick={() => setBeleg(source)}
                        className="text-left transition hover:text-neutral-900 dark:hover:text-neutral-100"
                      >
                        <span className="font-medium">[{source.marker}]</span>{" "}
                        {describeSource(source)}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : null}

              <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                <span>
                  {note.origin === "answer" ? "Aus dem Chat" : "Eigene Notiz"}
                </span>
                <span>·</span>
                <span>{datumsformat.format(new Date(note.created_at))}</span>
                <span>·</span>
                <ConfirmButton
                  size="klein"
                  label="Löschen"
                  question="Notiz löschen?"
                  action={() => deleteNoteAction(note.id)}
                />
              </p>
            </article>
          ))
        )}
      </div>

      {beleg ? (
        <CitationDialog
          key={beleg.chunkId}
          source={beleg}
          onClose={() => setBeleg(null)}
        />
      ) : null}
    </section>
  );
}
