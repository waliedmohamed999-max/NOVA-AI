import sharp, { type OverlayOptions } from "sharp";

/**
 * NOVA composition layer. The image model produces the visual; exact text (Arabic included),
 * logo, CTA and brand colours are placed here, server-side, so typography never depends on
 * the image model spelling long Arabic correctly.
 *
 * Fonts: rendered by the system font stack (fontconfig). Production servers need an Arabic-capable
 * font installed (e.g. Noto Sans Arabic / IBM Plex Sans Arabic) — see docs/AI-SYSTEM.md.
 */
const FONT_STACK = "'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Segoe UI', 'Tahoma', 'Arial', sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isArabic = (s: string) => /[؀-ۿ]/.test(s);

/** Greedy word wrap by an approximate glyph width. Pure — unit tested. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else line = next;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const used = lines.join(" ").length;
  if (used < text.trim().length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,،]?$/, "")}…`;
  return lines;
}

/** Safe resize/crop from the generated size to the exact social size (content-aware "attention" crop). */
export async function fitToSize(image: Buffer, width: number, height: number) {
  return sharp(image).resize(width, height, { fit: "cover", position: sharp.strategy.attention }).png().toBuffer();
}

export type TemplateInput = {
  width: number;
  height: number;
  headline: string | null;
  cta: string | null;
  brandName: string;
  primary: string;
  secondary: string;
  logo?: Buffer | null;
};

const HEX = /^#[0-9a-f]{3,8}$/i;
const color = (c: string | undefined, fallback: string) => (c && HEX.test(c) ? c : fallback);

/** Brand Template: headline + CTA + logo + footer over the AI visual, in the brand colours. */
export async function composeBrandTemplate(background: Buffer, t: TemplateInput) {
  const { width: W, height: H } = t;
  const pad = Math.round(W * 0.07);
  const primary = color(t.primary, "#17161c");
  const secondary = color(t.secondary, "#ffffff");
  const rtl = isArabic(`${t.headline ?? ""}${t.cta ?? ""}${t.brandName}`);
  const headlineSize = Math.round(W * (H > W * 1.4 ? 0.068 : 0.06));
  const lines = t.headline ? wrapText(t.headline, Math.max(12, Math.floor((W - pad * 2) / (headlineSize * 0.55))), 3) : [];
  const lineGap = Math.round(headlineSize * 1.28);
  const ctaSize = Math.round(W * 0.034);
  const footerSize = Math.round(W * 0.026);
  const bottom = H - pad;
  const ctaH = t.cta ? Math.round(ctaSize * 2.4) : 0;
  const ctaY = bottom - footerSize * 2.2 - ctaH;
  const firstLineY = ctaY - (t.cta ? Math.round(ctaSize * 1.4) : 0) - (lines.length - 1) * lineGap;
  const x = rtl ? W - pad : pad;
  // Each text element gets its own direction; the anchor then pins it to the layout side
  // (under direction=rtl, "start" is the right edge).
  const textAttrs = (s: string) => {
    const r = isArabic(s);
    const anchor = rtl ? (r ? "start" : "end") : r ? "end" : "start";
    return `direction="${r ? "rtl" : "ltr"}" text-anchor="${anchor}"`;
  };
  const scrimTop = Math.max(0, firstLineY - headlineSize * 2);
  const ctaW = t.cta ? Math.min(W - pad * 2, Math.round(t.cta.length * ctaSize * 0.62 + ctaSize * 2.4)) : 0;
  const ctaX = rtl ? W - pad - ctaW : pad;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${primary}" stop-opacity="0"/>
      <stop offset="0.35" stop-color="${primary}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${primary}" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${scrimTop}" width="${W}" height="${H - scrimTop}" fill="url(#scrim)"/>
  <g font-family="${FONT_STACK}">
    ${lines.map((l, i) => `<text x="${x}" y="${firstLineY + i * lineGap}" font-size="${headlineSize}" font-weight="700" fill="#ffffff" ${textAttrs(l)}>${esc(l)}</text>`).join("\n    ")}
    ${
      t.cta
        ? `<rect x="${ctaX}" y="${ctaY}" width="${ctaW}" height="${ctaH}" rx="${ctaH / 2}" fill="${secondary}"/>
    <text x="${ctaX + ctaW / 2}" y="${ctaY + ctaH / 2 + ctaSize * 0.36}" font-size="${ctaSize}" font-weight="700" fill="${primary}" direction="${isArabic(t.cta) ? "rtl" : "ltr"}" text-anchor="middle">${esc(t.cta)}</text>`
        : ""
    }
    <text x="${x}" y="${bottom}" font-size="${footerSize}" font-weight="600" fill="#ffffff" fill-opacity="0.85" ${textAttrs(t.brandName)}>${esc(t.brandName)}</text>
  </g>
</svg>`;

  const layers: OverlayOptions[] = [{ input: Buffer.from(svg), top: 0, left: 0 }];
  if (t.logo) {
    const size = Math.round(W * 0.13);
    const logo = await sharp(t.logo).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    layers.push({ input: logo, top: pad, left: rtl ? pad : W - pad - size });
  }
  return sharp(await fitToSize(background, W, H)).composite(layers).png().toBuffer();
}
