import { describe, expect, it } from "vitest";

import { isBlockedHost } from "@/lib/ingestion/extract";
import { parseSourceUrl } from "@/lib/sources";

/**
 * Zwei Filter, die den Server vor dem schuetzen, was Nutzer eintippen.
 *
 * Ohne Auth kann jeder eine beliebige Adresse hinterlegen, und abgerufen
 * wird sie von unserem Server. Faellt einer der beiden Filter aus, ist das
 * kein Schoenheitsfehler.
 */

describe("parseSourceUrl", () => {
  it("nimmt http und https an", () => {
    expect(parseSourceUrl("https://beispiel.de/artikel")?.protocol).toBe(
      "https:",
    );
    expect(parseSourceUrl("http://beispiel.de")?.protocol).toBe("http:");
  });

  it("ignoriert Leerraum am Rand", () => {
    expect(parseSourceUrl("  https://beispiel.de  ")?.hostname).toBe(
      "beispiel.de",
    );
  });

  it.each([
    ["javascript:alert(1)", "javascript"],
    ["data:text/html,<script>alert(1)</script>", "data"],
    ["file:///etc/passwd", "file"],
    ["ftp://beispiel.de/datei.txt", "ftp"],
  ])("weist %s ab", (eingabe) => {
    expect(parseSourceUrl(eingabe)).toBeNull();
  });

  it.each(["", "   ", "kein-url", "beispiel.de"])(
    "weist unbrauchbare Eingabe ab: %j",
    (eingabe) => {
      expect(parseSourceUrl(eingabe)).toBeNull();
    },
  );
});

describe("isBlockedHost", () => {
  it.each([
    ["localhost", "Loopback"],
    ["app.localhost", "Loopback-Unterdomaene"],
    ["dienst.local", "lokales Netz"],
    ["dienst.internal", "internes Netz"],
    ["metadata.google.internal", "Cloud-Metadaten"],
    ["127.0.0.1", "Loopback"],
    ["0.0.0.0", "unspezifiziert"],
    ["10.0.0.5", "privates Netz"],
    ["172.16.0.1", "privates Netz, untere Grenze"],
    ["172.31.255.254", "privates Netz, obere Grenze"],
    ["192.168.1.1", "privates Netz"],
    ["169.254.169.254", "Cloud-Metadaten"],
    ["224.0.0.1", "Multicast"],
    ["::1", "IPv6-Loopback"],
    ["fe80::1", "IPv6 Link-Local"],
    ["fc00::1", "IPv6 Unique Local"],
    ["fd12:3456::1", "IPv6 Unique Local"],
  ])("sperrt %s (%s)", (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it.each([
    "beispiel.de",
    "de.wikipedia.org",
    "8.8.8.8",
    "172.15.0.1",
    "172.32.0.1",
    "193.99.144.80",
  ])("laesst %s durch", (host) => {
    expect(isBlockedHost(host)).toBe(false);
  });

  it("prueft unabhaengig von Gross- und Kleinschreibung", () => {
    expect(isBlockedHost("LOCALHOST")).toBe(true);
    expect(isBlockedHost("Metadata.Google.Internal")).toBe(true);
  });

  it("erkennt IPv6 auch in Klammern", () => {
    // So steht die Adresse in einer URL: http://[::1]/
    expect(isBlockedHost("[::1]")).toBe(true);
  });
});
