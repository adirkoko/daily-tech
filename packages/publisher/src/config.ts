import { resolve } from "node:path";

export interface PublisherEnvironmentConfig {
  readonly contentRoot: string;
  readonly dailyStorageRoot: string;
  readonly databaseFile: string;
  readonly webhookUrl: string;
  readonly webhookToken: string | null;
  readonly webhookTimeoutMs: number;
  readonly leaseDurationMs: number;
}

export function loadPublisherEnvironment(
  environment: NodeJS.ProcessEnv,
): PublisherEnvironmentConfig {
  const contentRoot = resolve(environment.TECH_BRIEFS_ROOT ?? "tech_briefs");
  const webhookUrl = requiredVariable(environment, "PUBLISH_WEBHOOK_URL");
  assertHttpUrl(webhookUrl);
  return {
    contentRoot,
    dailyStorageRoot: resolve(contentRoot, "daily"),
    databaseFile: resolve(contentRoot, "meta", "tech_briefs.db"),
    webhookUrl,
    webhookToken: optionalVariable(environment, "PUBLISH_WEBHOOK_TOKEN"),
    webhookTimeoutMs: integerVariable(
      environment,
      "PUBLISH_WEBHOOK_TIMEOUT_MS",
      30_000,
      1_000,
      120_000,
    ),
    leaseDurationMs: integerVariable(
      environment,
      "PUBLISH_LEASE_DURATION_MS",
      600_000,
      60_000,
      3_600_000,
    ),
  };
}

function requiredVariable(environment: NodeJS.ProcessEnv, name: string): string {
  const value = optionalVariable(environment, name);
  if (value === null) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }
  return value;
}

function optionalVariable(environment: NodeJS.ProcessEnv, name: string): string | null {
  const value = environment[name]?.trim();
  return value === undefined || value.length === 0 ? null : value;
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

function assertHttpUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new TypeError("PUBLISH_WEBHOOK_URL must be a valid URL.", { cause: error });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError("PUBLISH_WEBHOOK_URL must use http or https.");
  }
}
