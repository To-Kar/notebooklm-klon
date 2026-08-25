-- ============================================================
-- 0001_init.sql
-- Grundschema fuer den NotebookLM-Klon: Notebooks, Sources, Chunks + Retrieval.
-- ============================================================

-- pgvector aktivieren (Embeddings).
create extension if not exists vector;

-- ------------------------------------------------------------
-- EMBEDDING-DIMENSION
-- Die Zahl in vector(...) MUSS zum gewaehlten Embedding-Modell passen.
--   OpenAI text-embedding-3-small = 1536
--   Gemini text-embedding-004     = 768
-- Sie taucht an ZWEI Stellen auf: in der Spalte chunks.embedding
-- und in der Signatur der Funktion match_chunks(). Beide muessen
-- denselben Wert haben. Aendere sie hier, bevor du migrierst.
-- ------------------------------------------------------------

-- Notebook: Arbeitsbereich, der Quellen gruppiert.
create table if not exists notebooks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_at timestamptz not null default now()
);

-- Source: eine hochgeladene Quelle (PDF, Text oder URL) in einem Notebook.
create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references notebooks(id) on delete cascade,
  title text not null,
  type text not null check (type in ('pdf', 'text', 'url')),
  storage_path text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'error')),
  created_at timestamptz not null default now()
);

-- Chunk: ein Textsegment einer Quelle mit zugehoerigem Embedding.
create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  notebook_id uuid not null references notebooks(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chunks_source_id_idx on chunks (source_id);
create index if not exists chunks_notebook_id_idx on chunks (notebook_id);

-- Approximate-Nearest-Neighbour-Index fuer Cosine-Similarity.
create index if not exists chunks_embedding_idx
  on chunks using hnsw (embedding vector_cosine_ops);

-- Retrieval: die k aehnlichsten Chunks innerhalb EINES Notebooks.
-- Die similarity liegt zwischen 0 und 1 (1 = identisch).
create or replace function match_chunks(
  query_embedding vector(1536),
  match_notebook_id uuid,
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
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  where c.notebook_id = match_notebook_id
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$func$;