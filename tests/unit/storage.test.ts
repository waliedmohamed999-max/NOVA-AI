import { describe, expect, it } from "vitest";
import { S3Driver, s3ConfigFromEnv, uriEncode } from "@/server/storage/s3";
import { detectType, keyBelongsTo, orgKey } from "@/server/storage";

// Published AWS Signature V4 examples (S3 docs: "Authenticating Requests: Using Query Parameters"
// and "Examples: Signature Calculations" — GET Object with Range header).
const AWS_EXAMPLE = {
  bucket: "examplebucket",
  region: "us-east-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  endpoint: "https://s3.amazonaws.com",
  forcePathStyle: false,
};
const EXAMPLE_TIME = new Date("2013-05-24T00:00:00Z");

describe("S3 SigV4", () => {
  it("matches AWS's presigned URL example", () => {
    const d = new S3Driver(AWS_EXAMPLE);
    const url = d.presignGet("test.txt", 86400, { now: EXAMPLE_TIME });
    expect(url.startsWith("https://examplebucket.s3.amazonaws.com/test.txt?")).toBe(true);
    expect(new URL(url).searchParams.get("X-Amz-Signature")).toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });

  it("matches AWS's header-signed GET example", () => {
    const d = new S3Driver(AWS_EXAMPLE);
    const { headers } = d.signRequest("GET", "test.txt", { now: EXAMPLE_TIME, headers: { range: "bytes=0-9" } });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("uses path-style addressing for R2/MinIO endpoints and encodes keys per RFC 3986", () => {
    const d = new S3Driver({ ...AWS_EXAMPLE, endpoint: "https://acc.r2.cloudflarestorage.com", forcePathStyle: undefined, region: "auto" });
    expect(d.target("org1/2026-09/a b(1).png")).toEqual({ origin: "https://acc.r2.cloudflarestorage.com", host: "acc.r2.cloudflarestorage.com", path: "/examplebucket/org1/2026-09/a%20b%281%29.png" });
    expect(uriEncode("a/b*c", true)).toBe("a/b%2Ac");
  });

  it("rejects traversal and empty-segment keys before building any request", () => {
    const d = new S3Driver(AWS_EXAMPLE);
    for (const bad of ["../x", "a/../b", "/abs", "a//b", ""]) expect(() => d.target(bad)).toThrow("Invalid storage key");
  });

  it("puts, gets and deletes through fetch with signed headers, and never leaks credentials in errors", async () => {
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    const store = new Map<string, Uint8Array>();
    const fakeFetch = (async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ url, method: init.method!, headers });
      const path = new URL(url).pathname;
      if (init.method === "PUT") store.set(path, init.body as Uint8Array);
      if (init.method === "DELETE") store.delete(path);
      if (init.method === "GET") return store.has(path) ? new Response(store.get(path) as BodyInit) : new Response("no", { status: 403 });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const d = new S3Driver({ ...AWS_EXAMPLE, endpoint: "http://minio.local:9000" }, { fetch: fakeFetch });
    await d.put("org1/x.txt", Buffer.from("hello"), "text/plain");
    expect((await d.get("org1/x.txt")).toString()).toBe("hello");
    await d.delete("org1/x.txt");
    expect(calls.map((c) => c.method)).toEqual(["PUT", "GET", "DELETE"]);
    expect(calls[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\//);
    expect(calls[0].headers["content-type"]).toBe("text/plain");
    const err = await d.get("org1/x.txt").catch((e: Error) => e.message);
    expect(err).toBe("S3 GET failed with HTTP 403");
    expect(err).not.toContain(AWS_EXAMPLE.secretAccessKey);
  });

  it("refuses to start without bucket or credentials and reads R2 defaults from env", () => {
    expect(() => new S3Driver({ ...AWS_EXAMPLE, bucket: "" })).toThrow();
    expect(s3ConfigFromEnv({ S3_BUCKET: "b", S3_ENDPOINT: "https://x.r2.cloudflarestorage.com", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" } as unknown as NodeJS.ProcessEnv)).toMatchObject({ region: "auto", endpoint: "https://x.r2.cloudflarestorage.com" });
  });
});

describe("object keys and validation", () => {
  it("scopes every key to its organization", () => {
    const key = orgKey("org123", "png");
    expect(key).toMatch(/^org123\/\d{4}-\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(keyBelongsTo("org123", key)).toBe(true);
    expect(keyBelongsTo("org999", key)).toBe(false);
    expect(keyBelongsTo("org123", "org123/../org999/x.png")).toBe(false);
    expect(() => orgKey("../evil", "png")).toThrow();
    expect(() => orgKey("org1", "p/ng")).toThrow();
  });

  it("detects type from content, not the file name", () => {
    expect(detectType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "x.txt")?.mime).toBe("image/png");
    expect(detectType(Buffer.from("MZ\x00\x00binary"), "evil.png")).toBeNull();
    expect(detectType(Buffer.from("a,b\n1,2"), "data.csv")?.mime).toBe("text/csv");
    expect(detectType(Buffer.from("<script>"), "x.html")).toBeNull();
  });
});
