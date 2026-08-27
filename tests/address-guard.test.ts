import { describe, expect, it } from "vitest";

import { isBlockedAddress } from "@/lib/ingestion/safe-fetch";

/**
 * Die Adresspruefung ist die Stelle, an der SSRF verhindert wird.
 *
 * Sie haengt in der lookup-Funktion und entscheidet ueber die IP, zu der
 * tatsaechlich verbunden wird. Eine Luecke hier ist kein Schoenheitsfehler:
 * ohne Auth kann jeder eine Adresse hinterlegen, abgerufen wird sie von
 * unserem Server.
 */
describe("isBlockedAddress", () => {
  describe("IPv4 im gesperrten Bereich", () => {
    it.each([
      ["0.0.0.0", "dieses Netz"],
      ["10.0.0.1", "privat"],
      ["10.255.255.254", "privat, obere Grenze"],
      ["127.0.0.1", "Loopback"],
      ["127.255.255.254", "Loopback, ganzer Block"],
      ["100.64.0.1", "Carrier-Grade NAT"],
      ["100.127.255.254", "Carrier-Grade NAT, obere Grenze"],
      ["169.254.169.254", "Cloud-Metadaten"],
      ["172.16.0.1", "privat, untere Grenze"],
      ["172.31.255.254", "privat, obere Grenze"],
      ["192.0.0.1", "IETF-Protokollzuweisungen"],
      ["192.168.0.1", "privat"],
      ["198.18.0.1", "Benchmarking"],
      ["198.19.255.254", "Benchmarking, obere Grenze"],
      ["224.0.0.1", "Multicast"],
      ["255.255.255.255", "Broadcast"],
    ])("sperrt %s (%s)", (ip) => {
      expect(isBlockedAddress(ip)).toBe(true);
    });
  });

  describe("IPv4 ausserhalb", () => {
    it.each([
      ["8.8.8.8", "oeffentlicher Resolver"],
      ["1.1.1.1", "oeffentlicher Resolver"],
      ["172.15.255.254", "knapp unter dem privaten Block"],
      ["172.32.0.1", "knapp ueber dem privaten Block"],
      ["100.63.255.254", "knapp unter Carrier-Grade NAT"],
      ["100.128.0.1", "knapp ueber Carrier-Grade NAT"],
      ["192.167.255.254", "knapp unter 192.168"],
      ["192.169.0.1", "knapp ueber 192.168"],
      ["198.17.255.254", "knapp unter Benchmarking"],
      ["198.20.0.1", "knapp ueber Benchmarking"],
      ["169.253.0.1", "knapp unter Link-Local"],
      ["223.255.255.254", "knapp unter Multicast"],
      ["172.66.147.243", "echte oeffentliche Adresse"],
    ])("laesst %s durch (%s)", (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    });
  });

  describe("IPv6", () => {
    it.each([
      ["::", "unspezifiziert"],
      ["::1", "Loopback"],
      ["fe80::1", "Link-Local"],
      ["feb0::1", "Link-Local, oberes Ende"],
      ["fc00::1", "Unique Local"],
      ["fd00::1", "Unique Local"],
      ["ff02::1", "Multicast"],
    ])("sperrt %s (%s)", (ip) => {
      expect(isBlockedAddress(ip)).toBe(true);
    });

    it.each(["2606:4700::1", "2001:4860:4860::8888"])(
      "laesst %s durch",
      (ip) => {
        expect(isBlockedAddress(ip)).toBe(false);
      },
    );
  });

  describe("IPv4 in IPv6 eingebettet", () => {
    // Die klassische Umgehung: ::ffff:127.0.0.1 ist Loopback, sieht als
    // IPv6-Adresse aber nicht danach aus. Wer nur auf IPv6-Praefixe prueft,
    // laesst sie durch.
    it.each([
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      "::ffff:10.0.0.1",
      "::ffff:192.168.1.1",
    ])("sperrt %s", (ip) => {
      expect(isBlockedAddress(ip)).toBe(true);
    });

    it("laesst eine eingebettete oeffentliche Adresse durch", () => {
      expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
    });
  });

  describe("Schreibweisen", () => {
    it("ignoriert Gross- und Kleinschreibung", () => {
      expect(isBlockedAddress("FE80::1")).toBe(true);
      expect(isBlockedAddress("FD00::1")).toBe(true);
    });

    it("ignoriert Leerraum am Rand", () => {
      expect(isBlockedAddress("  127.0.0.1  ")).toBe(true);
    });

    it("erkennt die Klammerform aus URLs", () => {
      expect(isBlockedAddress("[::1]")).toBe(true);
    });
  });
});
