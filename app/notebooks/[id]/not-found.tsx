import Link from "next/link";

/** Wird von notFound() in app/notebooks/[id]/page.tsx gerendert. */
export default function NotebookNotFound() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="rounded-xl border border-neutral-200 px-6 py-12 text-center dark:border-neutral-800">
        <h1 className="text-lg font-semibold">Notebook nicht gefunden</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
          Dieses Notebook gibt es nicht mehr oder der Link stimmt nicht.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Zur Notebook-Liste
        </Link>
      </div>
    </main>
  );
}
