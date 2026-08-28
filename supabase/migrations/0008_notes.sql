-- ============================================================
-- 0008_notes.sql
-- Notizen zu einem Notebook.
--
-- Zwei Wege hinein: eine Antwort aus dem Chat sichern, oder selbst etwas
-- schreiben. Der Unterschied ist nicht bloss Buchhaltung - eine gesicherte
-- Antwort traegt Belege, eine eigene Notiz nie.
-- ============================================================

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references notebooks(id) on delete cascade,
  origin text not null check (origin in ('manual', 'answer')),
  content text not null,
  -- Belege als Momentaufnahme, wie in messages.citations.
  --
  -- Ein Verweis auf chunks waere schlanker, ginge aber ins Leere, sobald die
  -- Quelle geloescht wird. Gerade bei einer Notiz waere das fatal: sie wird
  -- aufgehoben, um spaeter nachschlagen zu koennen.
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Belege gibt es nur an gesicherten Antworten. Eine selbst geschriebene
-- Notiz mit Belegen waere ein Widerspruch.
alter table notes drop constraint if exists notes_citations_check;
alter table notes add constraint notes_citations_check check (
  origin = 'answer' or citations = '[]'::jsonb
);

-- Notizen werden immer als Liste eines Notebooks gelesen, neueste zuerst.
create index if not exists notes_notebook_id_created_at_idx
  on notes (notebook_id, created_at desc);

-- Rechte wie in 0002_grants.sql: nur service_role.
grant select, insert, update, delete on table notes to service_role;

alter table notes enable row level security;
