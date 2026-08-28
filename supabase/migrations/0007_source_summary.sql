-- ============================================================
-- 0007_source_summary.sql
-- Kurzfassung und Kernthemen je Quelle.
--
-- In NotebookLM bekommt jede Quelle nach dem Hinzufuegen eine kurze
-- Beschreibung. Sie ersetzt kein Zitat, aber sie beantwortet die Frage
-- "was steckt da eigentlich drin", ohne dass man erst danach fragen muss.
-- ============================================================

alter table sources add column if not exists summary text;

-- Kernthemen als jsonb-Array von Strings.
--
-- jsonb statt text[]: die Zusammenfassung entsteht als strukturierte
-- Modellantwort und wird ohnehin als JSON verarbeitet. Eine Umwandlung in
-- ein Postgres-Array waere eine Formatgrenze mehr, die nichts einbringt.
alter table sources add column if not exists topics jsonb not null default '[]'::jsonb;

-- Beides gehoert zusammen und entsteht im selben Aufruf. Themen ohne
-- Zusammenfassung waeren ein halbes Ergebnis, das niemand erzeugt.
alter table sources drop constraint if exists sources_summary_check;
alter table sources add constraint sources_summary_check check (
  summary is not null or topics = '[]'::jsonb
);
