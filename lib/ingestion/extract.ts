import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

import { SOURCE_BUCKET } from "@/lib/source-limits";
import type { Source } from "@/lib/sources";
import { createAdminClient } from "@/lib/supabase/server";

import type { TextSegment } from "./chunk";
import { BlockedAddressError, fetchOnce, type SafeResponse } from "./safe-fetch";

/**
 * Holt den reinen Text einer Quelle.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

/** Obergrenze fuer abgerufene Webseiten. */
const MAX_FETCH_BYTES = 2 * 1024 * 1024;

/** Abbruch, wenn eine Seite nicht antwortet. */
const FETCH_TIMEOUT_MS = 15_000;

/** Wie viele Weiterleitungen wir mitgehen. */
const MAX_REDIRECTS = 3;

/**
 * Signalisiert, dass eine Quelle keinen verwertbaren Text hergibt.
 * Eigener Typ, damit die Ingestion das von einem technischen Fehler
 * unterscheiden und eine passende Meldung zeigen kann.
 */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

/**
 * Billige Vorpruefung auf dem Hostnamen.
 *
 * Faengt die offensichtlichen Faelle ab, bevor ueberhaupt jemand das DNS
 * fragt: localhost, .local, .internal und Adressliterale. Die eigentliche
 * Absicherung sitzt in safe-fetch.ts und prueft die aufgeloeste Adresse beim
 * Verbindungsaufbau - ein unauffaelliger Name, der per DNS ins private Netz
 * zeigt, faellt erst dort auf.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);

    if (first === 0 || first === 10 || first === 127) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true; // Cloud-Metadaten
    if (first >= 224) return true; // Multicast und reserviert
  }

  // IPv6: Loopback, Link-Local, Unique Local.
  if (host === "::1" || host.startsWith("fe80") || /^f[cd]/.test(host)) {
    return true;
  }

  return false;
}

/**
 * Folgt Weiterleitungen selbst, damit jedes Ziel einzeln geprueft wird.
 *
 * Die Abrufschicht damit zu beauftragen waere bequemer, wuerde aber die
 * Zwischenziele ungeprueft lassen - und eine Weiterleitung ins private Netz
 * ist genau der Weg, den ein Angreifer nimmt.
 */
async function fetchDocument(startUrl: string): Promise<SafeResponse> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ExtractionError("Nur http- und https-Adressen werden abgerufen.");
    }

    if (isBlockedHost(parsed.hostname)) {
      throw new ExtractionError(
        "Diese Adresse zeigt ins private Netz und wird nicht abgerufen.",
      );
    }

    const response = await fetchOnce(current, {
      maxBytes: MAX_FETCH_BYTES,
      timeoutMs: FETCH_TIMEOUT_MS,
    });

    if (!response.location) {
      return response;
    }

    current = new URL(response.location, current).toString();
  }

  throw new ExtractionError("Zu viele Weiterleitungen.");
}

/** Laedt eine Datei aus dem privaten Bucket. */
async function downloadFile(storagePath: string): Promise<ArrayBuffer> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.storage
    .from(SOURCE_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error(
      `Datei konnte nicht geladen werden: ${error?.message ?? "keine Daten"}`,
    );
  }

  return data.arrayBuffer();
}

/** PDF: ein Segment pro Seite, damit Zitate eine Seitenzahl bekommen. */
async function extractPdf(buffer: ArrayBuffer): Promise<TextSegment[]> {
  // unpdf ist ESM-only, deshalb dynamisch geladen.
  const { extractText, getDocumentProxy } = await import("unpdf");

  const document = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(document, { mergePages: false });

  return text
    .map((pageText, index) => ({ text: pageText, page: index + 1 }))
    .filter((segment) => segment.text.trim().length > 0);
}

/** Webseite: Artikeltext statt Navigation, Footer und Werbung. */
function extractHtml(html: string): TextSegment[] {
  const { document } = parseHTML(html);
  const article = new Readability(document).parse();

  // Readability gibt null zurueck, wenn die Seite nicht artikelartig ist.
  const text = article?.textContent ?? document.body?.textContent ?? "";

  return [{ text }];
}

/**
 * Zerlegt eine Quelle in Textsegmente.
 * Wirft ExtractionError, wenn nichts Verwertbares herauskommt.
 */
export async function extractSourceSegments(
  source: Source,
): Promise<TextSegment[]> {
  let segments: TextSegment[];

  if (source.type === "url") {
    if (!source.url) {
      throw new ExtractionError("Der Quelle fehlt die Adresse.");
    }

    let response;
    try {
      response = await fetchDocument(source.url);
    } catch (error) {
      // Eine gesperrte Adresse ist kein technischer Fehler, sondern eine
      // Entscheidung - der Nutzer soll den Grund lesen koennen.
      if (error instanceof BlockedAddressError) {
        throw new ExtractionError(error.message);
      }
      throw error;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ExtractionError(
        `Die Seite antwortete mit Status ${response.status}.`,
      );
    }

    if (response.contentType.includes("text/html")) {
      segments = extractHtml(response.body);
    } else if (response.contentType.includes("text/plain")) {
      segments = [{ text: response.body }];
    } else {
      throw new ExtractionError(
        `Inhaltstyp wird nicht unterstützt: ${response.contentType || "unbekannt"}`,
      );
    }
  } else {
    if (!source.storage_path) {
      throw new ExtractionError("Der Quelle fehlt der Dateipfad.");
    }

    const buffer = await downloadFile(source.storage_path);

    segments =
      source.type === "pdf"
        ? await extractPdf(buffer)
        : [{ text: new TextDecoder().decode(buffer) }];
  }

  const totalLength = segments.reduce(
    (sum, segment) => sum + segment.text.trim().length,
    0,
  );

  if (totalLength === 0) {
    throw new ExtractionError(
      "Aus dieser Quelle liess sich kein Text gewinnen. " +
        "Bei PDFs liegt das meist an eingescannten Seiten ohne Textebene.",
    );
  }

  return segments;
}
