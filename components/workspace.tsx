"use client";

import { useState } from "react";

import { ChatPanel, type ChatBlocker, type ChatEntry } from "@/components/chat-panel";
import { AudioPanel } from "@/components/audio-panel";
import { NotesPanel, type NoteEntry } from "@/components/notes-panel";
import type { AudioStatus } from "@/lib/audio/store";

/**
 * Die rechte Spalte: Chat oder Notizen.
 *
 * Ein Umschalter statt einer dritten Spalte. Bei 20rem Seitenleiste waere die
 * dritte Spalte zu schmal fuer Notizen mit Belegen - und NotebookLM trennt
 * Chat und Studio ebenfalls, statt beides nebeneinanderzuquetschen.
 */
export type AudioState = {
  status: AudioStatus | null;
  script: string | null;
  durationSeconds: number | null;
  error: string | null;
  canGenerate: boolean;
};

export function Workspace({
  notebookId,
  blocker,
  initialEntries,
  notes,
  audio,
}: {
  notebookId: string;
  blocker: ChatBlocker;
  initialEntries: ChatEntry[];
  notes: NoteEntry[];
  audio: AudioState;
}) {
  const [ansicht, setAnsicht] = useState<"chat" | "notizen" | "audio">("chat");

  const reiterClass = (aktiv: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm transition ${
      aktiv
        ? "bg-neutral-900 font-medium text-neutral-50 dark:bg-neutral-100 dark:text-neutral-900"
        : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
    }`;

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Chat oder Notizen" className="flex gap-1">
        <button
          type="button"
          role="tab"
          aria-selected={ansicht === "chat"}
          onClick={() => setAnsicht("chat")}
          className={reiterClass(ansicht === "chat")}
        >
          Chat
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={ansicht === "notizen"}
          onClick={() => setAnsicht("notizen")}
          className={reiterClass(ansicht === "notizen")}
        >
          Notizen{notes.length > 0 ? ` (${notes.length})` : ""}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={ansicht === "audio"}
          onClick={() => setAnsicht("audio")}
          className={reiterClass(ansicht === "audio")}
        >
          Audio
        </button>
      </div>

      {/*
        Beide Ansichten bleiben eingehaengt, nur eine ist sichtbar. Wuerde man
        den Chat beim Wechseln aushaengen, brichen eine laufende Antwort ab
        und der ungesendete Text im Eingabefeld waere weg.
      */}
      <div hidden={ansicht !== "chat"}>
        <ChatPanel
          notebookId={notebookId}
          blocker={blocker}
          initialEntries={initialEntries}
        />
      </div>

      <div hidden={ansicht !== "notizen"}>
        <NotesPanel notebookId={notebookId} notes={notes} />
      </div>

      <div hidden={ansicht !== "audio"}>
        <AudioPanel
          notebookId={notebookId}
          status={audio.status}
          script={audio.script}
          durationSeconds={audio.durationSeconds}
          storedError={audio.error}
          canGenerate={audio.canGenerate}
        />
      </div>
    </div>
  );
}
