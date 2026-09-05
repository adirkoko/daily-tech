import type { BriefStatus } from "@daily-tech/core";
import type { PublicationState } from "@daily-tech/db";

export type HomePublicationStatus = "pending" | "failed" | null;

export interface HomePublicationInput {
  readonly publicationDue: boolean;
  readonly targetStatus: BriefStatus | null;
  readonly publicationState: PublicationState | null;
}

/** Public status is about availability at the promised publication time, not
 * about internal generation work readers cannot observe. */
export function homePublicationStatus(input: HomePublicationInput): HomePublicationStatus {
  if (!input.publicationDue || input.targetStatus === "published") return null;
  if (input.targetStatus === "failed" || input.publicationState === "failed") return "failed";
  return "pending";
}
