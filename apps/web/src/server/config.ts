import { basename, dirname, resolve } from "node:path";

export interface ServerConfig {
  readonly contentRoot: string;
  readonly databaseFile: string;
  readonly dailyStorageRoot: string;
  readonly adminPassword: string;
  readonly sessionSecret: string;
  readonly sessionTtlMs: number;
  readonly secureCookies: boolean;
  readonly loginWindowMs: number;
  readonly feedbackWindowMs: number;
  readonly trustedProxyHops: number;
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
    adminPassword: requiredAdminPassword(environment),
    sessionSecret: minimumLength(required(environment, "ADMIN_SESSION_SECRET"), 32, "ADMIN_SESSION_SECRET"),
    sessionTtlMs: hours(environment.ADMIN_SESSION_TTL_HOURS ?? "12", "ADMIN_SESSION_TTL_HOURS", 1, 168),
    secureCookies: environment.ADMIN_SECURE_COOKIES === undefined
      ? environment.NODE_ENV === "production"
      : environment.ADMIN_SECURE_COOKIES === "true",
    loginWindowMs: hours(environment.LOGIN_RATE_LIMIT_WINDOW_HOURS ?? "12", "LOGIN_RATE_LIMIT_WINDOW_HOURS", 1, 168),
    feedbackWindowMs: hours(environment.FEEDBACK_RATE_LIMIT_WINDOW_HOURS ?? "12", "FEEDBACK_RATE_LIMIT_WINDOW_HOURS", 1, 168),
    trustedProxyHops: integer(environment.TRUSTED_PROXY_HOPS ?? "0", "TRUSTED_PROXY_HOPS", 0, 10),
  };
  return config;
}

function requiredAdminPassword(environment: NodeJS.ProcessEnv): string {
  const value = environment.ADMIN_PASSWORD;
  if (value === undefined || value.length === 0) {
    throw new Error("Missing required environment variable: ADMIN_PASSWORD.");
  }
  if (Array.from(value).length < 14) {
    throw new Error("ADMIN_PASSWORD must contain at least 14 characters.");
  }
  if (Buffer.byteLength(value, "utf8") > 1_024) {
    throw new Error("ADMIN_PASSWORD must not exceed 1024 bytes.");
  }
  if (value.trim().length === 0) {
    throw new Error("ADMIN_PASSWORD cannot contain only whitespace.");
  }
  return value;
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
  return integer(value, name, minimum, maximum) * 60 * 60 * 1_000;
}

function integer(value: string, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
