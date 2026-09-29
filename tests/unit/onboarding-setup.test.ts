import { describe, expect, it } from "vitest";
import { audienceSchema, businessSchema, brandSchema, goalsSchema, setupProgress, stepReady, suggestCustomerType, suggestIndustry, WEBSITE_RE } from "@/lib/onboarding-setup";

describe("guided setup — local rules (no AI)", () => {
  it("suggests an industry from website text (EN + AR)", () => {
    expect(suggestIndustry("Acme builds websites and custom software")).toBe("technology");
    expect(suggestIndustry("نقدم خدمات تطوير المواقع والتطبيقات")).toBe("technology");
    expect(suggestIndustry("عيادة أسنان في الرياض")).toBe("healthcare");
    expect(suggestIndustry("Artisan bakery and coffee")).toBe("food");
    expect(suggestIndustry("hello world")).toBeNull();
  });

  it("detects the customer type", () => {
    expect(suggestCustomerType("Solutions for SMEs and enterprises")).toBe("B2B");
    expect(suggestCustomerType("هدايا لك ولعائلتك")).toBe("B2C");
    expect(suggestCustomerType("للأفراد والشركات")).toBe("BOTH");
    expect(suggestCustomerType("Welcome")).toBeNull();
  });

  it("validates websites, names, ages, colors and goals", () => {
    for (const ok of ["example.com", "https://www.example.co.uk/path", "متجر.السعودية"]) expect(WEBSITE_RE.test(ok), ok).toBe(true);
    for (const bad of ["not a site", "http://", "example"]) expect(WEBSITE_RE.test(bad), bad).toBe(false);
    expect(() => businessSchema.parse({ companyName: "" })).toThrow();
    expect(() => businessSchema.parse({ country: "Saudi" })).toThrow();
    expect(() => audienceSchema.parse({ ageMin: 40, ageMax: 30 })).toThrow();
    expect(() => audienceSchema.parse({ ageMin: 12 })).toThrow();
    expect(audienceSchema.parse({ ageMin: 18, ageMax: 65 })).toEqual({ ageMin: 18, ageMax: 65 });
    expect(() => brandSchema.parse({ colors: ["#12"] })).toThrow();
    expect(() => brandSchema.parse({ tones: ["loud"] })).toThrow();
    expect(() => goalsSchema.parse({ goals: ["world_domination"] })).toThrow();
  });

  it("progress = required answers (80%) + confirmed steps (20%), not a fixed per-step number", () => {
    expect(setupProgress({}, "").percent).toBe(0);
    const one = setupProgress({}, "Acme");
    expect(one.percent).toBe(10); // 1 of 8 required answers
    const step1 = { businessType: "SERVICES", industry: "IT", customerType: "B2B" } as const;
    expect(setupProgress(step1, "Acme").percent).toBe(40);
    expect(setupProgress({ ...step1, setup: { completed: ["business"] } }, "Acme")).toEqual({ percent: 45, doneSteps: 1 });
    const all = { ...step1, customers: "x", markets: "Riyadh", brand: { tones: ["warm" as const] }, goalKeys: ["sales" as const], setup: { completed: ["business", "audience", "brand", "goals"] as ("business" | "audience" | "brand" | "goals")[] } };
    expect(setupProgress(all, "Acme")).toEqual({ percent: 100, doneSteps: 4 });
    // A step marked completed doesn't count while its required answers are missing.
    expect(setupProgress({ setup: { completed: ["brand"] } }, "Acme").doneSteps).toBe(0);
    expect(stepReady("audience", { customers: "x" }, "Acme")).toBe(false);
    expect(stepReady("review", {}, "")).toBe(true);
  });
});
