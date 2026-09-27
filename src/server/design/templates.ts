import sharp, { type OverlayOptions } from "sharp";

/**
 * Brand template engine. Every social format has a canvas, a safe area (what the platform's UI never
 * covers) and zones (logo / headline / body / CTA / footer). Text is laid out here, never by the image
 * model: font size shrinks to fit the zone, then truncates with an ellipsis — nothing overflows the safe
 * area. Arabic is shaped by the renderer (librsvg + Pango/HarfBuzz) with an Arabic-capable font stack.
 *
 * `layoutTemplate` is pure (unit tested); `renderTemplate` draws the layout with sharp.
 */
export const FONT_STACK = "'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Noto Naskh Arabic', 'Segoe UI', 'Tahoma', 'Arial', sans-serif";

export type TemplateType = "square" | "portrait" | "story" | "reel_cover" | "carousel" | "linkedin" | "facebook";
type Rect = { x: number; y: number; w: number; h: number };
type Insets = { top: number; right: number; bottom: number; left: number };

export type TemplateSpec = {
  width: number;
  height: number;
  /** Platform UI overlays (story header, reel caption/buttons) — keep text out of these margins. */
  safe: Insets;
  headline: { maxLines: number; maxSize: number; minSize: number };
  body: { maxLines: number; size: number } | null;
};

export const TEMPLATES: Record<TemplateType, TemplateSpec> = {
  square: { width: 1080, height: 1080, safe: { top: 76, right: 76, bottom: 76, left: 76 }, headline: { maxLines: 3, maxSize: 72, minSize: 44 }, body: { maxLines: 3, size: 34 } },
  portrait: { width: 1080, height: 1350, safe: { top: 90, right: 80, bottom: 90, left: 80 }, headline: { maxLines: 3, maxSize: 76, minSize: 46 }, body: { maxLines: 4, size: 36 } },
  carousel: { width: 1080, height: 1350, safe: { top: 90, right: 80, bottom: 110, left: 80 }, headline: { maxLines: 3, maxSize: 74, minSize: 44 }, body: { maxLines: 6, size: 38 } },
  // Stories / reels: top ~14% (profile bar) and bottom ~20% (reply box, caption, buttons) are covered.
  story: { width: 1080, height: 1920, safe: { top: 270, right: 90, bottom: 380, left: 90 }, headline: { maxLines: 4, maxSize: 84, minSize: 50 }, body: { maxLines: 4, size: 40 } },
  reel_cover: { width: 1080, height: 1920, safe: { top: 270, right: 120, bottom: 480, left: 120 }, headline: { maxLines: 3, maxSize: 92, minSize: 56 }, body: null },
  linkedin: { width: 1200, height: 1200, safe: { top: 80, right: 80, bottom: 80, left: 80 }, headline: { maxLines: 3, maxSize: 76, minSize: 44 }, body: { maxLines: 3, size: 36 } },
  facebook: { width: 1200, height: 630, safe: { top: 48, right: 60, bottom: 48, left: 60 }, headline: { maxLines: 2, maxSize: 60, minSize: 36 }, body: { maxLines: 2, size: 28 } },
};

export const isArabic = (s: string) => /[؀-ۿݐ-ݿࢠ-ࣿ]/.test(s);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Approximate advance width per character as a fraction of the font size. Arabic joined script is
 * narrower per character than Latin in most UI fonts; digits and spaces are narrower still.
 */
