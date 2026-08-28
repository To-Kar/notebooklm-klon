-- ============================================================
-- 0010_mindmap.sql
-- Themenlandkarte eines Notebooks.
--
-- Ein Eintrag je Notebook, wie bei der gesprochenen Zusammenfassung: ein
-- erneutes Erzeugen ersetzt das vorherige.
-- ============================================================

create table if not exists mindmaps (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null unique references notebooks(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'error')),
  -- Der Baum samt Belegen, so wie ihn das UI zeichnet.
  --
  -- jsonb statt normalisierter Tabellen: die Karte wird immer als Ganzes
  -- gelesen, als Ganzes ersetzt und nie einzeln abgefragt. Knoten und Kanten
  -- auf Zeilen zu verteilen waere Aufwand ohne Gegenwert.
  data jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

-- Wie bei sources und audio_overviews: eine Meldung gehoert nur an einen
-- Fehlversuch.
alter table mindmaps drop constraint if exists mindmaps_error_check;
alter table mindmaps add constraint mindmaps_error_check check (
  error_message is null or status = 'error'
);

-- Fertig heisst: es gibt einen Baum.
alter table mindmaps drop constraint if exists mindmaps_ready_check;
alter table mindmaps add constraint mindmaps_ready_check check (
  status <> 'ready' or data is not null
);

grant select, insert, update, delete on table mindmaps to service_role;

alter table mindmaps enable row level security;
