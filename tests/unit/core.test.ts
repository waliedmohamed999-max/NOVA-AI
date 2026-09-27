import { describe, expect, it } from "vitest";
import { clientIp, normalizeIp, trustedHops } from "@/server/net/client-ip";
import { buildCsp, makeNonce } from "@/server/security/csp";
import { safeInternalPath } from "@/lib/safe-path";
import { applyTenantScope } from "@/server/db/tenant";
import { can, canAssignRole } from "@/server/rbac";
import { compareToRecent, engagementRate, findPatterns, pctChange, type MetricRow } from "@/server/analytics/compare";
import { scoreLead, temperatureFor } from "@/server/sales/scoring";
import { decryptSecret, encryptSecret, hashToken, randomToken } from "@/server/crypto";
import { chunkText, extractPage, pickInterestingLinks } from "@/server/knowledge/extract";
import { normalizeUrl, safeFetchText } from "@/server/net/safe-fetch";
import { offlineIntent } from "@/server/agents/workflows/command";
import { canTransition } from "@/server/content/service";
import { routeModels, downgrade } from "@/server/ai/router";
import { backoffMs } from "@/server/jobs/queue";

const scope = { organizationId: "org_a", workspaceId: "ws_a" };

describe("tenant scope injection", () => {
  it("adds org + workspace to reads on workspace models", () => {
    const args = applyTenantScope("Lead", "findMany", { where: { stage: "NEW" } }, scope);
    expect(args.where).toEqual({ stage: "NEW", organizationId: "org_a", workspaceId: "ws_a" });
  });
  it("overrides a malicious organizationId in the where clause", () => {
    const args = applyTenantScope("Lead", "findFirst", { where: { organizationId: "org_b" } }, scope);
    expect(args.where.organizationId).toBe("org_a");
  });
  it("forces scope on create and createMany", () => {
    expect(applyTenantScope("Lead", "create", { data: { name: "x", organizationId: "org_b" } }, scope).data.organizationId).toBe("org_a");
    const many = applyTenantScope("Lead", "createMany", { data: [{ name: "a" }, { name: "b", workspaceId: "ws_b" }] }, scope);
    expect(many.data.every((r: { workspaceId: string }) => r.workspaceId === "ws_a")).toBe(true);
  });
  it("strips scope keys from update data so rows cannot be moved across tenants", () => {
    const args = applyTenantScope("Lead", "update", { where: { id: "1" }, data: { name: "x", organizationId: "org_b" } }, scope);
    expect(args.data).toEqual({ name: "x" });
    expect(args.where).toMatchObject({ id: "1", organizationId: "org_a" });
  });
  it("scopes organization-level models by organization only", () => {
    const args = applyTenantScope("OrganizationMember", "findMany", {}, scope);
    expect(args.where).toEqual({ organizationId: "org_a" });
  });
  it("leaves global models untouched", () => {
    expect(applyTenantScope("User", "findMany", { where: { id: "u" } }, scope).where).toEqual({ id: "u" });
  });
});

describe("RBAC", () => {
  it("grants permissions by role", () => {
    expect(can("VIEWER", "leads:read")).toBe(true);
    expect(can("VIEWER", "content:create")).toBe(false);
    expect(can("MEMBER", "content:approve")).toBe(false);
    expect(can("MANAGER", "content:approve")).toBe(true);
    expect(can("ADMIN", "billing:manage")).toBe(false);
    expect(can("OWNER", "org:delete")).toBe(true);
  });
  it("only allows assigning roles below your own", () => {
    expect(canAssignRole("ADMIN", "MANAGER")).toBe(true);
    expect(canAssignRole("ADMIN", "ADMIN")).toBe(false);
    expect(canAssignRole("OWNER", "OWNER")).toBe(true);
  });
});

function row(id: string, daysAgo: number, er: number, extra: Partial<MetricRow> = {}): MetricRow {
  return {
    id,
    platform: "INSTAGRAM",
    format: "POST",
    pillar: "Education",
    publishedAt: new Date(Date.now() - daysAgo * 86_400_000),
    reach: 1000,
    impressions: 1500,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    clicks: null,
    videoViews: null,
    leads: null,
    engagementRate: er,
    ...extra,
  };
}

