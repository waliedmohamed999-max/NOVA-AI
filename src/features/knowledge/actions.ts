"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";


export const removeSource = tenantAction({ name: "knowledge.remove", permission: "knowledge:manage" }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  await ctx.db.knowledgeSource.delete({ where: { id } });
  revalidatePath("/knowledge");
  return { ok: true };
});

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
