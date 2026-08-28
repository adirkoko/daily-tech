import { resolve } from "node:path";

export interface PipelineEnvironmentConfig {
  readonly aiApiKey: string;
  readonly aiModel: string;
  readonly aiBaseUrl: string;
  readonly contentRoot: string;
  readonly dailyStorageRoot: string;
  readonly databaseFile: string;
  readonly maxRevisionRounds: number;
}

export function loadPipelineEnvironment(
  environment: NodeJS.ProcessEnv,
): PipelineEnvironmentConfig {
  const contentRoot = resolve(environment.TECH_BRIEFS_ROOT ?? "tech_briefs");
  const maxRevisionRounds = Number(environment.PIPELINE_MAX_REVISION_ROUNDS ?? "3");
  if (
    !Number.isInteger(maxRevisionRounds) ||
    maxRevisionRounds < 1 ||
    maxRevisionRounds > 3
  ) {
    throw new RangeError("PIPELINE_MAX_REVISION_ROUNDS must be 1, 2, or 3.");
  }
  return {
    aiApiKey: requiredVariable(environment, "AI_API_KEY"),
    aiModel: requiredVariable(environment, "AI_MODEL"),
    aiBaseUrl: environment.AI_BASE_URL ?? "https://api.openai.com/v1",
    contentRoot,
    dailyStorageRoot: resolve(contentRoot, "daily"),
    databaseFile: resolve(contentRoot, "meta", "tech_briefs.db"),
    maxRevisionRounds,
  };
}

function requiredVariable(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }
  return value;
}
