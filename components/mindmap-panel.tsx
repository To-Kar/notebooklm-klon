"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { ChatSource } from "@/app/api/chat/route";
import { generateMindmapAction } from "@/app/notebooks/mindmap-actions";
import { CitationDialog } from "@/components/citation";
import { describeSource } from "@/lib/chat/citations";
import { edgePath, layoutMindmap, type PlacedNode } from "@/lib/mindmap/layout";
import type { MindmapData, MindmapStatus } from "@/lib/mindmap/store";

/**
 * Die Themenlandkarte.
 *
 * Sie zeigt nicht nur, worum es geht, sondern woher es kommt: jeder Knoten
 * traegt die Nummern der Abschnitte, aus denen er stammt, und ein Klick
 * darauf oeffnet denselben Belegdialog wie im Chat. Eine Karte ohne diesen
 * Rueckweg waere ein huebsches Schaubild ohne Deckung - genau das, wogegen
 * dieses Produkt antritt.
 */

/** Rahmenfarbe je Ebene: Wurzel, Hauptthema, Unterthema. */
const RAHMEN = [
  "border-neutral-900 dark:border-neutral-100",
  "border-neutral-400 dark:border-neutral-600",
  "border-neutral-200 dark:border-neutral-800",
] as const;

function Knoten({
  node,
  byMarker,
  onSelect,
}: {
  node: PlacedNode;
  byMarker: Map<number, ChatSource>;
  onSelect: (source: ChatSource) => void;
}) {
  return (
    <div
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
      }}
      className={`absolute flex flex-col justify-center gap-1 rounded-lg border bg-background px-2.5 py-1.5 ${
        RAHMEN[Math.min(node.depth, RAHMEN.length - 1)]
      }`}
    >
      <p
        title={node.label}
        // shrink-0: die Beschriftung darf nicht zusammengedrueckt werden,
        // sonst verschwindet die zweite Zeile hinter dem Zuschnitt.
        className={`line-clamp-2 shrink-0 text-[11px] leading-tight ${
          node.depth === 0 ? "font-semibold" : "font-medium"
        }`}
      >
        {node.label}
      </p>

      {node.markers.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {node.markers.map((marker) => {
            const source = byMarker.get(marker);

            // Eine Nummer ohne Abschnitt bleibt Text, nie ein toter Knopf -
            // dieselbe Regel wie bei den Zitaten im Chat.
            if (!source) {
              return (
                <span
                  key={marker}
                  className="rounded bg-neutral-100 px-1 text-[9px] text-neutral-400 dark:bg-neutral-900 dark:text-neutral-600"
                >
                  {marker}
                </span>
              );
            }

            return (
              <button
                key={marker}
                type="button"
                onClick={() => onSelect(source)}
                title={describeSource(source)}
                aria-label={`Belegstelle ${marker} anzeigen: ${describeSource(source)}`}
                className="rounded bg-neutral-200 px-1 text-[9px] font-medium text-neutral-700 transition hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                {marker}
              </button>
            );
          })}
        </span>
      ) : null}
    </div>
  );
}

export function MindmapPanel({
  notebookId,
  status,
  data,
  storedError,
  canGenerate,
}: {
  notebookId: string;
  status: MindmapStatus | null;
  data: MindmapData | null;
  storedError: string | null;
  /** Ohne ausgewaehlte, verarbeitete Quelle gibt es nichts zu ordnen. */
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [laeuft, startTransition] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);
  const [beleg, setBeleg] = useState<ChatSource | null>(null);

  function erzeugen() {
    setFehler(null);

    startTransition(async () => {
      const ergebnis = await generateMindmapAction(notebookId);

      if (ergebnis.error) setFehler(ergebnis.error);
      router.refresh();
    });
  }

  const angezeigterFehler = fehler ?? (status === "error" ? storedError : null);

  // Die Rechnung steckt in einer reinen Funktion, nicht hier: so laesst sich
  // pruefen, dass nichts ueberlappt und nichts aus der Flaeche faellt.
  const layout = data ? layoutMindmap(data.map) : null;
  const byMarker = new Map((data?.sources ?? []).map((s) => [s.marker, s]));
  const nachId = new Map(layout?.nodes.map((n) => [n.id, n]) ?? []);

  const knopfText = laeuft
    ? "Wird erzeugt ..."
    : data
      ? "Neu erzeugen"
      : "Karte erzeugen";

  return (
    <section className="flex min-h-[28rem] flex-col gap-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Themenlandkarte</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Wie die ausgewählten Quellen zusammenhängen. Jede Nummer führt zur
          Stelle, aus der der Knoten stammt.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={erzeugen}
          disabled={laeuft || !canGenerate}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {knopfText}
        </button>

        {!canGenerate ? (
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            Wähl zuerst eine verarbeitete Quelle aus.
          </span>
        ) : null}

        {laeuft ? (
          <span className="text-sm text-neutral-500 dark:text-neutral-400">
            Das dauert etwa eine halbe Minute.
          </span>
        ) : null}
      </div>

      {angezeigterFehler ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {angezeigterFehler}
          {data ? " Angezeigt wird die vorige Fassung." : ""}
        </p>
      ) : null}

      {layout ? (
        // Die Karte wird breiter als die Spalte. Waagerecht scrollen statt
        // schrumpfen: bei 11px Schrift waere ein Herunterskalieren unlesbar.
        <div className="overflow-x-auto">
          <div
            className="relative"
            style={{ width: layout.width, height: layout.height }}
          >
            <svg
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
              className="absolute inset-0"
            >
              {layout.edges.map((edge) => {
                const von = nachId.get(edge.from);
                const zu = nachId.get(edge.to);
                if (!von || !zu) return null;

                return (
                  <path
                    key={`${edge.from}-${edge.to}`}
                    d={edgePath(von, zu)}
                    fill="none"
                    strokeWidth={1}
                    className="stroke-neutral-300 dark:stroke-neutral-700"
                  />
                );
              })}
            </svg>

            {layout.nodes.map((node) => (
              <Knoten
                key={node.id}
                node={node}
                byMarker={byMarker}
                onSelect={setBeleg}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Noch keine Karte. Erzeug eine, um die Themen deiner Quellen
          nebeneinander zu sehen.
        </p>
      )}

      {beleg ? (
        <CitationDialog
          key={beleg.chunkId}
          source={beleg}
          onClose={() => setBeleg(null)}
        />
      ) : null}
    </section>
  );
}
