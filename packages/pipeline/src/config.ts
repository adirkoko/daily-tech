import { resolve } from "node:path";

export interface PipelineEnvironmentConfig {
  readonly aiApiKey: string;
  readonly aiModel: string;
  readonly aiBaseUrl: string;
  readonly contentRoot: string;
  readonly dailyStorageRoot: string;
  readonly databaseFile: string;
}

export function loadPipelineEnvironment(
  environment: NodeJS.ProcessEnv,
): PipelineEnvironmentConfig {
  const contentRoot = resolve(environment.TECH_BRIEFS_ROOT ?? "tech_briefs");
  return {
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
