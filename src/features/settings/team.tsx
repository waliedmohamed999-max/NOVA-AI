"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Avatar, Progress } from "@/components/ui/misc";
import { Section, useAct } from "./ui";
import { changeRole, inviteMember, removeMember, revokeInvite } from "./actions";

const ROLES = ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"] as const;
const RANK: Record<string, number> = { VIEWER: 0, MEMBER: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 };
type Role = (typeof ROLES)[number];

export function TeamManager({
  me,
  canManage,
  seats,
  members,
  invites,
}: {
  me: { id: string; role: Role };
  canManage: boolean;
  seats: { used: number; limit: number };
  members: { id: string; userId: string; name: string | null; email: string; role: Role }[];
  invites: { id: string; email: string; role: Role; state: "pending" | "expired" | "revoked" }[];
}) {
  const t = useTranslations("settings.team");
  const tc = useTranslations("common");
  const { act, pending } = useAct();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("MEMBER");
  const assignable = ROLES.filter((r) => me.role === "OWNER" || RANK[r] < RANK[me.role]);
  const canTouch = (r: Role) => canManage && (me.role === "OWNER" || RANK[r] < RANK[me.role]);

  return (
    <div className="space-y-6">
      <Section title={t("title")} description={t("description")}>
        <div className="space-y-2">
          <div className="flex justify-between text-sm"><span className="text-ink-3">{t("seats")}</span><span className="tabular font-medium">{seats.used} / {seats.limit}</span></div>
          <Progress value={(seats.used / Math.max(1, seats.limit)) * 100} label={t("seats")} tone={seats.used >= seats.limit ? "warning" : "ink"} />
        </div>
        {canManage && (
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); act(() => inviteMember({ email, role }), t("invited"), () => setEmail("")); }}>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("emailPlaceholder")} aria-label={t("emailPlaceholder")} dir="ltr" />
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)} className="sm:w-40" aria-label={t("role")}>
              {assignable.map((r) => <option key={r} value={r}>{tc(`roles.${r}`)}</option>)}
            </Select>
            <Button type="submit" loading={pending} icon={<UserPlus className="size-4" />}>{t("invite")}</Button>
          </form>
        )}
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar name={m.name ?? m.email} size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.name ?? m.email}{m.userId === me.id && <span className="ms-2 text-xs text-ink-4">{t("you")}</span>}</div>
                <div className="truncate text-xs text-ink-3" dir="ltr">{m.email}</div>
              </div>
              {canTouch(m.role) && m.userId !== me.id ? (
                <>
                  <Select value={m.role} onChange={(e) => act(() => changeRole({ memberId: m.id, role: e.target.value as Role }), t("roleChanged"))} className="h-9 w-36" aria-label={t("role")}>
                    {assignable.map((r) => <option key={r} value={r}>{tc(`roles.${r}`)}</option>)}
                  </Select>
                  <Button size="xs" variant="ghost" onClick={() => act(() => removeMember({ memberId: m.id }), t("removed"))}>{tc("actions.remove")}</Button>
                </>
              ) : (
                <Badge tone={m.role === "OWNER" ? "accent" : "neutral"}>{tc(`roles.${m.role}`)}</Badge>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("pending")} description={t("pendingHint")}>
        {invites.length === 0 ? (
          <p className="text-sm text-ink-3">{t("noPending")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-3 text-sm">
                <span className="min-w-0 flex-1 truncate" dir="ltr">{i.email}</span>
                <Badge tone="neutral">{tc(`roles.${i.role}`)}</Badge>
                <Badge tone={i.state === "pending" ? "info" : "outline"}>{t(`inviteStates.${i.state}`)}</Badge>
                {canManage && i.state === "pending" && (
                  <button className="rounded-full p-1.5 text-ink-4 hover:bg-sunken hover:text-ink" onClick={() => act(() => revokeInvite({ id: i.id }), t("revoked"))} aria-label={t("revoke")}>
                    <X className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <p className="text-xs text-ink-4">{t("rbacNote")}</p>
    </div>
  );
}
