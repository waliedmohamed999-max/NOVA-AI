import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { keyBelongsTo, storage, directDownloadsEnabled, verifyFileSignature } from "@/server/storage";

/** Serves a stored file behind an HMAC-signed, expiring URL. Objects themselves are never public. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  if (!verifyFileSignature(id, sp.get("exp"), sp.get("sig"))) return new NextResponse("Not found", { status: 404 });
  const file = await db.fileObject.findUnique({ where: { id } });
  if (!file || file.deletedAt || !keyBelongsTo(file.organizationId, file.storageKey)) return new NextResponse("Not found", { status: 404 });
  const inline = file.mimeType.startsWith("image/");
  const disposition = `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(file.fileName)}"`;

  // S3/R2 with S3_SIGNED_REDIRECT=true: hand the browser a 5-minute presigned URL instead of streaming.
  if (directDownloadsEnabled()) {
    const url = storage.presignGet!(file.storageKey, 300, { contentType: file.mimeType, disposition });
    return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
  }

  const data = await storage.get(file.storageKey);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": file.mimeType,
      "content-length": String(data.byteLength),
      "content-disposition": disposition,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, max-age=3600",
    },
  });
}
