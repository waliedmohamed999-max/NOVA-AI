import { describe, expect, it } from "vitest";
import { legalDoc } from "@/content/legal";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
const text = (d: ReturnType<typeof legalDoc>) => [d.intro, ...d.sections.flatMap((s) => [s.h, ...s.p])].join("\n");

describe("legal pages", () => {
  it("never invents company facts: unset address/law/hosting show as placeholders", () => {
    const t = text(legalDoc("terms", "en", env({})));
    expect(t).toMatch(/\[to be completed by the company\]/);
    expect(text(legalDoc("privacy", "ar", env({})))).toMatch(/\[تستكمله الشركة\]/);
  });
  it("uses configured facts when provided", () => {
    const t = text(legalDoc("privacy", "en", env({ LEGAL_CONTACT_EMAIL: "dpo@acme.example", LEGAL_HOSTING_REGION: "EU (Frankfurt)" })));
    expect(t).toContain("dpo@acme.example");
    expect(t).toContain("EU (Frankfurt)");
  });
  it("states what reviewers look for: OAuth only, no passwords, token encryption, deletion path, AI providers", () => {
    const t = text(legalDoc("privacy", "en", env({})));
    expect(t).toMatch(/never asks for or stores passwords/);
    expect(t).toMatch(/AES-256-GCM/);
    expect(t).toMatch(/OpenAI/);
    expect(text(legalDoc("data-deletion", "en", env({})))).toMatch(/Disconnect/);
  });
});
