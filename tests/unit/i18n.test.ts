import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(__dirname, "../../src/i18n/messages");

function keys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("message catalogs", () => {
  const namespaces = readdirSync(path.join(dir, "en")).filter((f) => f.endsWith(".json"));
  for (const ns of namespaces) {
    it(`${ns}: Arabic and English have identical keys`, () => {
      const en = keys(JSON.parse(readFileSync(path.join(dir, "en", ns), "utf8"))).sort();
      const ar = keys(JSON.parse(readFileSync(path.join(dir, "ar", ns), "utf8"))).sort();
      expect(ar.filter((k) => !en.includes(k))).toEqual([]);
      expect(en.filter((k) => !ar.includes(k))).toEqual([]);
    });
  }
});
