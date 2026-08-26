-- ============================================================
-- 0002_grants.sql
-- Tabellenrechte fuer die API-Rollen.
--
-- 0001_init.sql legt die Tabellen an, vergibt aber keine Rechte. Je nachdem,
-- mit welcher Rolle die Migration lief, greifen die Default-Privileges von
-- Supabase nicht, und PostgREST antwortet auf jede Abfrage mit
-- 42501 "permission denied for table ..." - unabhaengig vom benutzten Key.
--
-- Bewusste Entscheidung: NUR service_role bekommt Rechte.
-- Der Browser spricht in diesem Projekt nie direkt mit Supabase, alle
-- Zugriffe laufen serverseitig ueber den Secret-Key (lib/supabase/server.ts).
-- anon und authenticated bleiben deshalb ohne Rechte auf diesen Tabellen.
-- ============================================================

grant usage on schema public to service_role;

grant select, insert, update, delete on table notebooks to service_role;
grant select, insert, update, delete on table sources to service_role;
grant select, insert, update, delete on table chunks to service_role;

-- Defense in depth: RLS einschalten, ohne Policies zu definieren.
-- service_role umgeht RLS ohnehin. Fuer jede andere Rolle bleibt damit alles
-- gesperrt, selbst wenn ihr spaeter versehentlich Tabellenrechte zufallen.
alter table notebooks enable row level security;
alter table sources enable row level security;
alter table chunks enable row level security;
