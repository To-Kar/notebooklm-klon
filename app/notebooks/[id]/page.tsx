import Link from "next/link";
import { notFound } from "next/navigation";

import { AddSourceForm } from "@/components/add-source-form";
import { formatNotebookDate, getNotebook } from "@/lib/notebooks";
import {
  SOURCE_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
  listSources,
  type Source,
} from "@/lib/sources";

/** Wie auf der Startseite: der Stand kommt aus der DB, nicht aus dem Build. */
export const dynamic = "force-dynamic";

/** Farbe des Status-Badges. Nur 'error' faellt bewusst aus dem Grau heraus. */
const statusClass: Record<Source["status"], string> = {
  pending: "text-neutral-500 dark:text-neutral-400",
  processing: "text-neutral-500 dark:text-neutral-400",
  ready: "text-emerald-600 dark:text-emerald-400",
  error: "text-red-600 dark:text-red-400",
};

function SourceItem({ source }: { source: Source }) {
  return (
    <li className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
      <p className="truncate text-sm font-medium" title={source.title}>
        {source.title}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs">
        <span className="text-neutral-500 dark:text-neutral-400">
          {SOURCE_TYPE_LABELS[source.type]}
        </span>
        <span className="text-neutral-300 dark:text-neutral-700">/</span>
        <span className={statusClass[source.status]}>
          {SOURCE_STATUS_LABELS[source.status]}
        </span>
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

      <header className="mt-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {notebook.title}
        </h1>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Erstellt am {formatNotebookDate(notebook.created_at)}
        </p>
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

        {/* Der Chat folgt in Arbeitspaket 4, die Zitate in Arbeitspaket 5. */}
        <section className="rounded-xl border border-dashed border-neutral-300 px-4 py-10 text-center dark:border-neutral-700">
          <p className="text-sm font-medium">Chat</p>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Antworten mit klickbaren Zitaten folgen.
          </p>
        </section>
      </div>
    </main>
  );
}
