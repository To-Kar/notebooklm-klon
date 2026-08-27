-- ============================================================
-- 0006_source_selection.sql
-- Quellen an- und abwaehlen, wie in NotebookLM.
--
-- Hintergrund: Eine grosse Quelle verdraengt eine kleine aus der Trefferliste.
-- Beobachtet mit 19 Chunks aus einem Wikipedia-Artikel gegen 3 Chunks aus
-- einem PDF - die Frage nach dem PDF-Inhalt lieferte "dazu steht nichts in den
-- Quellen", obwohl der Abschnitt vorhanden war. Wer gezielt eine Quelle
-- befragen will, muss die anderen abwaehlen koennen.
-- ============================================================

-- Neue Quellen sind ausgewaehlt. Alles andere waere ueberraschend: wer eine
-- Datei hochlaedt, will sie benutzen.
alter table sources add column if not exists selected boolean not null default true;

-- ------------------------------------------------------------
-- Retrieval, eingeschraenkt auf bestimmte Quellen.
--
-- Das Embedding kommt als text herein und wird hier gecastet, NICHT als
-- vector(1536) deklariert. Der Grund ist Absicht: die Embedding-Dimension
-- steht laut Projektkonvention nur an einer Stelle, naemlich in
-- 0001_init.sql. Eine zweite Signatur mit vector(1536) waere eine zweite
-- Stelle, die bei einem Modellwechsel mitgepflegt werden muesste - und beim
-- naechsten Mal vergessen wuerde.
--
-- Der Cast funktioniert, weil pgvector die Textform '[0.1,0.2,...]' annimmt;
-- genau diese Form schickt der Anwendungscode ohnehin schon an match_chunks.
--
-- match_chunks bleibt unveraendert bestehen. Diese Funktion ist eine
-- Ergaenzung, kein Ersatz.
-- ------------------------------------------------------------
create or replace function match_chunks_in_sources(
  query_embedding text,
  match_notebook_id uuid,
  match_source_ids uuid[],
  match_count int default 8
)
returns table (
  id uuid,
  source_id uuid,
  content text,
  chunk_index int,
  similarity float
)
language sql
stable
as $func$
  select
    c.id,
    c.source_id,
    c.content,
    c.chunk_index,
    1 - (c.embedding <=> query_embedding::vector) as similarity
  from chunks c
  where c.notebook_id = match_notebook_id
    and c.source_id = any(match_source_ids)
    and c.embedding is not null
  order by c.embedding <=> query_embedding::vector
  limit match_count;
$func$;

grant execute on function match_chunks_in_sources(text, uuid, uuid[], int) to service_role;
