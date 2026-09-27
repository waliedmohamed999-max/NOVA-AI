// Deep-merges message patches into namespace catalogs.
// Usage: node scripts/i18n-merge.mjs <namespace> <en-patch.json> <ar-patch.json>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [ns, enPatch, arPatch] = process.argv.slice(2);
if (!ns || !enPatch || !arPatch) {
  console.error("usage: i18n-merge <namespace> <en-patch.json> <ar-patch.json>");
  process.exit(1);
}
const merge = (a, b) => {
  for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === "object" && !Array.isArray(v) ? merge(a[k] ?? {}, v) : v;
  return a;
};
for (const [locale, patch] of [["en", enPatch], ["ar", arPatch]]) {
  const file = path.resolve("src/i18n/messages", locale, `${ns}.json`);
  const current = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify(merge(current, JSON.parse(readFileSync(patch, "utf8"))), null, 2) + "\n");
}
console.log(`merged ${ns}`);
