export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="space-y-3">
        <p className="text-sm uppercase tracking-widest text-neutral-500">
          Phase 0 Scaffold
        </p>
        <h1 className="text-4xl font-semibold">NotebookLM Klon</h1>
        <p className="max-w-md text-neutral-400">
          Quellen-gestuetzter Recherche-Assistent mit RAG und klickbaren
          Zitaten. Das Geruest steht, die Features folgen.
        </p>
      </div>

      <a
        href="/api/health"
        className="rounded-full border border-neutral-700 px-5 py-2 text-sm text-neutral-300 transition hover:bg-neutral-800"
      >
        Health-Check ansehen
      </a>
    </main>
  );
}
