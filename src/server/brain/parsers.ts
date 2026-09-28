import { inflateRawSync } from "node:zlib";
import { parseCsv } from "../sales/intelligence";

/**
 * Local file parsing for Company Brain imports — no AI, no network.
 * CSV (existing parser), XLSX/DOCX (a minimal ZIP + XML reader on node:zlib), PDF (unpdf / pdf.js), TXT.
 */

const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

/** Reads the entries of a ZIP archive (stored or deflated), bounded in size. */
export function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // End of central directory: signature 0x06054b50 within the last 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries && n < 2000; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (size > MAX_ENTRY_BYTES) continue;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
  }
  return out;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

/** DOCX → plain text, one paragraph per line (headings keep their own line). */
export function parseDocx(buf: Buffer): string {
  const zip = readZip(buf);
  const xml = zip.get("word/document.xml")?.toString("utf8");
  if (!xml) throw new Error("not a docx document");
  return xml
    .split(/<\/w:p>/)
    .map((p) => decodeXml((p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")).trim())
    .filter(Boolean)
    .join("\n");
}

/** XLSX first worksheet → rows of cells (shared strings + inline strings + numbers). */
export function parseXlsx(buf: Buffer, maxRows = 5000): string[][] {
  const zip = readZip(buf);
  const shared = (zip.get("xl/sharedStrings.xml")?.toString("utf8") ?? "")
    .split(/<\/si>/)
    .slice(0, -1)
    .map((si) => decodeXml((si.match(/<t[^>]*>([^<]*)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  const sheetName = [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  const xml = sheetName ? zip.get(sheetName)!.toString("utf8") : "";
  if (!xml) throw new Error("not an xlsx workbook");
  const col = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0) - 1;
  const rows: string[][] = [];
  for (const rowXml of xml.split(/<\/row>/).slice(0, maxRows)) {
    const cells: string[] = [];
    for (const m of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1];
      const inner = m[2] ?? "";
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/t="(\w+)"/)?.[1];
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s" && v != null) value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = decodeXml((inner.match(/<t[^>]*>([^<]*)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join(""));
      else if (v != null) value = decodeXml(v);
      const idx = ref ? col(ref) : cells.length;
      while (cells.length < idx) cells.push("");
      cells[idx] = value.trim();
    }
    if (cells.some(Boolean)) rows.push(cells);
  }
  return rows;
}

/** PDF → text (pdf.js via unpdf; runs locally). */
export async function parsePdf(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join("\n\n").replace(/[ \t]+\n/g, "\n").trim();
}

export type ParsedFile = { kind: "csv" | "excel" | "pdf" | "docx" | "txt"; rows?: string[][]; text?: string };

export async function parseFile(buf: Buffer, fileName: string, mimeType: string): Promise<ParsedFile> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (mimeType === "text/csv" || ext === "csv") return { kind: "csv", rows: parseCsv(buf.toString("utf8").replace(/^﻿/, "")) };
  if (ext === "xlsx" || mimeType.includes("spreadsheetml")) return { kind: "excel", rows: parseXlsx(buf) };
  if (ext === "docx" || mimeType.includes("wordprocessingml")) return { kind: "docx", text: parseDocx(buf) };
  if (mimeType === "application/pdf" || ext === "pdf") return { kind: "pdf", text: await parsePdf(buf) };
  if (mimeType.startsWith("text/") || ext === "txt" || ext === "md") return { kind: "txt", text: buf.toString("utf8") };
  throw new Error("unsupported file type");
}

/** Share of Arabic letters — used as the source language. */
export function detectLanguage(text: string): "ar" | "en" | null {
  const sample = text.slice(0, 4000);
  const ar = (sample.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  if (ar + latin < 20) return null;
  return ar > latin ? "ar" : "en";
}
