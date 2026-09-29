import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { destructiveStatements } from "../../scripts/migration-guard.mjs";
import { S3Driver } from "@/server/storage/s3";

describe("migration guard", () => {
  it("flags destructive statements", () => {
    for (const sql of [
      `ALTER TABLE "leads" DROP COLUMN "notes";`,
      `DROP TABLE "old_things";`,
      `DROP INDEX "brain_chunks_embedding_idx";`,
      `TRUNCATE "jobs";`,
      `DELETE FROM "users" WHERE 1=1;`,
      `ALTER TABLE "leads" ALTER COLUMN "score" TYPE TEXT;`,
      `ALTER TABLE "leads" ALTER COLUMN "score" SET DATA TYPE BIGINT;`,
      `DROP SCHEMA public CASCADE;`,
    ])
      expect(destructiveStatements(sql), sql).toHaveLength(1);
  });

  it("lets additive statements through, and ignores comments", () => {
    const sql = `
      -- DROP TABLE "not_really"; this is a comment
      CREATE TABLE "worker_heartbeats" ("workerId" TEXT NOT NULL);
      ALTER TABLE "leads" ADD COLUMN "phoneDigits" TEXT;
      CREATE INDEX "x_idx" ON "leads"("phoneDigits");
      ALTER TABLE "leads" ALTER COLUMN "score" SET DEFAULT 0;
      ALTER TABLE "leads" ALTER COLUMN "notes" DROP NOT NULL;`;
    expect(destructiveStatements(sql)).toEqual([]);
  });

  it("the newest migration (Phase 1) is additive", () => {
    const dir = path.join(process.cwd(), "prisma", "migrations");
    const file = path.join(dir, "20261006100000_worker_heartbeats", "migration.sql");
    expect(existsSync(file)).toBe(true);
    expect(destructiveStatements(readFileSync(file, "utf8"))).toEqual([]);
    expect(readdirSync(dir).length).toBeGreaterThan(10);
  });
});

describe("S3 storage readiness probe", () => {
  const cfg = { bucket: "nova-assets", region: "auto", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", endpoint: "https://acc.r2.cloudflarestorage.com" };
  const driver = (status: number | "throw") =>
    new S3Driver(cfg, {
      fetch: (async (_url: string, init: RequestInit) => {
        expect(init.method).toBe("HEAD");
        if (status === "throw") throw new Error("ECONNREFUSED");
        return new Response(null, { status });
      }) as unknown as typeof fetch,
    });

  it("treats 200 and 404 as reachable (credentials and bucket work)", async () => {
    expect((await driver(200).check()).ok).toBe(true);
    expect((await driver(404).check()).ok).toBe(true);
  });

  it("reports denied or unreachable storage without leaking credentials", async () => {
    const denied = await driver(403).check();
    expect(denied).toEqual({ ok: false, detail: "HTTP 403" });
    const down = await driver("throw").check();
    expect(down).toEqual({ ok: false, detail: "unreachable" });
    expect(JSON.stringify([denied, down])).not.toContain(cfg.secretAccessKey);
  });
});
