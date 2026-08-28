/**
 * Aus einem Themenbaum Koordinaten rechnen.
 *
 * Bewusst eine reine Funktion: Baum rein, Positionen raus. Kein DOM, keine
 * Messung, kein Zufall. Bei Grafikcode ist das der einzige Weg, Fehler zu
 * finden, ohne hinzusehen - eine Ueberlappung oder ein Knoten ausserhalb der
 * Flaeche faellt sonst erst auf, wenn es jemand bemerkt.
 */

/** Ein Knoten, wie ihn das Modell liefert. */
export type MindmapNode = {
  label: string;
  /** Nummern der Auszuege, auf die sich der Knoten stuetzt. */
  markers: number[];
  children?: MindmapNode[];
};

export type Mindmap = {
  title: string;
  nodes: MindmapNode[];
};

/** Ein Knoten mit Platz auf der Zeichenflaeche. */
export type PlacedNode = {
  id: string;
  label: string;
  markers: number[];
  /** 0 = Wurzel, 1 = Hauptthema, 2 = Unterthema. */
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Edge = {
  from: string;
  to: string;
};

export type Layout = {
  nodes: PlacedNode[];
  edges: Edge[];
  width: number;
  height: number;
};

/** Masse in Bildpunkten. Bewusst hier und nicht im CSS: sie gehen in die Rechnung ein. */
const NODE_WIDTH = [190, 170, 160] as const;
const NODE_HEIGHT = 44;
/** Senkrechter Abstand zwischen zwei Knoten derselben Ebene. */
const ROW_GAP = 14;
/** Waagerechter Abstand zwischen den Ebenen. */
const COLUMN_GAP = 46;
const PADDING = 16;

function nodeWidth(depth: number): number {
  return NODE_WIDTH[Math.min(depth, NODE_WIDTH.length - 1)];
}

/** Waagerechte Position einer Ebene. */
function columnX(depth: number): number {
  let x = PADDING;
  for (let i = 0; i < depth; i++) x += nodeWidth(i) + COLUMN_GAP;
  return x;
}

/**
 * Wie viele Zeilen belegt ein Teilbaum?
 *
 * Ein Blatt belegt eine Zeile, ein Knoten mit Kindern so viele wie seine
 * Kinder zusammen. Daraus ergibt sich die Hoehe, ohne dass irgendwo etwas
 * uebereinanderliegt.
 */
export function countRows(node: MindmapNode): number {
  const kinder = node.children ?? [];
  if (kinder.length === 0) return 1;

  return kinder.reduce((summe, kind) => summe + countRows(kind), 0);
}

/**
 * Verteilt den Baum auf der Flaeche.
 *
 * Die Wurzel steht links auf halber Hoehe, Hauptthemen daneben, Unterthemen
 * wiederum daneben. Jeder Elternknoten sitzt senkrecht in der Mitte seiner
 * Kinder - so laeuft keine Kante quer ueber fremde Knoten.
 */
export function layoutMindmap(mindmap: Mindmap): Layout {
  const nodes: PlacedNode[] = [];
  const edges: Edge[] = [];

  const zeilenHoehe = NODE_HEIGHT + ROW_GAP;
  let naechsteZeile = 0;

  /** Platziert einen Teilbaum und gibt die Mitte des Elternknotens zurueck. */
  function platziere(
    node: MindmapNode,
    depth: number,
    parentId: string | null,
    pfad: string,
  ): number {
    const id = pfad;
    const kinder = node.children ?? [];

    let mitte: number;

    if (kinder.length === 0) {
      mitte = naechsteZeile * zeilenHoehe + NODE_HEIGHT / 2;
      naechsteZeile += 1;
    } else {
      const kindMitten = kinder.map((kind, i) =>
        platziere(kind, depth + 1, id, `${pfad}.${i}`),
      );
      // Genau zwischen dem ersten und dem letzten Kind.
      mitte = (kindMitten[0] + kindMitten[kindMitten.length - 1]) / 2;
    }

    nodes.push({
      id,
      label: node.label,
      markers: node.markers,
      depth,
      x: columnX(depth),
      y: PADDING + mitte - NODE_HEIGHT / 2,
      width: nodeWidth(depth),
      height: NODE_HEIGHT,
    });

    if (parentId !== null) {
      edges.push({ from: parentId, to: id });
    }

    return mitte;
  }

  const wurzel: MindmapNode = {
    label: mindmap.title,
    markers: [],
    children: mindmap.nodes,
  };

  platziere(wurzel, 0, null, "0");

  const maxTiefe = nodes.reduce((max, n) => Math.max(max, n.depth), 0);
  const breite = columnX(maxTiefe) + nodeWidth(maxTiefe) + PADDING;
  const hoehe = PADDING * 2 + Math.max(1, naechsteZeile) * zeilenHoehe - ROW_GAP;

  return { nodes, edges, width: breite, height: hoehe };
}

/** Eine Kante als weiche Kurve von Knoten zu Knoten. */
export function edgePath(from: PlacedNode, to: PlacedNode): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const mitte = x1 + (x2 - x1) / 2;

  return `M ${x1} ${y1} C ${mitte} ${y1}, ${mitte} ${y2}, ${x2} ${y2}`;
}
