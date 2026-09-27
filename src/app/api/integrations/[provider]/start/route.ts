import type { NextRequest } from "next/server";
import { startOAuth } from "@/server/integrations/start-handler";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/integrations/[provider]/start">) {
  return startOAuth(req, (await ctx.params).provider);
}
