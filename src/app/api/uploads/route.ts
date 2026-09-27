import { NextResponse, type NextRequest } from "next/server";
import { resolveTenant } from "@/server/context";
import { saveUpload, signedFileUrl, MAX_UPLOAD_BYTES } from "@/server/storage";
import { enforceRateLimit, RateLimitError } from "@/server/rate-limit";
import { UserFacingError } from "@/server/errors";
import { logger } from "@/server/logger";

/** Authenticated, tenant-scoped multipart upload. Validates size and real file type. */
export async function POST(req: NextRequest) {
  const ctx = await resolveTenant();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!ctx.can("content:create")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && process.env.APP_URL && new URL(origin).host !== new URL(process.env.APP_URL).host && new URL(origin).host !== req.nextUrl.host) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    await enforceRateLimit(`upload:${ctx.user.id}`, 30, 60);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "validation" }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "file_too_large" }, { status: 413 });
    const purpose = String(form.get("purpose") ?? "attachment").slice(0, 40);
    const saved = await saveUpload({
      organizationId: ctx.organization.id,
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      fileName: file.name,
      data: Buffer.from(await file.arrayBuffer()),
      purpose,
    });
    return NextResponse.json({ id: saved.id, name: saved.fileName, mimeType: saved.mimeType, size: saved.sizeBytes, url: signedFileUrl(saved.id) });
  } catch (err) {
    if (err instanceof UserFacingError) return NextResponse.json({ error: err.code }, { status: 400 });
    if (err instanceof RateLimitError) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    logger.error({ err }, "upload failed");
    return NextResponse.json({ error: "unexpected" }, { status: 500 });
  }
}
