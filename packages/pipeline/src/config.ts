import { resolve } from "node:path";

import {
  DEFAULT_RESEARCH_TIMEOUT_MS,
  DEFAULT_COMPLETION_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
} from "./ai/defaults.js";

export interface PipelineEnvironmentConfig {
  readonly aiApiKey: string;
  readonly aiModel: string;
  readonly aiBaseUrl: string;
  readonly aiResearchTimeoutMs: number;
  readonly aiCompletionTimeoutMs: number;
  readonly aiRetry: {
    readonly maxAttempts: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
  };
  readonly contentRoot: string;
  readonly dailyStorageRoot: string;
  readonly databaseFile: string;
}

export function loadPipelineEnvironment(
  environment: NodeJS.ProcessEnv,
): PipelineEnvironmentConfig {
  const contentRoot = resolve(environment.TECH_BRIEFS_ROOT ?? "tech_briefs");
  const aiRetry = {
    maxAttempts: positiveInteger(environment, "AI_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS),
    baseDelayMs: positiveInteger(environment, "AI_RETRY_BASE_DELAY_MS", DEFAULT_BASE_DELAY_MS),
    maxDelayMs: positiveInteger(environment, "AI_RETRY_MAX_DELAY_MS", DEFAULT_MAX_DELAY_MS),
  };
  if (aiRetry.maxDelayMs < aiRetry.baseDelayMs) {
    throw new RangeError("AI_RETRY_MAX_DELAY_MS must be at least AI_RETRY_BASE_DELAY_MS.");
  }
  return {
    aiResearchTimeoutMs: positiveInteger(environment, "AI_RESEARCH_TIMEOUT_MS", DEFAULT_RESEARCH_TIMEOUT_MS),
    aiCompletionTimeoutMs: positiveInteger(environment, "AI_COMPLETION_TIMEOUT_MS", DEFAULT_COMPLETION_TIMEOUT_MS),
    aiRetry,
    aiApiKey: requiredVariable(environment, "AI_API_KEY"),
    aiModel: requiredVariable(environment, "AI_MODEL"),
    aiBaseUrl: environment.AI_BASE_URL ?? "https://api.openai.com/v1",
    contentRoot,
    dailyStorageRoot: resolve(contentRoot, "daily"),
    databaseFile: resolve(contentRoot, "meta", "tech_briefs.db"),
  };
}

function requiredVariable(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }
  return value;
}

function positiveInteger(environment: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  // Node timers overflow above the signed 32-bit limit and fire almost immediately.
  if (!/^\d+$/u.test(raw.trim()) || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new RangeError(`${name} must be an integer between 1 and 2147483647.`);
  }
  return value;
}
