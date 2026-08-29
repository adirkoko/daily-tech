import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { getServerConfig } from "./config.js";
import { openServerDatabase } from "./database.js";

export const ADMIN_COOKIE_NAME = "dt_admin";

export interface AuthenticatedAdminSession {
  readonly tokenHash: string;
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export interface NewAdminSession extends AuthenticatedAdminSession {
  readonly cookieValue: string;
}

export function verifyAdminPassword(password: string): boolean {
  if (Buffer.byteLength(password, "utf8") > 1_024) return false;
  const configuredPassword = getServerConfig().adminPassword;
  return timingSafeEqual(passwordDigest(password), passwordDigest(configuredPassword));
}

export async function createAdminSession(): Promise<NewAdminSession> {
  const config = getServerConfig();
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionTtlMs).toISOString();
  const database = await openServerDatabase();
  try {
    database.operations.purgeExpiredAdminSessions(now.toISOString());
    const session = database.operations.createAdminSession({
      tokenHash: sha256(token),
      csrfTokenHash: sha256(csrfToken),
      createdAt: now.toISOString(),
      expiresAt,
    });
    return { tokenHash: session.tokenHash, csrfToken, expiresAt, cookieValue: `${token}.${csrfToken}` };
  } finally {
    database.close();
  }
}

export async function authenticateCookie(value: string | undefined): Promise<AuthenticatedAdminSession | null> {
  if (value === undefined) return null;
  const [token, csrfToken, extra] = value.split(".");
  if (!token || !csrfToken || extra !== undefined) return null;
  const database = await openServerDatabase();
  try {
    const now = new Date().toISOString();
    const session = database.operations.getValidAdminSession(sha256(token), now);
    if (session === null || !safeEqualHex(session.csrfTokenHash, sha256(csrfToken))) return null;
    database.operations.touchAdminSession(session.tokenHash, now);
    return { tokenHash: session.tokenHash, csrfToken, expiresAt: session.expiresAt };
  } finally {
    database.close();
  }
}

export async function revokeAdminSession(session: AuthenticatedAdminSession): Promise<void> {
  const database = await openServerDatabase();
  try { database.operations.deleteAdminSession(session.tokenHash); } finally { database.close(); }
}

export function verifyCsrf(session: AuthenticatedAdminSession | null, submitted: FormDataEntryValue | null): boolean {
  return session !== null && typeof submitted === "string" && safeEqual(session.csrfToken, submitted);
}

export function callerHash(address: string): string {
  return createHmac("sha256", getServerConfig().sessionSecret).update(address).digest("hex");
}

export function fixedWindowStart(now: Date, windowMs: number): string {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs).toISOString();
}

export function cookieOptions() {
  const config = getServerConfig();
  return { httpOnly: true, secure: config.secureCookies, sameSite: "strict" as const, path: "/", maxAge: Math.floor(config.sessionTtlMs / 1_000) };
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function passwordDigest(value: string): Buffer { return createHash("sha256").update(value, "utf8").digest(); }
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex"); const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
