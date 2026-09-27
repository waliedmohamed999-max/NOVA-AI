"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { addKnowledgeSource } from "@/server/knowledge/service";
import { normalizeUrl } from "@/server/net/safe-fetch";
import { enqueue } from "@/server/jobs/queue";
import { storage } from "@/server/storage";
import { UserFacingError } from "@/server/errors";

const scopeOf = (ctx: { organization: { id: string }; workspace: { id: string } }) => ({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
const TYPES = ["WEBSITE", "DOCUMENT", "MANUAL", "FAQ", "PRODUCT", "SERVICE", "PRICING", "POLICY", "CASE_STUDY"] as const;

export const addSource = tenantAction(
  { name: "knowledge.add", permission: "knowledge:manage", rateLimit: 20 },
  z.object({ type: z.enum(TYPES), title: z.string().trim().max(200).optional(), url: z.string().trim().max(500).optional(), text: z.string().trim().max(200_000).optional(), fileId: z.string().optional() }),
  async (input, ctx) => {
    let rawText = input.text || null;
    let url: string | null = null;
    if (input.type === "WEBSITE") {
      try {
        url = normalizeUrl(input.url ?? "").toString();
      } catch {
        throw new UserFacingError("website_unreachable");
      }
    }
    if (input.fileId) {
      const f = await ctx.db.fileObject.findUnique({ where: { id: input.fileId } });
      if (!f) throw new UserFacingError("item_not_found");
      if (!f.mimeType.startsWith("text/") && f.mimeType !== "application/json") throw new UserFacingError("file_type");
      rawText = (await storage.get(f.storageKey)).toString("utf8").slice(0, 200_000);
    }
    if (input.type !== "WEBSITE" && !rawText) throw new UserFacingError("validation");
    const title = input.title || (url ? new URL(url).hostname : (rawText ?? "").split("\n")[0].slice(0, 80));
    const source = await addKnowledgeSource(scopeOf(ctx), { type: input.type, title, url, rawText, fileId: input.fileId ?? null });
    revalidatePath("/knowledge");
    return { id: source.id };
  },
);

export const removeSource = tenantAction({ name: "knowledge.remove", permission: "knowledge:manage" }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  await ctx.db.knowledgeSource.delete({ where: { id } });
  revalidatePath("/knowledge");
  return { ok: true };
});

export const resyncSource = tenantAction({ name: "knowledge.resync", permission: "knowledge:manage", rateLimit: 10 }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  const s = await ctx.db.knowledgeSource.update({ where: { id }, data: { status: "PENDING" } });
  await enqueue("knowledge.ingest", { ...scopeOf(ctx), sourceId: s.id }, scopeOf(ctx));
  revalidatePath("/knowledge");
  return { ok: true };
});

export const saveProfile = tenantAction(
  { name: "brain.profile", permission: "knowledge:manage" },
  z.object({ summary: z.string().max(2000), industry: z.string().max(120), valueProps: z.array(z.string().max(200)).max(8), contentPillars: z.array(z.string().max(60)).max(8) }),
  async (input, ctx) => {
    await ctx.db.companyProfile.updateMany({ data: input });
    revalidatePath("/knowledge");
    return { ok: true };
  },
);

export const saveOffering = tenantAction(
  { name: "brain.offering", permission: "knowledge:manage" },
  z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(120), type: z.enum(["PRODUCT", "SERVICE"]), priceText: z.string().max(60).optional(), description: z.string().max(1000).optional(), remove: z.boolean().optional() }),
  async ({ id, remove, ...data }, ctx) => {
    if (id && remove) await ctx.db.offering.delete({ where: { id } });
    else if (id) await ctx.db.offering.update({ where: { id }, data });
    else await ctx.db.offering.create({ data: { ...data, organizationId: "", workspaceId: "" } });
    revalidatePath("/knowledge");
    return { ok: true };
  },
);

export const saveBrandKit = tenantAction(
  { name: "brand.save", permission: "brand:manage" },
  z.object({
    tone: z.string().max(200),
    voiceTraits: z.array(z.string().max(40)).max(8),
    primaryColors: z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).max(4),
    secondaryColors: z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).max(4),
    headingFont: z.string().max(80),
    bodyFont: z.string().max(80),
    imageStyle: z.string().max(500),
    layoutRules: z.array(z.string().max(200)).max(10),
    forbiddenStyles: z.array(z.string().max(120)).max(10),
    doSay: z.array(z.string().max(120)).max(10),
    dontSay: z.array(z.string().max(120)).max(10),
    logoFileId: z.string().nullable().optional(),
  }),
  async ({ logoFileId, ...data }, ctx) => {
    await ctx.db.brandKit.updateMany({ data: { ...data, ...(logoFileId !== undefined ? { logoAssetId: logoFileId } : {}) } });
    revalidatePath("/brand");
    return { ok: true };
  },
);