describe("performance math", () => {
  it("computes engagement rate and handles missing denominators", () => {
    expect(engagementRate({ likes: 40, comments: 5, shares: 3, saves: 2, reach: 1000, impressions: null })).toBeCloseTo(0.05);
    expect(engagementRate({ likes: 1, comments: 0, shares: 0, saves: 0, reach: null, impressions: null })).toBeNull();
    expect(pctChange(127, 100)).toBeCloseTo(0.27);
    expect(pctChange(1, 0)).toBeNull();
  });
  it("compares a post to the recent average using only earlier posts", () => {
    const history = [row("a", 10, 0.04), row("b", 8, 0.04), row("c", 6, 0.04), row("later", 0.5, 0.2)];
    const post = row("p", 1, 0.05);
    const res = compareToRecent(post, [...history, post]);
    const er = res.comparisons.find((c) => c.metric === "engagementRate")!;
    expect(res.sample).toBe(3);
    expect(er.change).toBeCloseTo(0.25);
  });
  it("never compares metrics the post does not have", () => {
    const res = compareToRecent(row("p", 1, 0.05, { saves: null }), [row("a", 5, 0.04, { saves: 10 }), row("b", 4, 0.04, { saves: 12 })]);
    expect(res.comparisons.some((c) => c.metric === "saves")).toBe(false);
  });
  it("requires a minimum sample before reporting patterns", () => {
    expect(findPatterns([row("a", 1, 0.1, { format: "CAROUSEL" }), row("b", 2, 0.01)])).toEqual([]);
    const rows = [
      ...[1, 2, 3].map((d) => row(`c${d}`, d, 0.08, { format: "CAROUSEL", pillar: "Education" })),
      ...[4, 5, 6].map((d) => row(`p${d}`, d, 0.02, { format: "POST", pillar: "Offers" })),
    ];
    const findings = findPatterns(rows);
    expect(findings.find((f) => f.dimension === "format" && f.key === "CAROUSEL")?.kind).toBe("outperforming");
  });
});

describe("lead scoring", () => {
  it("scores buying intent (English and Arabic) higher", () => {
    const cold = scoreLead({ email: "a@gmail.com" });
    const hot = scoreLead({ email: "cto@acme.io", phone: "+1", company: "Acme", message: "Can you send a quote? We need this urgent, budget approved." });
    const ar = scoreLead({ email: "x@co.sa", message: "أريد عرض سعر عاجل لو سمحت" });
    expect(cold.temperature).toBe("COLD");
    expect(hot.temperature).toBe("HOT");
    expect(ar.reasons).toContain("buying_intent");
    expect(temperatureFor(40)).toBe("WARM");
  });
});

describe("crypto", () => {
  it("round-trips secrets with AES-GCM and rejects tampering", () => {
    const enc = encryptSecret("ya29.super-secret");
    expect(enc).not.toContain("super-secret");
    expect(decryptSecret(enc)).toBe("ya29.super-secret");
    // Flip a real ciphertext byte (editing a base64 character can land on padding bits and change nothing).
    const [v, iv, tag, data] = enc.split(".");
    const bytes = Buffer.from(data, "base64url");
    bytes[0] ^= 0x01;
    expect(() => decryptSecret([v, iv, tag, bytes.toString("base64url")].join("."))).toThrow();
    const tag2 = Buffer.from(tag, "base64url");
    tag2[0] ^= 0x01;
    expect(() => decryptSecret([v, iv, tag2.toString("base64url"), data].join("."))).toThrow();
  });
  it("hashes tokens deterministically", () => {
    const t = randomToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
  });
});

describe("knowledge extraction", () => {
  const html = `<html lang="en"><head><title>Acme Studio</title><meta name="description" content="Design for startups"><meta name="theme-color" content="#ff5500"></head>
    <body><nav><a href="/about">About</a><a href="/pricing">Pricing</a><a href="https://instagram.com/acme">IG</a></nav>
    <main><h1>We design brands</h1><p>Acme helps startups launch beautiful brands.</p><script>evil()</script></main></body></html>`;
  it("extracts text, signals and links but not scripts", () => {
    const page = extractPage(html, "https://acme.test/");
    expect(page.title).toBe("Acme Studio");
    expect(page.description).toBe("Design for startups");
    expect(page.themeColor).toBe("#ff5500");
    expect(page.social.instagram).toContain("instagram.com/acme");
    expect(page.text).toContain("Acme helps startups");
    expect(page.text).not.toContain("evil");
    expect(pickInterestingLinks(page.links, 5)).toEqual(expect.arrayContaining(["https://acme.test/about", "https://acme.test/pricing"]));
  });
  it("chunks long text with bounded size", () => {
    const text = Array.from({ length: 80 }, (_, i) => `Paragraph ${i} ${"word ".repeat(40)}`).join("\n");
    const chunks = chunkText(text, 300, 40);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length / 4 <= 420)).toBe(true);
  });
});

