-- ============================================================
-- 0005_messages.sql
-- Der Chatverlauf eines Notebooks.
--
-- Bisher lebte das Gespraech nur im Browser: ein Reload begann ein neues.
-- Fuer eine Demo war das vertretbar, fuer alles darueber hinaus nicht -
-- gerade weil die Antworten Belege tragen, die man spaeter noch einmal
-- aufschlagen will.
-- ============================================================

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references notebooks(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- Die Belege der Antwort, als Momentaufnahme.
  --
  -- Gespeichert wird nur, was tatsaechlich zitiert wurde, samt dem damaligen
  -- Wortlaut des Abschnitts. Ein Verweis auf chunks waere schlanker, ginge
  -- aber ins Leere, sobald die Quelle geloescht wird - und die Antwort
  -- beruhte nun einmal auf diesem Text. Das ist ein historischer Fakt und
  -- soll lesbar bleiben.
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Belege gibt es nur an Antworten. Eine Frage mit Belegen waere ein
-- Widerspruch, den spaeter niemand aufloesen kann.
alter table messages drop constraint if exists messages_citations_check;
alter table messages add constraint messages_citations_check check (
  role = 'assistant' or citations = '[]'::jsonb
);

-- Der Verlauf wird immer als Ganzes und in zeitlicher Reihenfolge gelesen.
create index if not exists messages_notebook_id_created_at_idx
  on messages (notebook_id, created_at);

-- Rechte wie in 0002_grants.sql: nur service_role. Der Browser spricht nie
-- direkt mit Supabase.
grant select, insert, update, delete on table messages to service_role;

-- Defense in depth, ohne Policies. service_role umgeht RLS ohnehin.
alter table messages enable row level security;
