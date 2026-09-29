import { describe, expect, it } from "vitest";
import { extractLocal, structuredSignals } from "@/server/brain/extract";
import { stripBoilerplate } from "@/server/knowledge/company-context";

describe("brain extraction — local rules (no AI)", () => {
  it("Arabic page: services list, FAQ, price and policy; nav bars removed, headings kept", () => {
    const text = [
      "الرئيسية | من نحن | اتصل بنا",
      "خدماتنا",
      "تصميم المواقع",
      "إدارة حسابات التواصل",
      "كم تستغرق مدة تنفيذ الموقع؟",
      "عادة أربعة أسابيع من بداية المشروع.",
      "باقة صفحة الهبوط: 8000 ريال للمشروع",
      "سياسة الاسترجاع",
      "يمكن استرداد العربون خلال 14 يومًا إذا لم يبدأ العمل.",
    ].join("\n");
    expect(stripBoilerplate(text, 2)).not.toContain("الرئيسية | من نحن");
    expect(stripBoilerplate(text, 2)).toContain("خدماتنا");
    const c = extractLocal(text);
    expect(c.filter((x) => x.type === "offering").map((x) => x.data.name)).toEqual(expect.arrayContaining(["تصميم المواقع", "إدارة حسابات التواصل"]));
    expect(c.find((x) => x.type === "faq")?.data).toEqual({ question: "كم تستغرق مدة تنفيذ الموقع؟", answer: "عادة أربعة أسابيع من بداية المشروع." });
    const price = c.find((x) => x.type === "pricing")!;
    expect(price).toMatchObject({ critical: true, selected: false });
    expect(c.find((x) => x.type === "policy")).toMatchObject({ critical: true, data: { key: "سياسة الاسترجاع" } });
  });

  it("JSON-LD: products, FAQ page, reviews and rating", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Serum","category":"Serums","offers":{"price":"180","priceCurrency":"AED"},"aggregateRating":{"ratingValue":"4.7","reviewCount":"33"},"review":{"reviewBody":"Great for dry skin"}},{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Is it vegan?","acceptedAnswer":{"@type":"Answer","text":"<p>Yes, 100% vegan.</p>"}}]}]}</script>`;
    const s = structuredSignals(html);
    expect(s.products[0]).toMatchObject({ name: "Serum", category: "Serums", price: 180, currency: "AED" });
    expect(s.faqs[0]).toEqual({ question: "Is it vegan?", answer: "Yes, 100% vegan." });
    expect(s.rating).toEqual({ value: 4.7, count: 33 });
    expect(s.reviews[0].body).toBe("Great for dry skin");
  });
});

describe("E2E fixture fetcher is locked down", () => {
  it("serves *.fixture.test only with BRAIN_FETCH_FIXTURES=true outside production", async () => {
    const { publicFetch } = await import("@/server/brain/imports");
    const env = process.env as Record<string, string | undefined>;
    const saved = { flag: env.BRAIN_FETCH_FIXTURES, node: env.NODE_ENV };
    try {
      env.BRAIN_FETCH_FIXTURES = "true";
      const ok = await publicFetch("https://acme.fixture.test/");
      expect(ok.status).toBe(200);
      expect(ok.body).toContain("Acme Agency");
      env.NODE_ENV = "production";
      await expect(publicFetch("https://acme.fixture.test/")).rejects.toThrow(); // real (SSRF-safe) fetch → .test never resolves
      env.NODE_ENV = saved.node;
      env.BRAIN_FETCH_FIXTURES = undefined;
      await expect(publicFetch("https://acme.fixture.test/")).rejects.toThrow();
      env.BRAIN_FETCH_FIXTURES = "true";
      await expect(publicFetch("https://acme.fixture.test/../../../../etc/passwd")).resolves.toMatchObject({ status: 404 });
    } finally {
      env.BRAIN_FETCH_FIXTURES = saved.flag;
      env.NODE_ENV = saved.node;
    }
  });
});

describe("offering names from a services section (real imported-site lines)", () => {
  it("keeps real services, drops durations, sentences, CTAs, feature lists and headings", async () => {
    const { offeringName } = await import("@/server/brain/extract");
    const keep: [string, string][] = [
      ["برمجة مواقع الويب", "برمجة مواقع الويب"],
      ["التصميم الجرافيكي", "التصميم الجرافيكي"],
      ["ادارة السوشيل ميديا", "ادارة السوشيل ميديا"],
      ["⭐ باقة البداية", "باقة البداية"],
      ["🚀 باقة الأعمال", "باقة الأعمال"],
      ["Website development", "Website development"],
    ];
    for (const [line, name] of keep) expect(offeringName(line), line).toBe(name);
    for (const junk of [
      "7 أيام",
      "15 يوم",
      "التصنيفات",
      "حسب الطلب",
      "كتابة وصف احترافي للمنتجات.",
      "تقــدم خـدمــات تكنــولوجيا المعــلومات والبرمجة",
      "تساعد المنشآت في السعودية على بناء حضور رقمي احترافي (موقع/تطبيق الكتروني/متجر/ت",
      "اقسام D M S لخدمات الأعمال",
      "📦 خدمات إضافية متوفرة",
      "(نموذج مبدئي – يمكن تخصيصه حسب رغبتك)",
      "متجر بسيط بـ10 منتجات – تصميم جاهز – بوابة دفع واحدة",
      "📞 اطلق متجرك الآن مع DMS",
    ]) expect(offeringName(junk), junk).toBeNull();
  });
});
