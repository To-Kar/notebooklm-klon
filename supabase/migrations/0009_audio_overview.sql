-- ============================================================
-- 0009_audio_overview.sql
-- Gesprochene Kurzzusammenfassung eines Notebooks.
--
-- Ein Eintrag je Notebook: ein erneutes Erzeugen ersetzt das vorherige.
-- Eine Historie alter Fassungen braucht hier niemand, sie wuerde nur
-- Speicher belegen.
-- ============================================================

create table if not exists audio_overviews (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null unique references notebooks(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'error')),
  -- Das gesprochene Skript. Sichtbar zu machen ist kein Beiwerk: wer hoert,
  -- was ein Modell erzeugt hat, soll nachlesen koennen, was es gesagt hat.
  script text,
  storage_path text,
  duration_seconds numeric,
  error_message text,
  created_at timestamptz not null default now()
);

-- Wie bei sources: eine Meldung gehoert nur an einen Fehlversuch.
alter table audio_overviews drop constraint if exists audio_overviews_error_check;
alter table audio_overviews add constraint audio_overviews_error_check check (
  error_message is null or status = 'error'
);

-- Fertig heisst: es gibt eine Datei und ein Skript dazu.
alter table audio_overviews drop constraint if exists audio_overviews_ready_check;
alter table audio_overviews add constraint audio_overviews_ready_check check (
  status <> 'ready' or (storage_path is not null and script is not null)
);

-- ------------------------------------------------------------
-- Eigener Bucket fuer erzeugtes Audio.
--
-- Bewusst getrennt von source-files: dort sind nur PDF und Text erlaubt, und
-- diese Beschraenkung hat schon zweimal verhindert, dass Unerwartetes
-- hineinlaeuft. Sie aufzuweichen, um WAV unterzubringen, waere der falsche
-- Weg. Ausserdem haben Quellen und erzeugtes Audio verschiedene Lebensdauern:
-- Audio wird bei jedem Neuerzeugen ersetzt.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio-overviews',
  'audio-overviews',
  false,
  8388608, -- 8 MiB, reichlich fuer eine halbe Minute bei 48 KB/s
  array['audio/wav']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

grant select, insert, update, delete on table audio_overviews to service_role;

alter table audio_overviews enable row level security;
