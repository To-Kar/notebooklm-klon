import { describe, expect, it } from "vitest";

import {
  GEMINI_PCM,
  WAV_HEADER_BYTES,
  parsePcmMimeType,
  pcmDurationSeconds,
  pcmToWav,
} from "@/lib/audio/wav";

/**
 * Der WAV-Kopf entscheidet, ob die Datei abspielbar ist.
 *
 * Ein falsches Feld faellt nicht durch einen Fehler auf, sondern durch
 * Rauschen, halbe Geschwindigkeit oder Stille - und das merkt man erst beim
 * Hoeren. Deshalb wird hier Byte fuer Byte geprueft.
 */

/** Liest eine little-endian-Zahl aus dem Kopf. */
function u32(wav: Uint8Array, offset: number): number {
  return new DataView(wav.buffer, wav.byteOffset).getUint32(offset, true);
}
function u16(wav: Uint8Array, offset: number): number {
  return new DataView(wav.buffer, wav.byteOffset).getUint16(offset, true);
}
function text(wav: Uint8Array, offset: number, laenge: number): string {
  return new TextDecoder().decode(wav.slice(offset, offset + laenge));
}

describe("pcmToWav", () => {
  const pcm = new Uint8Array(4800); // 0,1 s bei 24 kHz, 16 Bit, mono
  pcm.fill(7);
  const wav = pcmToWav(pcm);

  it("stellt genau 44 Bytes voran", () => {
    expect(wav.byteLength).toBe(WAV_HEADER_BYTES + pcm.byteLength);
  });

  it("schreibt die RIFF-Kennungen", () => {
    expect(text(wav, 0, 4)).toBe("RIFF");
    expect(text(wav, 8, 4)).toBe("WAVE");
    expect(text(wav, 12, 4)).toBe("fmt ");
    expect(text(wav, 36, 4)).toBe("data");
  });

  it("setzt die RIFF-Groesse auf alles nach den ersten acht Bytes", () => {
    expect(u32(wav, 4)).toBe(wav.byteLength - 8);
  });

  it("beschreibt das Format als unkomprimiertes PCM", () => {
    expect(u32(wav, 16)).toBe(16); // Laenge des fmt-Abschnitts
    expect(u16(wav, 20)).toBe(1); // 1 = PCM
  });

  it("uebernimmt Kanaele, Rate und Bittiefe", () => {
    expect(u16(wav, 22)).toBe(GEMINI_PCM.channels);
    expect(u32(wav, 24)).toBe(GEMINI_PCM.sampleRate);
    expect(u16(wav, 34)).toBe(GEMINI_PCM.bitsPerSample);
  });

  it("rechnet Byterate und Blockausrichtung passend dazu", () => {
    // Falsch gesetzt spielt die Datei zu schnell oder zu langsam ab.
    expect(u32(wav, 28)).toBe(24_000 * 1 * 2);
    expect(u16(wav, 32)).toBe(1 * 2);
  });

  it("traegt die Datenlaenge ein", () => {
    expect(u32(wav, 40)).toBe(pcm.byteLength);
  });

  it("laesst die Abtastwerte unveraendert", () => {
    expect(wav.slice(WAV_HEADER_BYTES)).toEqual(pcm);
  });

  it("kommt mit leeren Daten zurecht", () => {
    const leer = pcmToWav(new Uint8Array(0));
    expect(leer.byteLength).toBe(WAV_HEADER_BYTES);
    expect(u32(leer, 40)).toBe(0);
  });

  it("uebernimmt ein abweichendes Format", () => {
    const anders = pcmToWav(new Uint8Array(100), {
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
    });

    expect(u32(anders, 24)).toBe(48_000);
    expect(u16(anders, 22)).toBe(2);
    expect(u32(anders, 28)).toBe(48_000 * 2 * 2);
  });
});

describe("parsePcmMimeType", () => {
  it("liest Rate und Bittiefe aus der Angabe des Anbieters", () => {
    expect(parsePcmMimeType("audio/L16;codec=pcm;rate=24000")).toEqual({
      sampleRate: 24_000,
      channels: 1,
      bitsPerSample: 16,
    });
  });

  it("uebernimmt eine abweichende Rate, statt sie zu ignorieren", () => {
    // Wuerde hier stillschweigend 24000 stehenbleiben, spielte die Datei
    // in falscher Geschwindigkeit ab.
    expect(parsePcmMimeType("audio/L16;codec=pcm;rate=16000").sampleRate).toBe(
      16_000,
    );
  });

  it("faellt bei fehlenden Angaben auf die bekannten Werte zurueck", () => {
    expect(parsePcmMimeType("audio/L16")).toEqual(GEMINI_PCM);
  });
});

describe("pcmDurationSeconds", () => {
  it("rechnet Bytes in Sekunden um", () => {
    expect(pcmDurationSeconds(48_000)).toBe(1);
    expect(pcmDurationSeconds(24_000)).toBe(0.5);
  });

  it("ist mit dem gemessenen Wert des Anbieters stimmig", () => {
    // 983.566 Bytes wurden als 20,5 s Audio gemessen.
    expect(pcmDurationSeconds(983_566)).toBeCloseTo(20.5, 1);
  });
});
