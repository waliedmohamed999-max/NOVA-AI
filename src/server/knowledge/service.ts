import { Prisma } from "@/generated/prisma/client";
import type { KnowledgeSourceType } from "@/generated/prisma/enums";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { sha256 } from "../crypto";
import { aiEmbed } from "../ai";
import { logger } from "../logger";
import { safeFetchText, UnsafeUrlError } from "../net/safe-fetch";
import { chunkText, extractPage, pickInterestingLinks, type ExtractedPage } from "./extract";
import { enqueue } from "../jobs/queue";
import { stripBoilerplate } from "./company-context";

export type WebsiteSignals = {
  title: string;
  description: string | null;
  language: string | null;
  headings: string[];
  social: Record<string, string>;
  themeColor: string | null;
  logoUrl: string | null;
  pages: { url: string; title: string }[];
};

export async function addKnowledgeSource(
  scope: TenantScope,
  input: { type: KnowledgeSourceType; title: string; url?: string | null; rawText?: string | null; fileId?: string | null; metadata?: Record<string, unknown> },
) {
  const t = tenantDb(scope);
  const source = await t.knowledgeSource.create({
    data: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      type: input.type,
      title: input.title.slice(0, 200),
      url: input.url ?? null,
      rawText: input.rawText ?? null,
      fileId: input.fileId ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      status: "PENDING",
    },
  });
  await enqueue("knowledge.ingest", { ...scope, sourceId: source.id }, { ...scope, dedupeKey: `knowledge.ingest:${source.id}:${source.updatedAt.getTime()}` });
  return source;
}

/** Crawls a website: the home page plus a handful of pages that describe the business. */
export async function crawlWebsite(url: string, maxPages = 6): Promise<ExtractedPage[]> {
  const home = await safeFetchText(url);
  if (home.status >= 400 || !home.contentType.includes("html")) throw new UnsafeUrlError(`Website returned ${home.status}`);
  const first = extractPage(home.body, home.url);
  const pages = [first];
  for (const link of pickInterestingLinks(first.links, maxPages - 1)) {
    try {
      const res = await safeFetchText(link, { timeoutMs: 8000 });
      if (res.status < 400 && res.contentType.includes("html")) pages.push(extractPage(res.body, res.url));
    } catch (err) {
      logger.debug({ err, link }, "skipping page");
    }
  }
  return pages;
}

export function websiteSignals(pages: ExtractedPage[]): WebsiteSignals {
  const home = pages[0];
  return {
    title: home.title,
    description: home.description,
    language: home.language,
    headings: [...new Set(pages.flatMap((p) => p.headings))].slice(0, 30),
    social: Object.assign({}, ...pages.map((p) => p.social)),
    themeColor: home.themeColor,
    logoUrl: home.logoUrl,
    pages: pages.map((p) => ({ url: p.url, title: p.title })),
  };
}

/** Job handler body: turns a source into documents + chunks (+ embeddings when available). */
export async function ingestSource(scope: TenantScope, sourceId: string) {
  const t = tenantDb(scope);
  const source = await t.knowledgeSource.findUnique({ where: { id: sourceId } });
  if (!source) return { skipped: true };
  await t.knowledgeSource.update({ where: { id: source.id }, data: { status: "PROCESSING", error: null } });

  try {
    let docs: { title: string; url?: string; content: string }[] = [];
    let extraMeta: Record<string, unknown> = {};
    if (source.type === "WEBSITE" && source.url) {
      const pages = await crawlWebsite(source.url);
      docs = pages.filter((p) => p.text.length > 40).map((p) => ({ title: p.title || p.url, url: p.url, content: p.text }));
      extraMeta = { signals: websiteSignals(pages) };
    } else if (source.rawText) {
      docs = [{ title: source.title, content: source.rawText }];
    }

    const keepHashes: string[] = [];
    let chunkCount = 0;
    for (const d of docs) {
      const contentHash = sha256(d.content);
      keepHashes.push(contentHash);
      const existing = await t.knowledgeDocument.findFirst({ where: { sourceId: source.id, contentHash } });
      if (existing) continue;
      const doc = await t.knowledgeDocument.create({
        data: { ...scope, sourceId: source.id, title: d.title.slice(0, 300), url: d.url ?? null, content: d.content, contentHash },
      });
      const pieces = chunkText(d.content);
      await t.knowledgeChunk.createMany({
        data: pieces.map((content, index) => ({
          ...scope,
          documentId: doc.id,
          sourceId: source.id,
          index,
          content,
          tokenCount: Math.ceil(content.length / 4),
          metadata: { title: d.title, url: d.url ?? null, sourceType: source.type },
        })),
      });
      chunkCount += pieces.length;
      await embedDocumentChunks(scope, doc.id);
    }
    // Remove documents that no longer exist at the source (history of the source itself is kept).
    await t.knowledgeDocument.deleteMany({ where: { sourceId: source.id, contentHash: { notIn: keepHashes } } });

    await t.knowledgeSource.update({
      where: { id: source.id },
      data: {
        status: "READY",
        lastSyncedAt: new Date(),
        // A compact extractive summary (no AI) for summary-first retrieval; the brain fingerprint changes with this update.
        metadata: { ...(source.metadata as object), ...extraMeta, documents: docs.length, newChunks: chunkCount, summary: summarizeDocs(docs) } as Prisma.InputJsonValue,
      },
    });
    return { documents: docs.length, chunks: chunkCount };
  } catch (err) {
    const friendly = err instanceof UnsafeUrlError || (err instanceof Error && err.name === "TimeoutError") ? "website_unreachable" : "unexpected";
    await t.knowledgeSource.update({ where: { id: source.id }, data: { status: "FAILED", error: friendly } });
    if (friendly === "website_unreachable") return { failed: friendly };
    throw err;
  }
}

/** First meaningful sentences of each document, boilerplate removed — bounded to ~600 characters. */
export function summarizeDocs(docs: { title: string; content: string }[]) {
  const parts: string[] = [];
  for (const d of docs) {
    const sentence = stripBoilerplate(d.content).split(/(?<=[.!?؟])\s+|\n+/).find((s) => s.trim().length > 40);
    if (sentence) parts.push(`${d.title ? `${d.title}: ` : ""}${sentence.trim().slice(0, 200)}`);
    if (parts.join(" ").length > 600) break;
  }
  return parts.join("\n").slice(0, 600);
}

async function embedDocumentChunks(scope: TenantScope, documentId: string) {
  const chunks = await db.knowledgeChunk.findMany({
    where: { documentId, organizationId: scope.organizationId, workspaceId: scope.workspaceId },
    select: { id: true, content: true },
    orderBy: { index: "asc" },
  });
  for (let i = 0; i < chunks.length; i += 64) {
    const batch = chunks.slice(i, i + 64);
    const res = await aiEmbed({ organizationId: scope.organizationId, workspaceId: scope.workspaceId }, batch.map((c) => c.content)).catch((err) => {
      logger.warn({ err }, "embedding failed; keyword search remains available");
      return null;
    });
    if (!res) return;
    for (const [j, chunk] of batch.entries()) {
      const vector = `[${res.vectors[j].join(",")}]`;
      await db.$executeRaw`UPDATE "knowledge_chunks" SET "embedding" = ${vector}::vector, "embeddingModel" = ${res.model}
        WHERE "id" = ${chunk.id} AND "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}`;
    }
  }
}
