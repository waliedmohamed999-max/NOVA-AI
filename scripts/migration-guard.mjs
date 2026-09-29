// Destructive-SQL detection for pending migrations (used by scripts/migrate-on-build.mjs, unit-tested).

export const DESTRUCTIVE = [
  /\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE|INDEX|MATERIALIZED\s+VIEW|VIEW)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i,
];

/** Statements of a migration file, comments stripped. */
export function statements(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The destructive statements of one migration file (first line of each, max 120 chars). */
export function destructiveStatements(sql) {
  return statements(sql)
    .filter((st) => DESTRUCTIVE.some((re) => re.test(st)))
    .map((st) => st.split("\n")[0].slice(0, 120));
}
