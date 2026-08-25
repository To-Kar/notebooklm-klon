# NotebookLM Klon

Ein quellen-gestuetzter Recherche-Assistent nach Vorbild von Google NotebookLM.
Du legst ein Notebook an, laedst Quellen hoch (PDF, Text, URL) und stellst Fragen.
Jede Antwort ist per RAG mit klickbaren Zitaten auf die Ursprungsstellen deiner
Quellen unterlegt.

Dies ist eine Bewerbungsaufgabe. Der Fokus liegt bewusst auf dem Kern des
Produkts und auf nachvollziehbaren Entscheidungen, nicht auf Vollstaendigkeit.

## Kern der Idee

Der Wert von NotebookLM liegt nicht im Chat allein, sondern darin, dass jede
Aussage aus DEINEN Quellen belegt ist. Genau dieses Grounding mit sichtbaren
Belegstellen ist das zentrale Feature dieses Klons.

## Stack

* Next.js (App Router, TypeScript), Deployment auf Vercel
* Supabase: Postgres mit pgvector fuer Embeddings, Storage fuer Dateien
* Ein LLM- und Embedding-Anbieter deiner Wahl (austauschbar per Env)

Begruendung: ein einziges Deploy-Ziel, echte Datenbank statt Attrappe,
schnelle und zuverlaessige Live-Demo.

## Datenfluss

1. Quelle hochladen (PDF, Text, URL)
2. Parsen und in Chunks aufteilen
3. Chunks embedden und in pgvector speichern
4. Frage stellen, relevante Chunks per Vektorsuche holen
5. Antwort streamen, mit Zitaten zurueck auf die Ursprungsstellen

## Datenmodell

Siehe `supabase/migrations/0001_init.sql`.

* `notebooks`: Arbeitsbereich, der Quellen gruppiert
* `sources`: hochgeladene Quellen mit Verarbeitungsstatus
* `chunks`: Textsegmente mit Embedding fuer die Suche
* `match_chunks(...)`: Retrieval der aehnlichsten Chunks in einem Notebook

Wichtig: Die Vektor-Dimension in der Migration muss zum gewaehlten
Embedding-Modell passen. Details stehen als Kommentar in der SQL-Datei.

## Lokal starten

1. Repo klonen und Abhaengigkeiten installieren

   ```bash
   npm install
   ```

2. Env-Vorlage kopieren und ausfuellen

   ```bash
   cp .env.example .env.local
   ```

3. Supabase-Migration anwenden (SQL-Editor im Dashboard oder Supabase CLI),
   Datei `supabase/migrations/0001_init.sql`.

4. Dev-Server starten

   ```bash
   npm run dev
   ```

5. Health-Check pruefen: `http://localhost:3000/api/health`
   Meldet, ob alle Env-Variablen gesetzt sind.

## Deployment

Repo mit Vercel verbinden, dieselben Env-Variablen im Vercel-Projekt setzen,
Push deployt automatisch.

## Bewusst weggelassen (Demo-Scope)

* Auth und Multi-User: fuer die Demo nicht noetig, wuerde nur Zeit kosten.
* Sehr grosse Dokumente: Ingestion ist auf demo-taugliche Groessen ausgelegt,
  um innerhalb der Function-Limits zu bleiben.

## Status

Phase 0: Geruest, Datenmodell, Env-Plumbing und Health-Check stehen.
Die Features (Ingestion, RAG-Chat mit Zitaten, Studio-Outputs) folgen.
