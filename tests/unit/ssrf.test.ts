import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { LookupAddress } from "node:dns";
import { assertAllowedHost, isBlockedIp, normalizeUrl, safeFetchText, UnsafeUrlError } from "@/server/net/safe-fetch";

describe("blocked address ranges", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "2002:7f00:1::1",
  ])("%s is blocked", (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"])("%s is public", (ip) => expect(isBlockedIp(ip)).toBe(false));

  it("rejects internal host names and IP literal tricks without DNS", () => {
    for (const h of ["localhost", "LOCALHOST.", "api.localhost", "printer.local", "db.internal", "metadata.google.internal", "[::1]"]) expect(() => assertAllowedHost(h)).toThrow(UnsafeUrlError);
    // WHATWG URL normalizes decimal/hex/short IPv4 forms to dotted quads before our check.
    for (const u of ["http://2130706433/", "http://0x7f000001/", "http://127.1/", "http://[::ffff:127.0.0.1]/"]) expect(() => assertAllowedHost(normalizeUrl(u).hostname)).toThrow(UnsafeUrlError);
  });

  it("refuses private and metadata targets end to end", async () => {
    for (const u of ["http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "http://[::1]/"]) await expect(safeFetchText(u)).rejects.toThrow();
  });
});

describe("DNS rebinding and redirects (local server)", () => {
  let server: http.Server;
  let port = "";
  const hits: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(`${req.headers.host}${req.url}`);
      if (req.url === "/to-private") return void res.writeHead(302, { location: "http://internal-target.test/secret" }).end();
      if (req.url === "/to-metadata") return void res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
      if (req.url === "/again") return void res.writeHead(302, { location: `http://site.test:${port}/page` }).end();
      if (req.url === "/binary") return void res.writeHead(200, { "content-type": "application/octet-stream" }).end("BINARY");
      if (req.url === "/big") return void res.writeHead(200, { "content-type": "text/html" }).end("x".repeat(50_000));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<title>ok</title>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = String((server.address() as AddressInfo).port);
  });
  afterAll(() => server.close());

  const addr = (address: string): LookupAddress => ({ address, family: address.includes(":") ? 6 : 4 });
  // The local test server lives on 127.0.0.1; tests explicitly allow only that IP and port.
  const overrides = (resolve: (h: string) => Promise<LookupAddress[]>) => ({ resolve, allowIps: ["127.0.0.1"], allowPorts: [port] });

  it("connects to exactly the address that was validated", async () => {
    const res = await safeFetchText(`http://site.test:${port}/`, { unsafeTestOverrides: overrides(async () => [addr("127.0.0.1")]) });
    expect(res.body).toContain("<title>ok</title>");
    expect(hits.at(-1)).toBe(`site.test:${port}/`);
  });

  it("rejects a host whose DNS answer contains any private address", async () => {
    const before = hits.length;
    await expect(safeFetchText(`http://evil.test:${port}/`, { unsafeTestOverrides: overrides(async () => [addr("127.0.0.1"), addr("10.0.0.1")]) })).rejects.toThrow("private address");
    expect(hits.length).toBe(before); // no connection was made
  });

  it("re-resolves on every hop: a rebinding answer on the second lookup is blocked", async () => {
    let calls = 0;
    const flip = async () => (++calls === 1 ? [addr("127.0.0.1")] : [addr("169.254.169.254")]);
    await expect(safeFetchText(`http://site.test:${port}/again`, { unsafeTestOverrides: overrides(flip) })).rejects.toThrow("private address");
    expect(calls).toBe(2);
  });

  it("blocks redirects to private hosts and metadata IPs", async () => {
    const resolve = async (h: string) => (h === "internal-target.test" ? [addr("192.168.0.10")] : [addr("127.0.0.1")]);
    await expect(safeFetchText(`http://site.test:${port}/to-private`, { unsafeTestOverrides: overrides(resolve) })).rejects.toThrow("private address");
    await expect(safeFetchText(`http://site.test:${port}/to-metadata`, { unsafeTestOverrides: overrides(resolve) })).rejects.toThrow(UnsafeUrlError);
  });

  it("ignores non-text content and caps body size", async () => {
    const resolve = async () => [addr("127.0.0.1")];
    expect((await safeFetchText(`http://site.test:${port}/binary`, { unsafeTestOverrides: overrides(resolve) })).body).toBe("");
    expect((await safeFetchText(`http://site.test:${port}/big`, { maxBytes: 10_000, unsafeTestOverrides: overrides(resolve) })).body.length).toBeLessThanOrEqual(10_000);
  });

  it("limits redirect chains", async () => {
    await expect(safeFetchText(`http://site.test:${port}/again`, { maxRedirects: 0, unsafeTestOverrides: overrides(async () => [addr("127.0.0.1")]) })).rejects.toThrow("Too many redirects");
  });
});
