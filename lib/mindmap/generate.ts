import type { ChatSource } from "@/app/api/chat/route";
import { GEMINI_BASE, geminiRequest } from "@/lib/gemini";
import type { SourceType } from "@/lib/source-limits";
import { createAdminClient } from "@/lib/supabase/server";

import type { Mindmap, MindmapNode } from "./layout";
import { selectIndices } from "./select";

/**
 * Erzeugt die Themenlandkarte eines Notebooks.
 *
 * Die Knoten belegen sich mit Nummern, genau wie eine Chatantwort. Dadurch
 * ist die Karte kein Nebenschauplatz, sondern ein zweiter Weg in dieselbe
 * Substanz: ein Klick fuehrt auf den woertlichen Abschnitt.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

/** Wie viele Abschnitte hoechstens ins Modell gehen. */
const MAX_CHUNKS = 24;

/** Zeichenbudget fuer diese Abschnitte. */
const MAX_INPUT_CHARS = 18_000;

const RETRY_BUDGET_MS = 8_000;

const PROMPT = `Du ordnest den Inhalt von Dokumenten zu einer Themenlandkarte.

Regeln:
1. Drei bis sechs Hauptthemen, je zwei bis vier Unterthemen. Nicht tiefer.
2. Jede Bezeichnung ist kurz: hoechstens fuenf Woerter, kein ganzer Satz.
3. Belege jeden Knoten mit den Nummern der Auszuege, aus denen er stammt. Verwende nur Nummern, die es wirklich gibt.
4. Nutze ausschliesslich die Auszuege. Erfinde keine Themen, die dort nicht vorkommen.
5. Der Titel benennt in wenigen Woertern, worum es insgesamt geht.
6. Auf Deutsch.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    nodes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          markers: { type: "ARRAY", items: { type: "INTEGER" } },
          children: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                label: { type: "STRING" },
                markers: { type: "ARRAY", items: { type: "INTEGER" } },
              },
              required: ["label", "markers"],
            },
          },
        },
        required: ["label", "markers", "children"],
      },
    },
  },
  required: ["title", "nodes"],
} as const;

/** Ein Abschnitt mitsamt seiner Herkunft, wie ihn die Karte belegt. */
export type MindmapChunk = ChatSource;

function readChatModel(): string {
  const model = process.env.LLM_MODEL;
  if (!model) throw new Error("Fehlende Env-Variable: LLM_MODEL");
  return model;
}

type ChunkRow = {
  id: string;
  content: string;
  chunk_index: number;
  metadata: { page?: number } | null;
  source_id: string;
  sources: {
    title: string;
    type: SourceType;
    url: string | null;
  } | null;
};

/**
 * Holt die Abschnitte der ausgewaehlten Quellen und nummeriert sie.
 *
 * Gleichmaessig ueber jede Quelle verteilt, damit eine grosse Quelle die
 * Karte nicht allein bestimmt - dieselbe Ueberlegung wie bei der
 * Kurzfassung, und dieselbe Funktion.
 */
export async function collectChunks(
  notebookId: string,
  sourceIds: string[],
): Promise<MindmapChunk[]> {
  if (sourceIds.length === 0) return [];

  const supabase = createAdminClient();
  const proQuelle = Math.max(2, Math.floor(MAX_CHUNKS / sourceIds.length));
  const budget = Math.floor(MAX_INPUT_CHARS / sourceIds.length);

  const gesammelt: MindmapChunk[] = [];

  for (const sourceId of sourceIds) {
    const { data, error } = await supabase
      .from("chunks")
      .select("id, content, chunk_index, metadata, source_id, sources(title, type, url)")
      .eq("notebook_id", notebookId)
      .eq("source_id", sourceId)
      .order("chunk_index", { ascending: true });

    if (error) {
      throw new Error(`Abschnitte konnten nicht geladen werden: ${error.message}`);
    }

    const zeilen = (data ?? []) as unknown as ChunkRow[];

    for (const index of selectIndices(
      zeilen.map((z) => z.content.length),
      proQuelle,
      budget,
    )) {
      const zeile = zeilen[index];
      const seite = zeile.metadata?.page;

      gesammelt.push({
        marker: gesammelt.length + 1,
        chunkId: zeile.id,
        sourceId: zeile.source_id,
        sourceType: zeile.sources?.type ?? "text",
        title: zeile.sources?.title ?? "Unbekannte Quelle",
        page: typeof seite === "number" ? seite : null,
        url: zeile.sources?.url ?? null,
        similarity: 1,
        content: zeile.content,
      });
    }
  }

  return gesammelt;
}

type GenerateResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

/** Entfernt Belegnummern, die es nicht gibt. */
function cleanMarkers(markers: unknown, hoechste: number): number[] {
  if (!Array.isArray(markers)) return [];

  return markers
    .filter(
      (m): m is number =>
        typeof m === "number" && Number.isInteger(m) && m >= 1 && m <= hoechste,
    )
    .slice(0, 4);
}

/** Baut die Karte aus den Abschnitten. */
export async function generateMindmap(
  chunks: MindmapChunk[],
): Promise<Mindmap> {
  if (chunks.length === 0) {
    throw new Error("Ohne Abschnitte laesst sich keine Karte zeichnen.");
  }

  const model = readChatModel();

  const kontext = chunks
    .map((chunk) => `[${chunk.marker}] ${chunk.title}\n${chunk.content}`)
    .join("\n\n");

  const response = await geminiRequest(
    `${GEMINI_BASE}/models/${model}:generateContent`,
    {
      systemInstruction: { parts: [{ text: PROMPT }] },
      contents: [{ role: "user", parts: [{ text: kontext }] }],
      generationConfig: {
        temperature: 0.3,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 1200,
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
      },
    },
    { budgetMs: RETRY_BUDGET_MS },
  );

  const json = (await response.json()) as GenerateResponse;
  const roh = (json.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (roh.length === 0) {
    throw new Error("Der Anbieter lieferte keine Karte.");
  }

  const geparst = JSON.parse(roh) as {
    title?: string;
    nodes?: { label?: string; markers?: unknown; children?: unknown[] }[];
  };

  const hoechste = chunks.length;

  const nodes: MindmapNode[] = (geparst.nodes ?? [])
    .filter((n): n is { label: string; markers: unknown; children?: unknown[] } =>
      typeof n.label === "string" && n.label.trim().length > 0,
    )
    .slice(0, 6)
    .map((n) => ({
      label: n.label.trim(),
      markers: cleanMarkers(n.markers, hoechste),
      children: ((n.children ?? []) as { label?: string; markers?: unknown }[])
        .filter((k) => typeof k.label === "string" && k.label.trim().length > 0)
        .slice(0, 4)
        .map((k) => ({
          label: (k.label as string).trim(),
          markers: cleanMarkers(k.markers, hoechste),
        })),
    }));

  if (nodes.length === 0) {
    throw new Error("Die Karte kam ohne Themen zurueck.");
  }

  return {
    title:
      typeof geparst.title === "string" && geparst.title.trim().length > 0
        ? geparst.title.trim()
        : "Themen",
    nodes,
  };
}
