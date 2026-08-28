import { resolve } from "node:path";

export interface PublisherEnvironmentConfig {
  readonly contentRoot: string;
  readonly dailyStorageRoot: string;
  readonly databaseFile: string;
  readonly leaseDurationMs: number;
}

export function loadPublisherEnvironment(
  environment: NodeJS.ProcessEnv,
): PublisherEnvironmentConfig {
  const contentRoot = resolve(environment.TECH_BRIEFS_ROOT ?? "tech_briefs");
  return {
    contentRoot,
    dailyStorageRoot: resolve(contentRoot, "daily"),
    databaseFile: resolve(contentRoot, "meta", "tech_briefs.db"),
    leaseDurationMs: integerVariable(
      environment,
      "PUBLISH_LEASE_DURATION_MS",
      600_000,
      60_000,
      3_600_000,
    ),
  };
}

function integerVariable(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
