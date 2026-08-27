import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

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

export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (Buffer.byteLength(password, "utf8") > 1_024) return false;
  const parsed = parsePasswordHash(getServerConfig().adminPasswordHash);
  const derived = await deriveScrypt(password, parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: 256 * 1024 * 1024,
  }) as Buffer;
  return timingSafeEqual(derived, parsed.hash);
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
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex"); const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function parsePasswordHash(value: string): { N: number; r: number; p: number; salt: Buffer; hash: Buffer } {
  const [algorithm, n, r, p, salt, hash, extra] = value.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !salt || !hash || extra !== undefined) {
    throw new Error("ADMIN_PASSWORD_HASH must use the documented scrypt format.");
  }
  const parsed = { N: Number(n), r: Number(r), p: Number(p), salt: Buffer.from(salt, "base64url"), hash: Buffer.from(hash, "base64url") };
  if (!Number.isInteger(parsed.N) || parsed.N < 131_072 || parsed.r < 8 || parsed.p < 1 || parsed.salt.length < 16 || parsed.hash.length < 32) {
    throw new Error("ADMIN_PASSWORD_HASH uses insufficient scrypt parameters.");
  }
  return parsed;
}

function deriveScrypt(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) => error ? reject(error) : resolve(key));
  });
}
