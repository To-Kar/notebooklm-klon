import { SOURCE_TYPE_LABELS } from "@/lib/source-limits";

import type { ChatSource } from "@/app/api/chat/route";

/**
 * Die reine Logik hinter den Zitaten.
 *
 * Bewusst getrennt von der Darstellung: hier steckt, was ohne Browser
 * entscheidbar ist - und damit auch, was sich ohne Browser testen laesst.
 */

/** Ein Stueck Antworttext oder ein Verweis darauf. */
export type Segment =
  | { kind: "text"; value: string }
  | { kind: "citation"; marker: number };

/**
 * Zerlegt den Antworttext an den Belegnummern.
 *
 * Laeuft bei jedem Renderdurchgang ueber den bisher angekommenen Text.
 * Waehrend des Streamens kann eine Nummer noch unvollstaendig sein ("[1" ohne
 * Klammer); die bleibt dann Text und wird zum Verweis, sobald sie vollstaendig
 * ist.
 */
export function splitIntoSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(/\[(\d+)\]/g)) {
    const start = match.index;

    if (start > cursor) {
      segments.push({ kind: "text", value: content.slice(cursor, start) });
    }

    segments.push({ kind: "citation", marker: Number(match[1]) });
    cursor = start + match[0].length;
  }

  if (cursor < content.length) {
    segments.push({ kind: "text", value: content.slice(cursor) });
  }

  return segments;
}

/**
 * Nur die Belege, auf die sich die Antwort wirklich beruft.
 *
 * Der Kontext enthaelt acht Auszuege, zitiert werden meist zwei oder drei.
 * Alle aufzulisten macht die Belegliste wertlos: bei mehreren Auszuegen aus
 * derselben Quelle stuenden dort sechs identische Zeilen.
 */
export function usedSources(
  content: string,
  sources: ChatSource[],
): ChatSource[] {
  const marker = new Set(
    [...content.matchAll(/\[(\d+)\]/g)].map((treffer) => Number(treffer[1])),
  );

  return sources.filter((source) => marker.has(source.marker));
}

/** Beschreibt eine Belegstelle in einer Zeile. */
export function describeSource(source: ChatSource): string {
  const type = SOURCE_TYPE_LABELS[source.sourceType];
  const page = source.page === null ? "" : `, Seite ${source.page}`;

  return `${source.title} (${type}${page})`;
}
