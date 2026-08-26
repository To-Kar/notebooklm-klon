import Link from "next/link";

import { NewNotebookForm } from "@/components/new-notebook-form";
import { formatNotebookDate, listNotebooks } from "@/lib/notebooks";

/**
 * Die Liste kommt aus der DB und muss bei jedem Aufruf frisch sein.
 * Ohne das wuerde Next die Supabase-Abfrage zur Build-Zeit ausfuehren
 * und das Ergebnis als statische Seite ausliefern.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const notebooks = await listNotebooks();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Deine Notebooks</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Ein Notebook buendelt deine Quellen und den Chat dazu.
        </p>
      </div>

      <NewNotebookForm />

      <section className="mt-10">
        {notebooks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-12 text-center dark:border-neutral-700">
            <p className="text-sm font-medium">Noch keine Notebooks</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
              Leg oben dein erstes Notebook an. Danach kannst du Quellen
              hinzufuegen und mit ihnen chatten.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {notebooks.map((notebook) => (
              <li key={notebook.id}>
                <Link
                  href={`/notebooks/${notebook.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 px-4 py-3 transition hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
                >
                  <span className="truncate text-sm font-medium">
                    {notebook.title}
                  </span>
                  <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                    {formatNotebookDate(notebook.created_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
