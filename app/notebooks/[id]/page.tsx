import Link from "next/link";
import { notFound } from "next/navigation";

import { AddSourceForm } from "@/components/add-source-form";
import { ChatPanel } from "@/components/chat-panel";
import {
  DeleteNotebookButton,
  DeleteSourceButton,
} from "@/components/delete-controls";
import { SourceStatusBadge } from "@/components/source-status";
import { formatNotebookDate, getNotebook } from "@/lib/notebooks";
import { SOURCE_TYPE_LABELS } from "@/lib/source-limits";
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
    <li className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
      <p className="truncate text-sm font-medium" title={source.title}>
        {source.title}
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        <span className="text-neutral-500 dark:text-neutral-400">
          {SOURCE_TYPE_LABELS[source.type]}
        </span>
        <span className="text-neutral-300 dark:text-neutral-700">/</span>
        <SourceStatusBadge sourceId={source.id} status={source.status} />
        <span className="text-neutral-300 dark:text-neutral-700">/</span>
        <DeleteSourceButton sourceId={source.id} />
      </p>
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

  const sources = await listSources(notebook.id);

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
          <h2 className="text-sm font-semibold">Quellen</h2>

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

        {/* Klickbare Zitate folgen in Arbeitspaket 5. */}
        <ChatPanel
          notebookId={notebook.id}
          hasReadySources={sources.some((source) => source.status === "ready")}
        />
      </div>
    </main>
  );
}
