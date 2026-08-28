import { describe, expect, it } from "vitest";

import {
  countRows,
  edgePath,
  layoutMindmap,
  type Mindmap,
  type MindmapNode,
  type PlacedNode,
} from "@/lib/mindmap/layout";

/**
 * Layoutfehler melden sich nicht. Sie zeigen sich als uebereinanderliegende
 * Kaesten oder als Knoten ausserhalb der Zeichenflaeche - und das bemerkt
 * nur, wer genau hinsieht. Deshalb werden hier Eigenschaften geprueft, nicht
 * einzelne Koordinaten.
 */

function knoten(label: string, kinder: MindmapNode[] = []): MindmapNode {
  return { label, markers: [1], children: kinder };
}

function karte(nodes: MindmapNode[]): Mindmap {
  return { title: "Wurzel", nodes };
}

/** Ueberlappen sich zwei Kaesten? */
function ueberlappt(a: PlacedNode, b: PlacedNode): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

describe("countRows", () => {
  it("zaehlt ein Blatt als eine Zeile", () => {
    expect(countRows(knoten("A"))).toBe(1);
  });

  it("zaehlt die Blaetter eines Teilbaums", () => {
    expect(countRows(knoten("A", [knoten("B"), knoten("C")]))).toBe(2);
  });

  it("zaehlt ueber mehrere Ebenen", () => {
    const baum = knoten("A", [
      knoten("B", [knoten("B1"), knoten("B2")]),
      knoten("C"),
    ]);
    expect(countRows(baum)).toBe(3);
  });
});

describe("layoutMindmap", () => {
  const beispiel = karte([
    knoten("Thema 1", [knoten("Unter 1a"), knoten("Unter 1b")]),
    knoten("Thema 2", [knoten("Unter 2a")]),
    knoten("Thema 3"),
  ]);
  const layout = layoutMindmap(beispiel);

  it("platziert Wurzel, Themen und Unterthemen", () => {
    // 1 Wurzel + 3 Themen + 3 Unterthemen
    expect(layout.nodes).toHaveLength(7);
  });

  it("gibt der Wurzel die Tiefe null", () => {
    const wurzel = layout.nodes.find((n) => n.depth === 0);
    expect(wurzel?.label).toBe("Wurzel");
  });

  it("laesst keine zwei Kaesten ueberlappen", () => {
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        expect(ueberlappt(layout.nodes[i], layout.nodes[j])).toBe(false);
      }
    }
  });

  it("setzt Kinder rechts von ihrem Elternknoten", () => {
    const nachId = new Map(layout.nodes.map((n) => [n.id, n]));

    for (const edge of layout.edges) {
      const von = nachId.get(edge.from)!;
      const zu = nachId.get(edge.to)!;
      expect(zu.x).toBeGreaterThanOrEqual(von.x + von.width);
    }
  });

  it("setzt jeden Elternknoten senkrecht zwischen seine Kinder", () => {
    // Sonst laufen Kanten quer ueber fremde Knoten.
    const nachId = new Map(layout.nodes.map((n) => [n.id, n]));
    const kinderVon = new Map<string, PlacedNode[]>();

    for (const edge of layout.edges) {
      const liste = kinderVon.get(edge.from) ?? [];
      liste.push(nachId.get(edge.to)!);
      kinderVon.set(edge.from, liste);
    }

    for (const [elternId, kinder] of kinderVon) {
      const eltern = nachId.get(elternId)!;
      const mitte = eltern.y + eltern.height / 2;
      const oben = Math.min(...kinder.map((k) => k.y + k.height / 2));
      const unten = Math.max(...kinder.map((k) => k.y + k.height / 2));

      expect(mitte).toBeGreaterThanOrEqual(oben - 0.001);
      expect(mitte).toBeLessThanOrEqual(unten + 0.001);
    }
  });

  it("haelt alle Knoten innerhalb der gemeldeten Flaeche", () => {
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it("erzeugt fuer jede Verbindung genau eine Kante", () => {
    // Sechs Kinder unterhalb der Wurzel und der Themen.
    expect(layout.edges).toHaveLength(6);
  });

  it("kommt mit einer leeren Karte zurecht", () => {
    const leer = layoutMindmap(karte([]));
    expect(leer.nodes).toHaveLength(1);
    expect(leer.edges).toHaveLength(0);
    expect(leer.height).toBeGreaterThan(0);
  });

  it("waechst in der Hoehe mit der Zahl der Blaetter", () => {
    const klein = layoutMindmap(karte([knoten("A"), knoten("B")]));
    const gross = layoutMindmap(
      karte(Array.from({ length: 10 }, (_, i) => knoten(`T${i}`))),
    );
    expect(gross.height).toBeGreaterThan(klein.height);
  });

  it("behaelt die Belegnummern am Knoten", () => {
    const mitBelegen = layoutMindmap({
      title: "W",
      nodes: [{ label: "A", markers: [2, 5] }],
    });
    expect(mitBelegen.nodes.find((n) => n.label === "A")?.markers).toEqual([
      2, 5,
    ]);
  });
});

describe("edgePath", () => {
  it("beginnt rechts am Elternknoten und endet links am Kind", () => {
    const von: PlacedNode = { id: "a", label: "A", markers: [], depth: 0, x: 0, y: 0, width: 100, height: 40 };
    const zu: PlacedNode = { id: "b", label: "B", markers: [], depth: 1, x: 150, y: 60, width: 100, height: 40 };

    const pfad = edgePath(von, zu);
    expect(pfad.startsWith("M 100 20")).toBe(true);
    expect(pfad).toContain("150 80");
  });
});
