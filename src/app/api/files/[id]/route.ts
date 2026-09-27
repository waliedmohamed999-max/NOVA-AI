import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { storage, verifyFileSignature } from "@/server/storage";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  if (!verifyFileSignature(id, sp.get("exp"), sp.get("sig"))) return new NextResponse("Not found", { status: 404 });
  const file = await db.fileObject.findUnique({ where: { id } });
  if (!file || file.deletedAt) return new NextResponse("Not found", { status: 404 });
  const data = await storage.get(file.storageKey);
  const inline = file.mimeType.startsWith("image/");
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": file.mimeType,
      "content-length": String(data.byteLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(file.fileName)}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, max-age=3600",
    },
  });
}
