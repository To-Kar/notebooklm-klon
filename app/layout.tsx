import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "NotebookLM Klon",
  description:
    "Quellen-gestuetzter Recherche-Assistent mit RAG und klickbaren Zitaten.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-neutral-200 dark:border-neutral-800">
          {/* Gleiche Breite wie der Seiteninhalt, damit spaeter eine
              Quellen-Seitenleiste sauber darunter passt. */}
          <div className="mx-auto flex w-full max-w-5xl items-center px-6 py-4">
            <Link
              href="/"
              className="text-sm font-semibold tracking-tight transition hover:text-neutral-500 dark:hover:text-neutral-400"
            >
              NotebookLM Klon
            </Link>
          </div>
        </header>

        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