export function textWidth(s: string, size: number) {
  let w = 0;
  for (const ch of s) w += ch === " " ? 0.28 : /[؀-ۿ]/.test(ch) ? 0.48 : /[0-9.,،:;!?'"()-]/.test(ch) ? 0.45 : /[A-Z]/.test(ch) ? 0.64 : 0.54;
  return w * size;
}

/** Word wrap by measured width; the last line gets an ellipsis when text didn't fit. */
export function wrapMeasured(text: string, size: number, maxWidth: number, maxLines: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let i = 0;
  for (; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (textWidth(next, size) <= maxWidth || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) {
    lines.push(line);
    i = words.length;
  }
  const truncated = i < words.length || lines.some((l) => textWidth(l, size) > maxWidth);
  if (truncated && lines.length) {
    let last = lines[lines.length - 1];
    // A single very long word: hard-cut by characters.
    while (last.length > 1 && textWidth(`${last}…`, size) > maxWidth) last = last.includes(" ") ? last.slice(0, last.lastIndexOf(" ")) : last.slice(0, -1);
    lines[lines.length - 1] = `${last.replace(/[\s.,،:;]+$/, "")}…`;
  }
  return { lines, truncated };
}

export type TemplateText = { headline: string; body?: string | null; cta?: string | null; brandName: string; pageLabel?: string | null };
export type TextBlock = { lines: string[]; size: number; x: number; y: number; lineHeight: number; anchor: "start" | "end" | "middle"; rtl: boolean; truncated: boolean };
export type TemplateLayout = {
  type: TemplateType;
  width: number;
  height: number;
  safe: Rect;
  rtl: boolean;
  logo: Rect;
  headline: TextBlock;
  body: TextBlock | null;
  cta: (Rect & { text: string; size: number; rtl: boolean }) | null;
  footer: TextBlock;
  page: TextBlock | null;
  warnings: string[];
};

/** Pure layout: sizes and positions for every zone inside the safe area. */
export function layoutTemplate(type: TemplateType, t: TemplateText): TemplateLayout {
  const spec = TEMPLATES[type];
  const { width: W, height: H } = spec;
  const safe: Rect = { x: spec.safe.left, y: spec.safe.top, w: W - spec.safe.left - spec.safe.right, h: H - spec.safe.top - spec.safe.bottom };
  const rtl = isArabic(`${t.headline} ${t.body ?? ""} ${t.cta ?? ""}`);
  const warnings: string[] = [];
  const anchor = rtl ? "end" : "start";
  const x = rtl ? safe.x + safe.w : safe.x;
  const logoSize = Math.round(Math.min(W, H) * 0.11);
  const logo: Rect = { x: rtl ? safe.x : safe.x + safe.w - logoSize, y: safe.y, w: logoSize, h: logoSize };

  // Footer (brand + optional page number) sits on the safe-area floor.
  const footerSize = Math.round(W * 0.024);
  const footerY = safe.y + safe.h;
  const footer: TextBlock = { lines: [t.brandName.slice(0, 60)], size: footerSize, x, y: footerY, lineHeight: footerSize, anchor, rtl: isArabic(t.brandName), truncated: t.brandName.length > 60 };
  const page = t.pageLabel ? { lines: [t.pageLabel], size: footerSize, x: rtl ? safe.x : safe.x + safe.w, y: footerY, lineHeight: footerSize, anchor: (rtl ? "start" : "end") as "start" | "end", rtl: false, truncated: false } : null;

  // CTA pill above the footer.
  let cta: TemplateLayout["cta"] = null;
  let floor = footerY - footerSize * 2;
  if (t.cta?.trim()) {
    const size = Math.round(W * 0.032);
    const h = Math.round(size * 2.4);
    let text = t.cta.trim();
    const maxW = safe.w;
    while (text.length > 3 && textWidth(text, size) + size * 2.4 > maxW) text = text.slice(0, -2);
    if (text !== t.cta.trim()) {
      text = `${text.replace(/\s+$/, "")}…`;
      warnings.push("cta_truncated");
    }
    const w = Math.min(maxW, Math.round(textWidth(text, size) + size * 2.4));
    cta = { x: rtl ? safe.x + safe.w - w : safe.x, y: floor - h, w, h, text, size, rtl: isArabic(text) };
    floor = cta.y - Math.round(size * 1.2);
  }

  // Body grows upward from the floor; headline sits above it. Headline shrinks to fit before truncating.
  let body: TextBlock | null = null;
  if (spec.body && t.body?.trim()) {
    const size = spec.body.size;
    const lh = Math.round(size * 1.45);
    const w = wrapMeasured(t.body, size, safe.w, spec.body.maxLines);
    if (w.truncated) warnings.push("body_truncated");
    const top = floor - (w.lines.length - 1) * lh;
    body = { lines: w.lines, size, x, y: top, lineHeight: lh, anchor, rtl: isArabic(t.body), truncated: w.truncated };
    floor = top - Math.round(size * 2.3);
  }

  const ceiling = logo.y + logo.h + Math.round(H * 0.03);
  let size = spec.headline.maxSize;
  let wrapped = wrapMeasured(t.headline, size, safe.w, spec.headline.maxLines);
  const fits = (s: number, lines: number) => lines * Math.round(s * 1.22) <= floor - ceiling;
  while ((wrapped.truncated || !fits(size, wrapped.lines.length)) && size > spec.headline.minSize) {
    size -= 2;
    wrapped = wrapMeasured(t.headline, size, safe.w, spec.headline.maxLines);
  }
  let lines = wrapped.lines;
  const lh = Math.round(size * 1.22);
  while (lines.length > 1 && !fits(size, lines.length)) {
    lines = wrapMeasured(t.headline, size, safe.w, lines.length - 1).lines;
    wrapped = { lines, truncated: true };
  }
  if (wrapped.truncated) warnings.push("headline_truncated");
  const headline: TextBlock = { lines, size, x, y: floor - (lines.length - 1) * lh, lineHeight: lh, anchor, rtl: isArabic(t.headline), truncated: wrapped.truncated };

  return { type, width: W, height: H, safe, rtl, logo, headline, body, cta, footer, page, warnings };
}

export type TemplateBrand = { primary: string; secondary: string; logo?: Buffer | null };
const HEX = /^#[0-9a-f]{3,8}$/i;
const color = (c: string | undefined, fallback: string) => (c && HEX.test(c) ? c : fallback);

function textSvg(b: TextBlock, fill: string, weight: number, opacity = 1) {
  // Per-line direction; anchor "end" under rtl is the left edge in SVG, so flip for RTL runs.
  return b.lines
    .map((l, i) => {
      const r = isArabic(l);
      const anchor = b.anchor === "middle" ? "middle" : r ? (b.anchor === "end" ? "start" : "end") : b.anchor;
      return `<text x="${b.x}" y="${b.y + i * b.lineHeight}" font-size="${b.size}" font-weight="${weight}" fill="${fill}" fill-opacity="${opacity}" direction="${r ? "rtl" : "ltr"}" text-anchor="${anchor}">${esc(l)}</text>`;
    })
    .join("");
}

/** Renders a layout over a background (or a brand gradient when there's none). */
export async function renderTemplate(type: TemplateType, text: TemplateText, brand: TemplateBrand, background?: Buffer | null) {
  const L = layoutTemplate(type, text);
  const primary = color(brand.primary, "#17161c");
  const secondary = color(brand.secondary, "#ffffff");
  const scrimTop = Math.max(0, L.headline.y - L.headline.size * 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="${primary}" stop-opacity="0.82"/></linearGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${primary}" stop-opacity="0"/><stop offset="0.4" stop-color="${primary}" stop-opacity="0.6"/><stop offset="1" stop-color="${primary}" stop-opacity="0.94"/></linearGradient>
  </defs>
  ${background ? `<rect x="0" y="${scrimTop}" width="${L.width}" height="${L.height - scrimTop}" fill="url(#scrim)"/>` : `<rect width="${L.width}" height="${L.height}" fill="url(#bg)"/><circle cx="${L.rtl ? L.width * 0.15 : L.width * 0.85}" cy="${L.height * 0.2}" r="${L.width * 0.28}" fill="${secondary}" fill-opacity="0.08"/>`}
  <g font-family="${FONT_STACK}">
    ${textSvg(L.headline, "#ffffff", 700)}
    ${L.body ? textSvg(L.body, "#ffffff", 400, 0.9) : ""}
    ${L.cta ? `<rect x="${L.cta.x}" y="${L.cta.y}" width="${L.cta.w}" height="${L.cta.h}" rx="${L.cta.h / 2}" fill="${secondary}"/><text x="${L.cta.x + L.cta.w / 2}" y="${L.cta.y + L.cta.h / 2 + L.cta.size * 0.36}" font-size="${L.cta.size}" font-weight="700" fill="${primary}" direction="${L.cta.rtl ? "rtl" : "ltr"}" text-anchor="middle">${esc(L.cta.text)}</text>` : ""}
    ${textSvg(L.footer, "#ffffff", 600, 0.85)}
    ${L.page ? textSvg(L.page, "#ffffff", 600, 0.7) : ""}
  </g>
</svg>`;
  const base = background
    ? await sharp(background).resize(L.width, L.height, { fit: "cover", position: sharp.strategy.attention }).png().toBuffer()
    : await sharp({ create: { width: L.width, height: L.height, channels: 4, background: primary } }).png().toBuffer();
  const layers: OverlayOptions[] = [{ input: Buffer.from(svg), top: 0, left: 0 }];
  if (brand.logo) {
    const logo = await sharp(brand.logo).resize(L.logo.w, L.logo.h, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    layers.push({ input: logo, top: L.logo.y, left: L.logo.x });
  }
  return { png: await sharp(base).composite(layers).png().toBuffer(), layout: L };
}

/** Which template a post format uses. */
export function templateFor(format: string, platform: string): TemplateType {
  if (format === "CAROUSEL") return "carousel";
  if (format === "STORY") return "story";
  if (format === "REEL" || format === "SHORT_VIDEO") return "reel_cover";
  if (platform === "LINKEDIN" || format === "LINKEDIN_POST") return "linkedin";
  if (platform === "FACEBOOK") return "facebook";
  return platform === "INSTAGRAM" ? "portrait" : "square";
}
