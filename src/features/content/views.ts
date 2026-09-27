import type { ContentStatus } from "@/generated/prisma/enums";

export const VIEWS = {
  ideas: ["IDEA"],
  drafts: ["DRAFT", "REJECTED"],
  approval: ["PENDING_APPROVAL"],
  scheduled: ["APPROVED", "SCHEDULED", "PUBLISHING", "FAILED"],
  published: ["PUBLISHED"],
} as const satisfies Record<string, readonly ContentStatus[]>;

export type ViewKey = keyof typeof VIEWS;
