import { basename, dirname, resolve } from "node:path";

export interface ServerConfig {
  readonly contentRoot: string;
  readonly databaseFile: string;
  readonly dailyStorageRoot: string;
  readonly adminPasswordHash: string;
  readonly sessionSecret: string;
  readonly sessionTtlMs: number;
  readonly secureCookies: boolean;
  readonly loginWindowMs: number;
  readonly feedbackWindowMs: number;
}

export function getServerConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const cwd = process.cwd();
  const repositoryRoot = basename(cwd) === "web" && basename(dirname(cwd)) === "apps"
    ? resolve(cwd, "../..")
    : cwd;
  const contentRoot = resolve(repositoryRoot, environment.TECH_BRIEFS_ROOT ?? "tech_briefs");
  const config: ServerConfig = {
    contentRoot,
    databaseFile: resolve(contentRoot, "meta", "tech_briefs.db"),
    dailyStorageRoot: resolve(contentRoot, "daily"),
    adminPasswordHash: required(environment, "ADMIN_PASSWORD_HASH"),
    sessionSecret: minimumLength(required(environment, "ADMIN_SESSION_SECRET"), 32, "ADMIN_SESSION_SECRET"),
    sessionTtlMs: hours(environment.ADMIN_SESSION_TTL_HOURS ?? "12", "ADMIN_SESSION_TTL_HOURS", 1, 168),
    secureCookies: environment.ADMIN_SECURE_COOKIES === undefined
      ? environment.NODE_ENV === "production"
      : environment.ADMIN_SECURE_COOKIES === "true",
    loginWindowMs: hours(environment.LOGIN_RATE_LIMIT_WINDOW_HOURS ?? "12", "LOGIN_RATE_LIMIT_WINDOW_HOURS", 1, 168),
    feedbackWindowMs: hours(environment.FEEDBACK_RATE_LIMIT_WINDOW_HOURS ?? "12", "FEEDBACK_RATE_LIMIT_WINDOW_HOURS", 1, 168),
  };
  return config;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}.`);
  return value;
}

function minimumLength(value: string, length: number, name: string): string {
  if (value.length < length) throw new Error(`${name} must contain at least ${length} characters.`);
  return value;
}

function hours(value: string, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed * 60 * 60 * 1_000;
}
