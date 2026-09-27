import { describe, expect, it } from "vitest";
import { parseDsn, scrub, sentryEnvelope } from "@/server/observability";

describe("observability", () => {
  it("parses a Sentry DSN into the envelope endpoint", () => {
    expect(parseDsn("https://abc123@o4507.ingest.sentry.io/4508")).toEqual({ endpoint: "https://o4507.ingest.sentry.io/api/4508/envelope/", key: "abc123", raw: "https://abc123@o4507.ingest.sentry.io/4508" });
    expect(parseDsn("http://abc@host/1")).toBeNull();
    expect(parseDsn("nonsense")).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
  });

  it("scrubs tokens and keys from messages", () => {
    const s = scrub("GET /me?access_token=EAABxyz123&x=1 Authorization: Bearer ya29.a0AfH6 key sk-proj-abcdefghijkl whsec_abcdefghij sk_live_abcdefghij");
    expect(s).not.toMatch(/EAABxyz123|ya29\.a0AfH6|abcdefghijkl|whsec_abcdefghij|sk_live_abcdefghij/);
  });

  it("builds a 3-line envelope without secrets or request bodies", () => {
    const dsn = parseDsn("https://abc@o1.ingest.sentry.io/2")!;
    const env = sentryEnvelope(dsn, new Error("token refresh failed: refresh_token=1//secret"), "oauth", { provider: "google", organizationId: "org_1" });
    const [head, type, event] = env.split("\n").map((l) => JSON.parse(l));
    expect(head.dsn).toBe(dsn.raw);
    expect(type).toEqual({ type: "event" });
    expect(event.tags).toMatchObject({ area: "oauth", provider: "google" });
    expect(event.exception.values[0].value).not.toContain("1//secret");
    expect(JSON.stringify(event)).not.toMatch(/cookie|request/i);
  });
});
