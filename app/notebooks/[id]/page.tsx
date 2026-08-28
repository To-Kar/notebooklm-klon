import Link from "next/link";
import { notFound } from "next/navigation";

import { AddSourceForm } from "@/components/add-source-form";
import type { ChatBlocker, ChatEntry } from "@/components/chat-panel";
import {
  Workspace,
  type AudioState,
  type MindmapState,
} from "@/components/workspace";
import {
  DeleteNotebookButton,
  DeleteSourceButton,
} from "@/components/delete-controls";
import {
  SelectAllSources,
  SourceCheckbox,
} from "@/components/source-selection";
import { SourceStatusBadge } from "@/components/source-status";
import { SourceSummary } from "@/components/source-summary";
import { formatNotebookDate, getNotebook } from "@/lib/notebooks";
import { SOURCE_TYPE_LABELS } from "@/lib/source-limits";
import { listMessages } from "@/lib/messages";
import { getAudioOverview } from "@/lib/audio/store";
import { getMindmap } from "@/lib/mindmap/store";
import { listNotes } from "@/lib/notes";
import { listSources, type Source } from "@/lib/sources";

/** Wie auf der Startseite: der Stand kommt aus der DB, nicht aus dem Build. */
export const dynamic = "force-dynamic";

/**
 * Die Ingestion laeuft in einer Server Action dieser Route: extrahieren,
 * chunken, embedden. Bei zwei Embedding-Batches kostet das gemessen rund
 * 25 Sekunden, das Standardlimit von 10 Sekunden reicht nicht.
 */
export const maxDuration = 60;

function SourceItem({ source }: { source: Source }) {
  return (
    <li
      className={`flex gap-2 rounded-lg border px-3 py-2 transition ${
        source.selected
          ? "border-neutral-200 dark:border-neutral-800"
          : // Abgewaehlte Quellen bleiben sichtbar, treten aber zurueck.
            "border-neutral-200/60 opacity-55 dark:border-neutral-800/60"
      }`}
    >
      <SourceCheckbox
        sourceId={source.id}
        selected={source.selected}
        title={source.title}
        disabled={source.status !== "ready"}
      />

      <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium" title={source.title}>
        {source.title}
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        <span className="text-neutral-500 dark:text-neutral-400">
          {SOURCE_TYPE_LABELS[source.type]}
        </span>
        <span className="text-neutral-300 dark:text-neutral-700">/</span>
        <SourceStatusBadge
          sourceId={source.id}
          status={source.status}
          storedError={source.error_message}
        />
        <span className="text-neutral-300 dark:text-neutral-700">/</span>
        <DeleteSourceButton sourceId={source.id} />
      </p>

      {source.summary ? (
        <SourceSummary summary={source.summary} topics={source.topics} />
      ) : null}
      </div>
    </li>
  );
}

export default async function NotebookPage({
  params,
}: PageProps<"/notebooks/[id]">) {
  const { id } = await params;
  const notebook = await getNotebook(id);

  if (!notebook) {
    notFound();
  }

  // Quellen und Verlauf zusammen holen, nicht nacheinander.
  const [sources, messages, notes, audioOverview, mindmapRow] =
    await Promise.all([
      listSources(notebook.id),
      listMessages(notebook.id),
      listNotes(notebook.id),
      getAudioOverview(notebook.id),
      getMindmap(notebook.id),
    ]);

  // Zwischen "keine Quellen" und "keine ausgewaehlt" unterscheiden - sonst
  // schickt die Meldung den Nutzer in die falsche Richtung.
  const verarbeitete = sources.filter((source) => source.status === "ready");
  const blocker: ChatBlocker =
    verarbeitete.length === 0
      ? "keine-quellen"
      : verarbeitete.some((source) => source.selected)
        ? null
        : "keine-auswahl";

  const audio: AudioState = {
    status: audioOverview?.status ?? null,
    script: audioOverview?.script ?? null,
    durationSeconds: audioOverview?.duration_seconds ?? null,
    error: audioOverview?.error_message ?? null,
    // Dieselbe Bedingung wie beim Chat: ohne ausgewaehlte, verarbeitete
    // Quelle gibt es nichts zu besprechen.
    canGenerate: blocker === null,
  };

  const mindmap: MindmapState = {
    status: mindmapRow?.status ?? null,
    data: mindmapRow?.data ?? null,
    error: mindmapRow?.error_message ?? null,
    canGenerate: blocker === null,
  };

  const initialEntries: ChatEntry[] = messages.map((message) => ({
    role: message.role,
    content: message.content,
    sources: message.citations,
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <Link
        href="/"
        className="text-sm text-neutral-500 transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        &larr; Alle Notebooks
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {notebook.title}
          </h1>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Erstellt am {formatNotebookDate(notebook.created_at)}
          </p>
        </div>

        <DeleteNotebookButton
          notebookId={notebook.id}
          sourceCount={sources.length}
        />
      </header>

      <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <aside className="space-y-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">Quellen</h2>
            {sources.length > 0 ? (
              <SelectAllSources
                notebookId={notebook.id}
                alleAusgewaehlt={sources.every((source) => source.selected)}
              />
            ) : null}
          </div>

          <AddSourceForm notebookId={notebook.id} />

          {sources.length === 0 ? (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Noch keine Quellen. Lad eine Datei hoch oder fueg eine URL hinzu.
            </p>
          ) : (
            <ul className="space-y-2">
              {sources.map((source) => (
                <SourceItem key={source.id} source={source} />
              ))}
            </ul>
          )}
        </aside>

        <Workspace
          notebookId={notebook.id}
          blocker={blocker}
          initialEntries={initialEntries}
          notes={notes}
          audio={audio}
          mindmap={mindmap}
        />
      </div>
    </main>
  );
}
