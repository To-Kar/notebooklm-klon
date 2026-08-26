-- ============================================================
-- 0003_sources.sql
-- Web-Quellen bekommen eine eigene Spalte, Datei-Quellen einen Bucket.
-- ============================================================

-- URL einer Web-Quelle.
-- Dateien nutzen weiterhin storage_path, URLs diese Spalte. Beim
-- Ingestion-Schritt entscheidet genau diese Unterscheidung, welcher
-- Parser laeuft.
alter table sources add column if not exists url text;

-- Genau eine Herkunft pro Quelle, passend zum type.
-- Verhindert halbe Zeilen: eine Datei-Quelle ohne Pfad oder eine
-- Web-Quelle ohne URL waere fuer die Ingestion wertlos.
alter table sources drop constraint if exists sources_location_check;
alter table sources add constraint sources_location_check check (
  (type = 'url' and url is not null and storage_path is null)
  or (type in ('pdf', 'text') and storage_path is not null and url is null)
);

-- ------------------------------------------------------------
-- Storage-Bucket fuer hochgeladene Dateien.
--
-- Privat: der Browser spricht nie direkt mit Storage, alle Zugriffe laufen
-- serverseitig ueber den Secret-Key. Wenn wir spaeter eine Datei anzeigen
-- wollen, erzeugen wir serverseitig eine signierte URL.
--
-- file_size_limit und allowed_mime_types doppeln bewusst die Pruefung aus
-- dem Anwendungscode. Storage ist die letzte Instanz, die nicht umgangen
-- werden kann.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'source-files',
  'source-files',
  false,
  4194304, -- 4 MiB, passend zum Body-Limit der Vercel-Functions
  array['application/pdf', 'text/plain']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
