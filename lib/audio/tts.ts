import { GEMINI_BASE, geminiRequest } from "@/lib/gemini";

import { formatScript, SPEAKERS, type ScriptLine } from "./script";
import { parsePcmMimeType, pcmToWav, type PcmFormat } from "./wav";

/**
 * Sprachausgabe fuer das Skript.
 *
 * Zwei Stimmen in einem einzigen Aufruf - das Modell kann mehrere Sprecher,
 * solange die Namen im Skript zu den konfigurierten passen.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

/**
 * Stimmen fuer die beiden Sprecher.
 *
 * Feste Zuordnung: die Namen stehen so im Skript, und das Modell ordnet
 * anhand dieser Namen zu. Ein Vertippen hier fuehrt nicht zu einem Fehler,
 * sondern zu einer Aufnahme mit nur einer Stimme.
 */
const VOICES: Record<(typeof SPEAKERS)[number], string> = {
  Anna: "Kore",
  Ben: "Puck",
};

/**
 * Eigenes Modell fuer die Sprachausgabe.
 *
 * Nicht LLM_MODEL: das Chat-Modell kann kein Audio. Per Env austauschbar,
 * mit einem Standard, der geprueft ist.
 */
function readSpeechModel(): string {
  return process.env.SPEECH_MODEL ?? "gemini-2.5-flash-preview-tts";
}

/**
 * Wartebudget.
 *
 * Knapp gehalten: die Sprachausgabe laeuft in derselben Function wie die
 * Skripterzeugung, und die Laufzeit ist der eigentliche Engpass. Lieber
 * sauber abbrechen als ins Timeout laufen.
 */
const RETRY_BUDGET_MS = 6_000;

export type SpokenAudio = {
  /** Fertige WAV-Datei, direkt abspielbar. */
  wav: Uint8Array;
  format: PcmFormat;
  /** Laenge der rohen Abtastwerte, ohne den Kopf. */
  pcmBytes: number;
};

type SpeechResponse = {
  candidates?: {
    content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
  }[];
};

/** Spricht das Skript mit zwei Stimmen und liefert eine fertige WAV-Datei. */
export async function synthesizeScript(
  lines: ScriptLine[],
): Promise<SpokenAudio> {
  if (lines.length === 0) {
    throw new Error("Ohne Skript gibt es nichts zu sprechen.");
  }

  const model = readSpeechModel();

  const response = await geminiRequest(
    `${GEMINI_BASE}/models/${model}:generateContent`,
    {
      contents: [
        {
          parts: [
            {
              text: `Lies den folgenden Dialog natuerlich und in normalem Tempo vor:\n\n${formatScript(lines)}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: SPEAKERS.map((speaker) => ({
              speaker,
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: VOICES[speaker] },
              },
            })),
          },
        },
      },
    },
    { budgetMs: RETRY_BUDGET_MS },
  );

  const json = (await response.json()) as SpeechResponse;
  const daten = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;

  if (!daten?.data) {
    throw new Error("Der Anbieter lieferte kein Audio.");
  }

  const pcm = new Uint8Array(Buffer.from(daten.data, "base64"));

  if (pcm.byteLength === 0) {
    throw new Error("Das gelieferte Audio war leer.");
  }

  // Das Format kommt aus der Antwort, nicht aus einer Annahme: eine
  // abweichende Abtastrate wuerde die Datei sonst in falscher
  // Geschwindigkeit abspielen.
  const format = parsePcmMimeType(daten.mimeType ?? "");

  return { wav: pcmToWav(pcm, format), format, pcmBytes: pcm.byteLength };
}
