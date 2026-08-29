-- ============================================================
-- 0011_source_questions.sql
-- Einstiegsfragen je Quelle.
--
-- Entstehen im selben Anbieteraufruf wie Kurzfassung und Kernthemen. Eine
-- eigene Erzeugung waere bei 20 Anfragen am Tag nicht zu rechtfertigen - und
-- der Aufruf, der die Quelle ohnehin schon gelesen hat, weiss am besten,
-- was man sie fragen kann.
--
-- Deshalb neben summary und topics in sources, nicht in einer eigenen
-- Tabelle: dieselbe Herkunft, dieselbe Lebensdauer, dasselbe Loeschverhalten.
-- ============================================================

alter table sources
  add column if not exists questions jsonb not null default '[]'::jsonb;

comment on column sources.questions is
  'Einstiegsfragen, die sich aus dieser Quelle beantworten lassen. Leer, solange keine Beschreibung vorliegt.';
