/**
 * Rohes PCM in eine abspielbare WAV-Datei verpacken.
 *
 * Das TTS-Modell liefert audio/L16;codec=pcm;rate=24000 - reine Abtastwerte
 * ohne jeden Kopf. Kein Browser spielt das in einem audio-Element ab. Die
 * 44 Bytes davor machen daraus eine Datei, die ueberall laeuft.
 *
 * Reine Rechnerei, keine Abhaengigkeit, kein Netz - und damit vollstaendig
 * testbar.
 */

/** Groesse des kanonischen WAV-Kopfes. */
export const WAV_HEADER_BYTES = 44;

export type PcmFormat = {
  /** Abtastrate in Hertz, beim Anbieter 24000. */
  sampleRate: number;
  /** Kanaele. Das Modell liefert mono. */
  channels: number;
  /** Bits je Abtastwert. L16 heisst 16. */
  bitsPerSample: number;
};

export const GEMINI_PCM: PcmFormat = {
  sampleRate: 24_000,
  channels: 1,
  bitsPerSample: 16,
};

/**
 * Liest das Format aus dem Mime-Typ des Anbieters.
 *
 * Beispiel: "audio/L16;codec=pcm;rate=24000". Fehlt eine Angabe, gilt der
 * bekannte Standardwert - aber eine abweichende Rate wird uebernommen, statt
 * stillschweigend falsch abgespielt zu werden.
 */
export function parsePcmMimeType(mimeType: string): PcmFormat {
  const rate = mimeType.match(/rate=(\d+)/);
  const bits = mimeType.match(/L(\d+)/);

  return {
    sampleRate: rate ? Number(rate[1]) : GEMINI_PCM.sampleRate,
    channels: GEMINI_PCM.channels,
    bitsPerSample: bits ? Number(bits[1]) : GEMINI_PCM.bitsPerSample,
  };
}

/** Sekunden Audio, die in einem PCM-Block stecken. */
export function pcmDurationSeconds(
  byteLength: number,
  format: PcmFormat = GEMINI_PCM,
): number {
  const bytesProSekunde =
    format.sampleRate * format.channels * (format.bitsPerSample / 8);

  return byteLength / bytesProSekunde;
}

/**
 * Setzt den WAV-Kopf vor die Abtastwerte.
 *
 * Aufbau nach RIFF: "RIFF", Restlaenge, "WAVE", dann der Abschnitt "fmt "
 * mit dem Format und der Abschnitt "data" mit den Werten. Alle Zahlen
 * little-endian.
 */
export function pcmToWav(
  pcm: Uint8Array,
  format: PcmFormat = GEMINI_PCM,
): Uint8Array {
  const { sampleRate, channels, bitsPerSample } = format;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(buffer);

  const schreibeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  schreibeText(0, "RIFF");
  // Groesse ab hier: alles ausser "RIFF" und diesem Feld selbst.
  view.setUint32(4, 36 + pcm.byteLength, true);
  schreibeText(8, "WAVE");

  schreibeText(12, "fmt ");
  view.setUint32(16, 16, true); // Laenge des fmt-Abschnitts
  view.setUint16(20, 1, true); // 1 = unkomprimiertes PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  schreibeText(36, "data");
  view.setUint32(40, pcm.byteLength, true);

  new Uint8Array(buffer, WAV_HEADER_BYTES).set(pcm);

  return new Uint8Array(buffer);
}
