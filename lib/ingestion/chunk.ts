/**
 * Zerlegt den Text einer Quelle in ueberlappende Chunks.
 *
 * Jeder Chunk traegt seine Herkunft mit: Seitenzahl beim PDF, Zeichenoffset
 * ueberall. Ohne diese Angaben kann der Chat spaeter keine klickbaren Zitate
 * auf die Ursprungsstelle setzen - und das ist der Kern des Produkts.
 */

/** Angestrebte Chunkgroesse in Zeichen. */
const TARGET_SIZE = 1000;

/** Obergrenze fuer einen einzelnen Block. Darueber wird im Absatz getrennt. */
const MAX_SIZE = 1400;

/** Ueberlappung, damit ein Satz an der Grenze nicht verloren geht. */
const OVERLAP_SIZE = 200;

/**
 * Laengster moeglicher Chunk: ein voller Block plus die uebernommene
 * Ueberlappung plus der Absatztrenner. Rund 1600 Zeichen sind etwa 400 Token
 * und liegen damit weit unter dem, was das Embedding-Modell annimmt.
 */
export const MAX_CHUNK_LENGTH = MAX_SIZE + OVERLAP_SIZE + 2;

/**
 * Obergrenze pro Quelle.
 *
 * Die kostenlose Stufe des Embedding-Anbieters erlaubt 100 Requests pro
 * Minute. 200 Chunks sind zwei Batches und damit ein Fensterwechsel, gemessen
 * rund 23 Sekunden - das passt in eine Serverless-Function. Groessere
 * Dokumente bekommen eine klare Absage statt eines Timeouts.
 */
export const MAX_CHUNKS_PER_SOURCE = 200;

/** Ein Textabschnitt der Quelle. Bei PDFs eine Seite, sonst der ganze Text. */
export type TextSegment = {
  text: string;
  /** 1-basierte Seitenzahl, nur bei PDFs gesetzt. */
  page?: number;
};

/** Herkunft eines Chunks, landet als jsonb in chunks.metadata. */
export type ChunkMetadata = {
  page?: number;
  /** Zeichenoffsets im normalisierten Text des Segments. */
  start: number;
  end: number;
};

export type SourceChunk = {
  index: number;
  content: string;
  metadata: ChunkMetadata;
};

/**
 * Vereinheitlicht Leerraum, ohne Absatzgrenzen zu zerstoeren.
 *
 * PDF-Extraktion bricht Zeilen mitten im Satz um. Einzelne Umbrueche werden
 * deshalb zu Leerzeichen, nur Leerzeilen bleiben als Absatzgrenze stehen.
 * Ohne diesen Schritt zerfaellt jeder Satz in Bruchstuecke, und das Embedding
 * bekommt Text, den so niemand geschrieben hat.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?<!\n)\n(?!\n)/g, " ")
    .trim();
}

type Block = { text: string; start: number; end: number };

/** Absaetze mit ihren Offsets im normalisierten Text. */
function splitIntoParagraphs(text: string): Block[] {
  const blocks: Block[] = [];
  const pattern = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;

  for (const match of text.matchAll(pattern)) {
    const value = match[0].trim();
    if (value.length > 0) {
      blocks.push({
        text: value,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return blocks;
}

/**
 * Zerlegt einen ueberlangen Absatz an Satzgrenzen.
 * Findet sich keine, wird hart geschnitten - besser ein harter Schnitt als
 * ein Chunk, den das Embedding-Modell abschneidet.
 */
function splitLongBlock(block: Block): Block[] {
  const pieces: Block[] = [];
  const sentences = block.text.match(/[^.!?]+[.!?]*\s*/g) ?? [block.text];

  let buffer = "";
  let bufferStart = block.start;
  let cursor = block.start;

  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed.length > 0) {
      pieces.push({ text: trimmed, start: bufferStart, end: cursor });
    }
    buffer = "";
    bufferStart = cursor;
  };

  for (const sentence of sentences) {
    if (sentence.length > MAX_SIZE) {
      flush();
      // Einzelner Satz laenger als das Maximum: hart schneiden.
      for (let offset = 0; offset < sentence.length; offset += MAX_SIZE) {
        const piece = sentence.slice(offset, offset + MAX_SIZE);
        pieces.push({
          text: piece.trim(),
          start: cursor + offset,
          end: cursor + offset + piece.length,
        });
      }
      cursor += sentence.length;
      bufferStart = cursor;
      continue;
    }

    if (buffer.length + sentence.length > MAX_SIZE && buffer.length > 0) {
      flush();
    }

    buffer += sentence;
    cursor += sentence.length;
  }

  flush();
  return pieces.filter((piece) => piece.text.length > 0);
}

/**
 * Das Ende eines Blocks, hoechstens maxChars lang, moeglichst an einer
 * Satzgrenze beginnend.
 *
 * Ganze Absaetze zu uebertragen reicht nicht: ein Absatz ist haeufig laenger
 * als die gewuenschte Ueberlappung, und dann entstuende gar keine.
 */
function tailOfBlock(block: Block, maxChars: number): Block | null {
  if (block.text.length <= maxChars) {
    return { ...block };
  }

  const window = block.text.slice(block.text.length - maxChars);

  // Erster Zeichenanfang nach einem Satzende, sonst nach dem ersten Leerzeichen.
  const afterSentence = window.search(/(?<=[.!?]["')\]]?\s)\S/);
  const cut =
    afterSentence >= 0 ? afterSentence : Math.max(window.indexOf(" ") + 1, 0);

  const text = window.slice(cut).trim();
  if (text.length === 0) {
    return null;
  }

  return { text, start: block.end - text.length, end: block.end };
}

/**
 * Baut aus den Segmenten einer Quelle die Chunkliste.
 * Segmentgrenzen werden nie ueberschritten: ein Chunk gehoert immer zu genau
 * einer Seite, sonst waere die Seitenzahl im Zitat gelogen.
 */
export function chunkSegments(segments: TextSegment[]): SourceChunk[] {
  const chunks: SourceChunk[] = [];

  for (const segment of segments) {
    const text = normalizeText(segment.text);
    if (text.length === 0) continue;

    const blocks = splitIntoParagraphs(text).flatMap((block) =>
      block.text.length > MAX_SIZE ? splitLongBlock(block) : [block],
    );

    let current: Block[] = [];
    let currentLength = 0;
    /** Steht seit dem letzten Chunk neuer Inhalt an, oder nur Ueberlappung? */
    let hasNewContent = false;

    const emit = () => {
      if (current.length === 0 || !hasNewContent) return;

      chunks.push({
        index: chunks.length,
        content: current.map((block) => block.text).join("\n\n"),
        metadata: {
          ...(segment.page === undefined ? {} : { page: segment.page }),
          start: current[0].start,
          end: current[current.length - 1].end,
        },
      });

      // Das Ende des letzten Blocks wandert in den naechsten Chunk, damit ein
      // Satz an der Grenze in beiden Chunks vollstaendig vorkommt.
      const tail = tailOfBlock(current[current.length - 1], OVERLAP_SIZE);
      current = tail ? [tail] : [];
      currentLength = tail ? tail.text.length : 0;
      hasNewContent = false;
    };

    for (const block of blocks) {
      if (
        hasNewContent &&
        currentLength > 0 &&
        currentLength + block.text.length > TARGET_SIZE
      ) {
        emit();
      }

      current.push(block);
      currentLength += block.text.length;
      hasNewContent = true;
    }

    // Der Rest wird ausgegeben, sofern er nicht nur aus Ueberlappung besteht.
    emit();
  }

  return chunks;
}
