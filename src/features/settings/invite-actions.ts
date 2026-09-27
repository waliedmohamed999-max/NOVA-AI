"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { acceptInvitation, declineInvitation } from "@/server/team/invitations";
import { mapError, type ActionResult } from "@/server/action";
import { enforceRateLimit } from "@/server/rate-limit";

export async function acceptInviteAction(token: string): Promise<ActionResult<undefined>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  try {
    await enforceRateLimit(`invite:${session.userId}`, 20, 600);
    await acceptInvitation(token, session.user);
  } catch (err) {
    return mapError(err, "invite.accept");
  }
  redirect("/home");
}

export async function declineInviteAction(token: string): Promise<ActionResult<undefined>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthenticated" };
  try {
    await declineInvitation(token, session.user);
  } catch (err) {
    return mapError(err, "invite.decline");
  }
  redirect("/");
}