describe("SSRF protection", () => {
  it("normalizes and validates URLs", () => {
    expect(normalizeUrl("acme.com").toString()).toBe("https://acme.com/");
    expect(() => normalizeUrl("ftp://acme.com")).toThrow();
    expect(() => normalizeUrl("http://user:pass@acme.com")).toThrow();
    expect(() => normalizeUrl("http://acme.com:8080")).toThrow();
  });
  it("refuses private and loopback hosts", async () => {
    await expect(safeFetchText("http://127.0.0.1/")).rejects.toThrow();
    await expect(safeFetchText("http://localhost/")).rejects.toThrow();
    await expect(safeFetchText("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(safeFetchText("http://10.0.0.5/")).rejects.toThrow();
  });
});

describe("command intent (offline router)", () => {
  it("routes English and Arabic requests", () => {
    expect(offlineIntent("Create a Ramadan campaign.").intent).toBe("create_campaign");
    expect(offlineIntent("Prepare next week's Instagram posts.")).toMatchObject({ intent: "create_content_plan", platform: "INSTAGRAM" });
    expect(offlineIntent("Why did yesterday's post perform badly?").intent).toBe("analyze_performance");
    expect(offlineIntent("Follow up with hot leads.").intent).toBe("leads_followup");
    expect(offlineIntent("أنشئ حملة لرمضان").intent).toBe("create_campaign");
    expect(offlineIntent("جهّز منشورات إنستغرام للأسبوع القادم")).toMatchObject({ intent: "create_content_plan", platform: "INSTAGRAM" });
    expect(offlineIntent("What are your opening hours?").intent).toBe("ask_question");
  });
});

describe("content status machine", () => {
  it("allows only valid transitions", () => {
    expect(canTransition("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransition("PUBLISHED", "DRAFT")).toBe(false);
    expect(canTransition("REJECTED", "SCHEDULED")).toBe(false);
  });
});

describe("AI router", () => {
  it("uses the offline provider only when no real provider is configured", () => {
    const models = routeModels({ task: "COPYWRITING" });
    expect(models[0]?.provider).toBe("offline");
  });
  it("prefers the requested tier and downgrades under cost pressure", () => {
    process.env.ANTHROPIC_API_KEY = "test";
    try {
      expect(routeModels({ task: "STRATEGY" })[0].model).toBe("claude-opus-5");
      expect(routeModels({ task: "CLASSIFICATION" })[0].model).toBe("claude-haiku-4-5");
      expect(routeModels({ task: "STRATEGY" }, { costSaving: true })[0].model).toBe("claude-sonnet-5");
      expect(routeModels({ task: "STRATEGY" }).map((m) => m.provider)).not.toContain("offline");
    } finally {
      process.env.ANTHROPIC_API_KEY = "";
    }
    expect(downgrade("fast")).toBe("fast");
  });
});

describe("job backoff", () => {
  it("grows exponentially and is capped", () => {
    expect(backoffMs(1)).toBeGreaterThanOrEqual(24_000);
    expect(backoffMs(3)).toBeGreaterThan(backoffMs(1));
    expect(backoffMs(20)).toBeLessThanOrEqual(72 * 60_000);
  });
});

describe("client IP / TRUST_PROXY", () => {
  const h = (map: Record<string, string>) => ({ get: (n: string) => map[n.toLowerCase()] ?? null });
  const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

  it("ignores forwarding headers unless TRUST_PROXY is set", () => {
    expect(trustedHops(env({}))).toBe(0);
    expect(trustedHops(env({ TRUST_PROXY: "false" }))).toBe(0);
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6" }), env({}))).toBeNull();
  });

  it("uses the entry appended by the trusted proxy, not the spoofable leftmost one", () => {
    const spoofed = h({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }); // client sent 1.1.1.1 itself
    expect(clientIp(spoofed, env({ TRUST_PROXY: "true" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": "1.1.1.1, 203.0.113.7, 10.0.0.2" }), env({ TRUST_PROXY: "2" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7" }), env({ TRUST_PROXY: "2" }))).toBeNull();
  });

  it("supports a single trusted edge header and rejects garbage", () => {
    expect(clientIp(h({ "cf-connecting-ip": "2001:db8::1", "x-forwarded-for": "9.9.9.9" }), env({ TRUST_PROXY: "true", TRUST_PROXY_HEADER: "cf-connecting-ip" }))).toBe("2001:db8::1");
    expect(clientIp(h({ "x-forwarded-for": "not-an-ip" }), env({ TRUST_PROXY: "1" }))).toBeNull();
    expect(normalizeIp("[::1]:443")).toBe("::1");
    expect(normalizeIp("203.0.113.7:5000")).toBe("203.0.113.7");
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });
});

describe("CSP", () => {
  it("locks scripts to a per-request nonce and blocks plugins, base hijacking and framing", () => {
    const n = makeNonce();
    expect(n).not.toBe(makeNonce());
    const csp = buildCsp(n, {});
    expect(csp).toContain(`script-src 'self' 'nonce-${n}' 'strict-dynamic'`);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("only the embed widget may be framed by other sites; dev adds eval/HMR; https upgrades", () => {
    expect(buildCsp("x", { embed: true })).toContain("frame-ancestors *");
    expect(buildCsp("x", { dev: true })).toContain("'unsafe-eval'");
    expect(buildCsp("x", { https: true })).toContain("upgrade-insecure-requests");
  });
});

describe("post-login redirect targets", () => {
  it.each(["//evil.example", "/\\evil.example", "/\\/evil.example", "/%5Cevil.example".replace("%5C", "\\"), "https://evil.example", "javascript:alert(1)", "/\u0000x", "", "home"])("rejects %j", (v) => expect(safeInternalPath(v)).toBeNull());
  it("keeps same-origin paths with query", () => expect(safeInternalPath("/invite/abc?x=1")).toBe("/invite/abc?x=1"));
});
