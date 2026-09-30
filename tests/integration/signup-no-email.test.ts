import { afterEach, describe, expect, it } from "vitest";
import { signUp } from "@/server/auth/service";
import { db } from "@/server/db/client";
import { setMailer, type Mailer } from "@/server/email/mailer";

const failing: Mailer = {
  name: "none",
  configured: false,
  async send() {
    throw new Error("no provider");
  },
  async testConnection() {
    return { ok: false, detail: "no provider" };
  },
};

describe("sign-up without a working email provider", () => {
  afterEach(() => setMailer(null));

  it("still creates the account when the verification email fails", async () => {
    setMailer(failing);
    const email = `noemail-${Date.now()}@e2e.nova.test`;
    const user = await signUp({ name: "No Email", email, password: "E2e-password-2026", locale: "ar" });
    expect(user.email).toBe(email);
    expect(await db.user.findUnique({ where: { email } })).not.toBeNull();
  });
});
