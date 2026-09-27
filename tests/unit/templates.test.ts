import { describe, expect, it } from "vitest";
import { layoutTemplate, renderTemplate, TEMPLATES, templateFor, textWidth, wrapMeasured, type TemplateLayout, type TemplateType } from "@/server/design/templates";

const inside = (L: TemplateLayout) => {
  const s = L.safe;
  const within = (x: number, y: number) => x >= s.x - 0.5 && x <= s.x + s.w + 0.5 && y >= s.y - 0.5 && y <= s.y + s.h + 0.5;
  const blocks = [L.headline, L.body, L.footer, L.page].filter(Boolean) as NonNullable<TemplateLayout["body"]>[];
  for (const b of blocks)
    for (const [i, line] of b.lines.entries()) {
      const y = b.y + i * b.lineHeight;
      const w = textWidth(line, b.size);
      const x0 = b.anchor === "end" ? b.x - w : b.anchor === "middle" ? b.x - w / 2 : b.x;
      if (!within(x0, y - b.size) || !within(x0 + w, y)) return false;
    }
  if (L.cta && (!within(L.cta.x, L.cta.y) || !within(L.cta.x + L.cta.w, L.cta.y + L.cta.h))) return false;
  return within(L.logo.x, L.logo.y) && within(L.logo.x + L.logo.w, L.logo.y + L.logo.h);
};

const LONG_AR = "كيف تضاعف مبيعات متجرك الإلكتروني خلال تسعين يومًا باستخدام المحتوى الذكي والإعلانات المستهدفة وخدمة عملاء لا تنام أبدًا حتى في العطلات الرسمية والمواسم";
const LONG_EN = "How to double your online store's sales in ninety days with smart content, targeted ads and customer service that never sleeps, even on public holidays and seasonal peaks";

describe("brand template engine", () => {
  it("every template keeps all text, the CTA and the logo inside its safe area", () => {
    for (const type of Object.keys(TEMPLATES) as TemplateType[])
      for (const text of [LONG_AR, LONG_EN, "قصير", "Short"]) {
        const L = layoutTemplate(type, { headline: text, body: text, cta: "احجز استشارتك المجانية الآن", brandName: "نوفا للتسويق", pageLabel: "2/7" });
        expect(inside(L), `${type}: ${text.slice(0, 10)}`).toBe(true);
      }
  });

  it("shrinks the headline before truncating, and says when it truncated", () => {
    const short = layoutTemplate("square", { headline: "Grow faster", brandName: "Acme" });
    expect(short.headline.size).toBe(TEMPLATES.square.headline.maxSize);
    expect(short.warnings).toEqual([]);
    const long = layoutTemplate("facebook", { headline: LONG_EN, brandName: "Acme" });
    expect(long.headline.size).toBeLessThan(TEMPLATES.facebook.headline.maxSize);
    expect(long.headline.size).toBeGreaterThanOrEqual(TEMPLATES.facebook.headline.minSize);
    expect(long.headline.lines.at(-1)).toMatch(/…$/);
    expect(long.warnings).toContain("headline_truncated");
  });

  it("Arabic lays out right-to-left: text anchored to the right edge, logo on the left", () => {
    const L = layoutTemplate("portrait", { headline: LONG_AR, cta: "اطلب الآن", brandName: "نوفا" });
    expect(L.rtl).toBe(true);
    expect(L.headline.anchor).toBe("end");
    expect(L.headline.x).toBe(L.safe.x + L.safe.w);
    expect(L.logo.x).toBe(L.safe.x);
    expect(L.cta!.x + L.cta!.w).toBe(L.safe.x + L.safe.w);
    const en = layoutTemplate("portrait", { headline: "Order now", brandName: "Nova" });
    expect(en.rtl).toBe(false);
    expect(en.headline.x).toBe(en.safe.x);
  });

  it("stories and reel covers keep text out of the platform UI zones", () => {
    const story = layoutTemplate("story", { headline: LONG_EN, cta: "Swipe up", brandName: "Acme" });
    expect(story.headline.y - story.headline.size).toBeGreaterThanOrEqual(TEMPLATES.story.safe.top);
    expect(story.footer.y).toBeLessThanOrEqual(1920 - TEMPLATES.story.safe.bottom);
    const cover = layoutTemplate("reel_cover", { headline: "5 mistakes", body: "ignored", brandName: "Acme" });
    expect(cover.body).toBeNull();
  });

  it("wraps by measured width and hard-cuts a single unbreakable word", () => {
    const w = wrapMeasured("Supercalifragilisticexpialidocious".repeat(4), 60, 400, 2);
    expect(w.truncated).toBe(true);
    expect(textWidth(w.lines.at(-1)!, 60)).toBeLessThanOrEqual(400 + 1);
    expect(wrapMeasured("a b c", 40, 1000, 3)).toEqual({ lines: ["a b c"], truncated: false });
  });

  it("renders a PNG of the exact size (no background → brand gradient)", async () => {
    const { png, layout } = await renderTemplate("carousel", { headline: "٣ أخطاء تكلفك عملاءك", body: "الخطأ الأول: الرد المتأخر على الرسائل", brandName: "نوفا", pageLabel: "1/5" }, { primary: "#1d3557", secondary: "#f1faee" });
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1350);
    expect(layout.rtl).toBe(true);
  });

  it("maps formats to templates", () => {
    expect(templateFor("CAROUSEL", "INSTAGRAM")).toBe("carousel");
    expect(templateFor("REEL", "INSTAGRAM")).toBe("reel_cover");
    expect(templateFor("POST", "LINKEDIN")).toBe("linkedin");
    expect(templateFor("POST", "FACEBOOK")).toBe("facebook");
    expect(templateFor("POST", "INSTAGRAM")).toBe("portrait");
  });
});
