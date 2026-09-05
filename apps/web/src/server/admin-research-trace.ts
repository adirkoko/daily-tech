import type { JsonValue, OperationalLog, ScheduledJob } from "@daily-tech/db";

import { openServerDatabase } from "./database.js";

export type ResearchStageKey =
  | "light_discovery"
  | "gap_discovery"
  | "keyword_discovery"
  | "deep_research";

export interface AdminResearchStage {
  readonly key: ResearchStageKey;
  readonly state: "completed" | "skipped" | "failed";
  readonly reason: string | null;
  readonly foundCount: number;
  readonly contributedCount: number;
  readonly rejectedCount: number;
  readonly filteredCount: number;
  readonly topics: readonly string[];
  readonly foundTitles: readonly string[];
  readonly contributedTitles: readonly string[];
  readonly filteredTitles: readonly string[];
}

export interface AdminResearchTrace {
  readonly runId: string;
  readonly occurredAt: string;
  readonly stages: readonly AdminResearchStage[];
}

export interface AdminGenerationState {
  readonly running: boolean;
  readonly attemptCount: number;
  readonly lastError: string | null;
}

export interface AdminBriefGenerationInfo {
  readonly generation: AdminGenerationState;
  readonly research: AdminResearchTrace | null;
}

const STAGE_ORDER: readonly ResearchStageKey[] = [
  "light_discovery",
  "gap_discovery",
  "keyword_discovery",
  "deep_research",
];

export async function loadAdminBriefGenerationInfo(
  date: string,
): Promise<AdminBriefGenerationInfo> {
  const database = await openServerDatabase();
  try {
    const job = database.operations.getScheduledJob("generate", date);
    const logs = database.operations.listLogs({ briefDate: date, limit: 500 });
    return {
      generation: generationState(job),
      research: latestResearchTrace(logs),
    };
  } finally {
    database.close();
  }
}

export function latestResearchTrace(
  logs: readonly OperationalLog[],
): AdminResearchTrace | null {
  const latest = logs.find(
    (log) => log.runId !== null && (
      log.eventType === "research_stage_completed" ||
      log.eventType === "run_completed" ||
      log.eventType === "run_failed"
    ),
  );
  if (latest === undefined || latest.runId === null) return null;
  const runLogs = logs.filter(
    (log) => log.eventType === "research_stage_completed" && log.runId === latest.runId,
  );
  const stages = STAGE_ORDER.flatMap((key) => {
    const log = runLogs.find((candidate) => candidate.details.stage === key);
    return log === undefined ? [] : [parseStage(key, log.details)];
  });
  return {
    runId: latest.runId,
    occurredAt: latest.occurredAt,
    stages,
  };
}

function generationState(job: ScheduledJob | null): AdminGenerationState {
  return {
    running: job?.state === "running" && job.leaseExpiresAt !== null && job.leaseExpiresAt > new Date().toISOString(),
    attemptCount: job?.attemptCount ?? 0,
    lastError: job?.lastError ?? null,
  };
}

function parseStage(
  key: ResearchStageKey,
  details: Readonly<Record<string, JsonValue>>,
): AdminResearchStage {
  return {
    key,
    state: details.state === "skipped"
      ? "skipped"
      : details.state === "failed"
        ? "failed"
        : "completed",
    reason: stringValue(details.reason),
    foundCount: numberValue(details.foundCount ?? details.candidateCount),
    contributedCount: numberValue(details.contributedCount ?? details.selectedCount),
    rejectedCount: numberValue(details.rejectedCount),
    filteredCount: numberValue(details.filteredCount ?? details.notSelectedCount),
    topics: stringArray(details.topics),
    foundTitles: stringArray(details.foundTitles),
    contributedTitles: stringArray(details.contributedTitles ?? details.selectedTitles),
    filteredTitles: [
      ...stringArray(details.filteredTitles ?? details.notSelectedTitles),
      ...stringArray(details.rejectedTitles),
    ],
  };
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: JsonValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArray(value: JsonValue | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
