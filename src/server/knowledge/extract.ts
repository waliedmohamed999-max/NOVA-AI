import { parse, type HTMLElement } from "node-html-parser";

export type ExtractedPage = {
  url: string;
  title: string;
  description: string | null;
  language: string | null;
  headings: string[];
  text: string;
  links: string[];
  social: Record<string, string>;
  themeColor: string | null;
  logoUrl: string | null;
};

const SOCIAL_HOSTS: Record<string, string> = {
  "instagram.com": "instagram",
  "facebook.com": "facebook",
  "linkedin.com": "linkedin",
  "tiktok.com": "tiktok",
  "x.com": "x",
  "twitter.com": "x",
  "youtube.com": "youtube",
  "pinterest.com": "pinterest",
};

function clean(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

/** Extracts readable text and brand signals from an HTML page. */
export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  const meta = (sel: string) => root.querySelector(sel)?.getAttribute("content")?.trim() || null;
  const base = new URL(pageUrl);

  const links = new Set<string>();
  const social: Record<string, string> = {};
  for (const a of root.querySelectorAll("a[href]")) {
    try {
      const href = new URL(a.getAttribute("href")!, base);
      const host = href.hostname.replace(/^www\./, "");
      const network = SOCIAL_HOSTS[host];
      if (network && !social[network]) social[network] = href.toString();
      else if (href.hostname === base.hostname && ["http:", "https:"].includes(href.protocol)) {
        href.hash = "";
        href.search = "";
        links.add(href.toString());
      }
    } catch {
      /* ignore malformed hrefs */
    }
  }

  for (const sel of ["nav", "footer", "header", "form", "svg", "iframe"]) root.querySelectorAll(sel).forEach((n: HTMLElement) => n.remove());
  const main = root.querySelector("main") ?? root.querySelector("article") ?? root.querySelector("body") ?? root;

  const blocks: string[] = [];
  for (const el of main.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, td, dd")) {
    const t = clean(el.text);
    if (t.length > 2 && !blocks.includes(t)) blocks.push(t);
  }

  const icon =
    root.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ??
    root.querySelector('link[rel="icon"]')?.getAttribute("href") ??
    meta('meta[property="og:image"]');

  return {
    url: pageUrl,
    title: clean(root.querySelector("title")?.text ?? meta('meta[property="og:title"]') ?? ""),
    description: meta('meta[name="description"]') ?? meta('meta[property="og:description"]'),
    language: root.querySelector("html")?.getAttribute("lang") ?? null,
    headings: root
      .querySelectorAll("h1, h2")
      .map((h) => clean(h.text))
      .filter((h) => h.length > 2)
      .slice(0, 20),
    text: blocks.join("\n").slice(0, 60_000),
    links: [...links].slice(0, 200),
    social,
    themeColor: meta('meta[name="theme-color"]'),
    logoUrl: icon ? new URL(icon, base).toString() : null,
  };
}

/** Pages most likely to describe the business, in priority order. */
const INTERESTING = /(about|who-we-are|company|services?|solutions?|products?|pricing|plans|faq|contact|team|من-نحن|خدمات|الأسعار)/i;

export function pickInterestingLinks(links: string[], limit: number): string[] {
  return links
    .filter((l) => INTERESTING.test(new URL(l).pathname))
    .filter((l) => !/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|mp4)$/i.test(l))
    .sort((a, b) => new URL(a).pathname.length - new URL(b).pathname.length)
    .slice(0, limit);
}

/** Paragraph-aware chunking to roughly `targetTokens` with a small overlap. */
export function chunkText(text: string, targetTokens = 450, overlapTokens = 60): string[] {
  const approxTokens = (s: string) => Math.ceil(s.length / 4);
  const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const p of paragraphs) {
    const t = approxTokens(p);
    if (size + t > targetTokens && current.length) {
      chunks.push(current.join("\n"));
      const tail: string[] = [];
      let tailSize = 0;
      for (const q of [...current].reverse()) {
        if (tailSize + approxTokens(q) > overlapTokens) break;
        tail.unshift(q);
        tailSize += approxTokens(q);
      }
      current = tail;
      size = tailSize;
    }
    if (t > targetTokens) {
      for (let i = 0; i < p.length; i += targetTokens * 4) chunks.push(p.slice(i, i + targetTokens * 4));
      continue;
    }
    current.push(p);
    size += t;
  }
  if (current.length) chunks.push(current.join("\n"));
  return chunks;
}
