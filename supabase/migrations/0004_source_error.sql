-- ============================================================
-- 0004_source_error.sql
-- Der Grund eines fehlgeschlagenen Ingestion-Laufs.
--
-- Bisher blieb bei einem Fehler nur status = 'error' zurueck. Die Meldung
-- lebte im React-Zustand des Browsers und war nach einem Reload weg - der
-- Nutzer sah "Fehler" ohne jede Erklaerung und konnte nur raten, ob ein
-- erneuter Versuch etwas bringt.
-- ============================================================

alter table sources add column if not exists error_message text;

-- Nur fehlgeschlagene Quellen tragen eine Meldung. Ein Text an einer Quelle,
-- die auf 'ready' steht, waere ein Widerspruch, den niemand aufloesen kann.
alter table sources drop constraint if exists sources_error_message_check;
alter table sources add constraint sources_error_message_check check (
  error_message is null or status = 'error'
);
