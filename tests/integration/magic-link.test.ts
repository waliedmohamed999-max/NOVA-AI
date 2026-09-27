import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { makeUser } from "../support/factory";
import { issueToken, peekMagicLink } from "@/server/auth/service";

const started: string[] = [];
vi.mock("@/server/auth/session", () => ({ startSession: async (userId: string) => void started.push(userId) }));

const route = () => import("@/app/api/auth/magic/route");
const post = (token: string, headers: Record<string, string> = {}) => {
  const body = new URLSearchParams({ token });
  return new NextRequest("http://localhost:3000/api/auth/magic", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", ...headers } });
};

describe("magic links vs email scanners", () => {
  it("GET (scanner / prefetch / preview) never consumes the token", async () => {
    const u = await makeUser();
    const token = await issueToken("MAGIC_LINK", u.email, u.id);
    const { GET } = await route();
    for (let i = 0; i < 3; i++) {
      const res = await GET(new NextRequest(`http://localhost:3000/api/auth/magic?token=${token}`, { headers: { purpose: "prefetch" } }));
      expect(new URL(res.headers.get("location")!).pathname).toBe("/magic");
    }
    expect(await peekMagicLink(token)).toMatchObject({ email: expect.stringMatching(/•••@/) });
    expect(started).not.toContain(u.id);
  });

  it("the Continue POST signs in exactly once; a second use fails", async () => {
    const u = await makeUser();
    const token = await issueToken("MAGIC_LINK", u.email, u.id);
    const { POST } = await route();
    const first = await POST(post(token, { "sec-fetch-site": "same-origin" }));
    expect(first.status).toBe(303);
    expect(new URL(first.headers.get("location")!).pathname).toMatch(/^\/(home|onboarding)$/);
    expect(started).toContain(u.id);
    const second = await POST(post(token));
    expect(new URL(second.headers.get("location")!).searchParams.get("error")).toBe("invalid_token");
    expect(await peekMagicLink(token)).toBeNull();
  });

  it("expired links are rejected on the page and on POST", async () => {
    const u = await makeUser();
    const token = await issueToken("MAGIC_LINK", u.email, u.id);
    await db.verificationToken.updateMany({ where: { email: u.email, purpose: "MAGIC_LINK" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await peekMagicLink(token)).toBeNull();
    const { POST } = await route();
    const res = await POST(post(token));
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_token");
  });

  it("a cross-site POST cannot sign someone in", async () => {
    const u = await makeUser();
    const token = await issueToken("MAGIC_LINK", u.email, u.id);
    const { POST } = await route();
    const res = await POST(post(token, { "sec-fetch-site": "cross-site" }));
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_token");
    expect(await peekMagicLink(token)).not.toBeNull(); // not consumed
  });
});
