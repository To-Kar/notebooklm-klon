import Link from "next/link";
import { notFound } from "next/navigation";

import { formatNotebookDate, getNotebook } from "@/lib/notebooks";

/** Wie auf der Startseite: der Stand kommt aus der DB, nicht aus dem Build. */
export const dynamic = "force-dynamic";

export default async function NotebookPage({
  params,
}: PageProps<"/notebooks/[id]">) {
  const { id } = await params;
  const notebook = await getNotebook(id);

  if (!notebook) {
    notFound();
  }

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

      {/* Platzhalter im spaeteren Zuschnitt: links die Quellen, rechts der
          Chat mit den Zitaten. Beides folgt in den naechsten Arbeitspaketen. */}
      <div className="mt-8 grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <aside className="rounded-xl border border-dashed border-neutral-300 px-4 py-10 text-center dark:border-neutral-700">
          <p className="text-sm font-medium">Quellen</p>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Upload und URL-Eingabe folgen.
          </p>
        </aside>

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
