import { afterEach, describe, expect, it, vi } from "vitest";
import { getMailer, sendTemplate, setMailer } from "@/server/email/mailer";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  setMailer(null);
  vi.unstubAllGlobals();
});

describe("email provider layer", () => {
  it("no provider configured → honest 'not configured', never a fake send", async () => {
    for (const k of ["SMTP_HOST", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "EMAIL_PROVIDER"]) delete process.env[k];
    setMailer(null);
    const m = getMailer();
    expect(m).toMatchObject({ name: "none", configured: false });
    expect((await m.testConnection()).ok).toBe(false);
  });

  it("Resend: sends through its HTTPS API with the key server-side", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "NOVA <hi@nova.test>";
    setMailer(null);
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response("{}", { status: 200 }))));
    await sendTemplate("magic_link", "a@b.test", { heading: "Sign in", body: "Tap to continue", ctaUrl: "https://app/magic?token=x" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ from: "NOVA <hi@nova.test>", to: ["a@b.test"], subject: "Sign in" });
    expect(body.html).toContain("https://app/magic?token=x");
  });

  it("Postmark: failures surface as errors (no silent success)", async () => {
    process.env.EMAIL_PROVIDER = "postmark";
    process.env.POSTMARK_SERVER_TOKEN = "pm_test";
    setMailer(null);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 422 })));
    await expect(getMailer().send({ to: "a@b.test", subject: "x", text: "y" })).rejects.toThrow(/Postmark rejected/);
    expect((await getMailer().testConnection()).ok).toBe(false);
  });

  it("SES is declared provider-ready, not faked", async () => {
    process.env.EMAIL_PROVIDER = "ses";
    setMailer(null);
    expect(getMailer().configured).toBe(false);
    expect((await getMailer().testConnection()).detail).toMatch(/not implemented/);
  });
});
