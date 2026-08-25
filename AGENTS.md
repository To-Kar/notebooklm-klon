<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

@AGENTS.md

# NotebookLM Klon: Arbeitsanweisungen fuer Claude Code

Lies diese Datei vor jeder Aufgabe. Sie hat Vorrang vor Bequemlichkeit.

## Wichtigste Regel: Du committest und pushst NICHT

- Du aenderst Code auf einem Feature-Branch, mehr nicht.
- Nach jeder abgeschlossenen Aenderung lieferst du zwei Dinge:
  1. eine fertige Commit-Message im Conventional-Commits-Stil
     (feat:, fix:, chore:, docs:, refactor:)
  2. eine kurze, PR-artige Zusammenfassung des Diffs (was, warum, welche Dateien)
- Der Mensch reviewt den Diff, staged, committet und pusht selbst. Immer.
- Kein `git commit`, kein `git push`, kein Umschreiben der Historie.
  Auch nicht, wenn es schneller waere. Diese Regel ist nicht verhandelbar.

## Branch- und PR-Flow

- Pro Arbeitspaket ein Feature-Branch (feat/ingestion, feat/chat-citations ...).
- Kleine, logisch abgegrenzte Commits. Eine Sache pro Commit.
- Zusammenfuehrung nach main laeuft ueber Pull Request.
- main bleibt jederzeit deploybar.

## Projektkontext

Ein quellen-gestuetzter Recherche-Assistent nach Vorbild von Google NotebookLM.
Kern des Produkts: ein RAG-Chat, bei dem JEDE Antwort mit klickbaren Zitaten auf
die Ursprungsstellen der hochgeladenen Quellen zurueckverweist. Dieses Grounding
mit sichtbaren Belegstellen ist das zentrale Feature, nicht der Chat an sich.

Stack:
- Next.js 16 (App Router, TypeScript), Deployment auf Vercel
- Supabase: Postgres mit pgvector fuer Embeddings, Storage fuer Dateien
- LLM und Embeddings ueber einen austauschbaren Anbieter (per Env konfiguriert)

## Konventionen (nicht verhandelbar)

- Nichts hardcoden. Das Projekt haengt an echter DB und echten Daten.
  Konfiguration ausschliesslich ueber Env. Keine eingebauten Beispieldaten
  als Ersatz fuer eine echte Anbindung.
- Secrets nur aus Env. SUPABASE_SERVICE_ROLE_KEY und LLM_API_KEY gehoeren
  niemals in Client-Code und niemals ins Repo.
- lib/supabase/server.ts nur aus Server-Code importieren (Route Handler,
  Server Actions, Server Components). lib/supabase/client.ts fuer
  Client-Komponenten.
- Embedding-Dimension nur an der markierten Stelle in
  supabase/migrations/0001_init.sql aendern. Spalte chunks.embedding und die
  Funktion match_chunks muessen denselben Wert haben.
- TypeScript strikt. Fehler sauber behandeln, nicht verschlucken.
- Erklaerungen an den Menschen auf Deutsch.

## Vorgehen bei jeder Aufgabe

1. Kurz den Plan nennen, bevor du Code schreibst.
2. Klein halten. Ein Arbeitspaket nach dem anderen, nicht alles auf einmal.
3. Nach der Aenderung muss `npm run build` gruen sein. Wenn nicht, erst fixen.
4. Commit-Message und Diff-Zusammenfassung liefern. Nicht committen.

## Phase 1: RAG-Chat mit Zitaten (aktuelles Ziel)

In dieser Reihenfolge, je ein eigenes Arbeitspaket und ein eigener Branch:

1. Notebook anlegen und auflisten (minimales CRUD).
2. Quelle hinzufuegen: Datei-Upload (PDF, txt) in Supabase Storage plus
   URL-Eingabe. Eintrag in sources anlegen, mit status.
3. Ingestion: Quelle parsen, in Chunks teilen, embedden, in chunks schreiben.
   status pflegen (processing, ready, error). Auf demo-taugliche Dokumentgroessen
   achten, wegen der Vercel-Function-Limits.
4. Retrieval und Chat: Frage entgegennehmen, match_chunks holen, an das LLM,
   Antwort streamen.
5. Zitate: Die Antwort referenziert die genutzten Chunks. Im UI klickbar zurueck
   auf Quelle und Stelle. Das ist der Kern des Produkts, hier besonders sorgfaeltig.

## Was NICHT bauen (Scope-Grenzen)

- Keine Auth, kein Multi-User. Bewusste Demo-Entscheidung.
- Keine Studio-Features (Audio Overview, Video, Mindmap) in Phase 1.
  Erst wenn der Kern steht und Zeit bleibt.
