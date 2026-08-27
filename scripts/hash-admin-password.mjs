#!/usr/bin/env node
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";

const scrypt = promisify(scryptCallback);
const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const password = process.env.ADMIN_PASSWORD ?? await terminal.question("Admin password: ");
  if (Buffer.byteLength(password, "utf8") < 14) throw new Error("Use an admin password of at least 14 bytes.");
  if (Buffer.byteLength(password, "utf8") > 1_024) throw new Error("Admin password is too long.");
  const N = 131_072; const r = 8; const p = 1; const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 });
  process.stdout.write(`scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${hash.toString("base64url")}\n`);
} finally { terminal.close(); }
