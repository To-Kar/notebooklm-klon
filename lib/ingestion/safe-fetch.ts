import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";

/**
 * Abruf fremder Adressen, ohne den eigenen Server zum Werkzeug zu machen.
 *
 * Ohne Auth kann jeder eine beliebige URL hinterlegen, abgerufen wird sie von
 * uns. Eine Pruefung des Hostnamens allein genuegt nicht: ein unauffaelliger
 * Name kann per DNS auf 169.254.169.254 zeigen.
 *
 * Der naheliegende Weg - erst aufloesen, pruefen, dann abrufen - hat eine
 * Luecke: die Abrufschicht fragt das DNS erneut, und ein Server mit kurzer TTL
 * kann beim zweiten Mal etwas anderes liefern (DNS-Rebinding). Deshalb haengt
 * die Pruefung hier in der lookup-Funktion, die beim Verbindungsaufbau
 * gerufen wird. Geprueft wird damit genau die Adresse, zu der auch verbunden
 * wird.
 *
 * WICHTIG: Nur aus Server-Code importieren.
 */

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedAddressError";
  }
}

/**
 * Liegt diese IP in einem Bereich, den wir nicht abrufen?
 *
 * Deckt Loopback, private Netze, Link-Local samt Cloud-Metadaten, Multicast
 * und die reservierten Bereiche ab - jeweils fuer IPv4 und IPv6.
 */
export function isBlockedAddress(address: string): boolean {
  const ip = address.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  // IPv4-in-IPv6 ist die klassische Umgehung: ::ffff:127.0.0.1 ist Loopback,
  // sieht aber nicht danach aus. Auf die IPv4-Form zurueckfuehren.
  const eingebettet = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  const zuPruefen = eingebettet ? eingebettet[1] : ip;

  const ipv4 = zuPruefen.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];

    if (a === 0) return true; // "dieses Netz"
    if (a === 10) return true; // privat
    if (a === 127) return true; // Loopback
    if (a === 100 && b >= 64 && b <= 127) return true; // Carrier-Grade NAT
    if (a === 169 && b === 254) return true; // Link-Local, Cloud-Metadaten
    if (a === 172 && b >= 16 && b <= 31) return true; // privat
    if (a === 192 && b === 0) return true; // IETF-Protokollzuweisungen
    if (a === 192 && b === 168) return true; // privat
    if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
    if (a >= 224) return true; // Multicast und reserviert

    return false;
  }

  // IPv6
  if (zuPruefen === "::" || zuPruefen === "::1") return true;
  if (/^fe[89ab]/.test(zuPruefen)) return true; // Link-Local
  if (/^f[cd]/.test(zuPruefen)) return true; // Unique Local
  if (/^ff/.test(zuPruefen)) return true; // Multicast

  return false;
}

/**
 * Aufloesung mit Pruefung.
 *
 * Wird von node:http beim Verbindungsaufbau gerufen. Faellt die Adresse in
 * einen gesperrten Bereich, kommt die Verbindung gar nicht erst zustande.
 */
const pruefenderLookup: LookupFunction = (hostname, _options, callback) => {
  dnsLookup(hostname, { all: true }, (fehler, adressen) => {
    if (fehler) {
      // Bei einem Fehler ignoriert Node die Adresse; sie muss nur da sein.
      callback(fehler, [], 0);
      return;
    }

    const erlaubt = adressen.filter((a) => !isBlockedAddress(a.address));

    if (erlaubt.length === 0) {
      callback(
        new BlockedAddressError(
          `${hostname} loest auf eine Adresse im privaten Netz auf und wird nicht abgerufen.`,
        ),
        [],
        0,
      );
      return;
    }

    // Nur gepruefte Adressen weiterreichen. Node verbindet sich ausschliesslich
    // zu dem, was hier zurueckkommt.
    callback(null, erlaubt, erlaubt[0].family);
  });
};

/**
 * Kennung, mit der wir uns vorstellen.
 *
 * node:https schickt von sich aus keinen User-Agent - anders als fetch, das
 * hier vorher stand. Manche Seiten, darunter Wikipedia, antworten darauf mit
 * 403. Eine ehrliche Kennung ist ausserdem das, was Betreiber erwarten
 * duerfen, wenn ein Dienst ihre Seiten abruft.
 */
const USER_AGENT =
  "NotebookLM-Klon/0.1 (Recherche-Assistent; quellengestuetzte Zusammenfassung)";

export type SafeResponse = {
  status: number;
  contentType: string;
  /** Ziel einer Weiterleitung, sonst null. */
  location: string | null;
  body: string;
};

/**
 * Einzelner Abruf, ohne Weiterleitungen zu folgen.
 *
 * Der Aufrufer entscheidet ueber Weiterleitungen und kann so jedes Ziel
 * einzeln pruefen, statt sie der Abrufschicht zu ueberlassen.
 */
export function fetchOnce(
  url: string,
  options: { maxBytes: number; timeoutMs: number },
): Promise<SafeResponse> {
  const ziel = new URL(url);

  if (ziel.protocol !== "http:" && ziel.protocol !== "https:") {
    return Promise.reject(
      new BlockedAddressError("Nur http- und https-Adressen werden abgerufen."),
    );
  }

  const request = ziel.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<SafeResponse>((resolve, reject) => {
    const anfrage = request(
      ziel,
      {
        method: "GET",
        lookup: pruefenderLookup,
        headers: {
          accept: "text/html,text/plain",
          "user-agent": USER_AGENT,
          // node:https entpackt nichts. Ohne diese Zeile liefern manche
          // Server gzip, und der Rumpf waere Binaermuell.
          "accept-encoding": "identity",
        },
        timeout: options.timeoutMs,
      },
      (antwort) => {
        const status = antwort.statusCode ?? 0;
        const contentType = antwort.headers["content-type"] ?? "";
        const location = antwort.headers.location ?? null;

        // Bei einer Weiterleitung interessiert der Rumpf nicht.
        if (status >= 300 && status < 400 && location) {
          antwort.destroy();
          resolve({ status, contentType, location, body: "" });
          return;
        }

        let gelesen = 0;
        const teile: Buffer[] = [];

        antwort.on("data", (teil: Buffer) => {
          gelesen += teil.length;

          // Abbrechen, sobald das Limit ueberschritten ist - nicht erst
          // hinterher kuerzen. Sonst laedt ein grosser Server uns voll.
          if (gelesen > options.maxBytes) {
            antwort.destroy();
            reject(new Error("Die Seite ist zu gross."));
            return;
          }

          teile.push(teil);
        });

        antwort.on("end", () => {
          resolve({
            status,
            contentType,
            location: null,
            body: Buffer.concat(teile).toString("utf8"),
          });
        });

        antwort.on("error", reject);
      },
    );

    anfrage.on("timeout", () => {
      anfrage.destroy(new Error("Die Seite hat nicht rechtzeitig geantwortet."));
    });

    anfrage.on("error", reject);
    anfrage.end();
  });
}
