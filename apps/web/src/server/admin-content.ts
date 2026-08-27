import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { expectedBriefRelativePath, validateBriefArtifact, type BriefStatus, type DayIntensity, type DayMetadata, type ValidationIssue } from "@daily-tech/core";

import { getServerConfig } from "./config.js";
import { openServerDatabase } from "./database.js";

export interface AdminBriefInput {
  readonly date: string;
  readonly markdown: string;
  readonly summary: string;
  readonly significantItems: number;
  readonly worthWatchingItems: number;
  readonly dayIntensity: DayIntensity;
  readonly companies: readonly string[];
  readonly topics: readonly string[];
  readonly developments: readonly string[];
  readonly status: BriefStatus;
  readonly sourceCount: number;
}

export class AdminContentValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "AdminContentValidationError";
  }
}

export async function loadAdminBrief(date: string): Promise<{ metadata: DayMetadata; markdown: string } | null> {
  const database = await openServerDatabase();
  try {
    const metadata = database.getDay(date);
    if (metadata === null) return null;
    return { metadata, markdown: await readFile(filePath(date), "utf8") };
  } finally { database.close(); }
}

export async function saveAdminBrief(input: AdminBriefInput): Promise<DayMetadata> {
  const database = await openServerDatabase();
  let existing: DayMetadata | null;
  try { existing = database.getDay(input.date); }
  catch (error) { database.close(); throw error; }
  if (existing === null) { database.close(); throw new Error(`Brief ${input.date} does not exist.`); }
  const now = new Date().toISOString();
  const metadata: DayMetadata = {
    date: input.date,
    summary: input.summary,
    significant_items: input.significantItems,
    worth_watching_items: input.worthWatchingItems,
    day_intensity: input.dayIntensity,
    companies: input.companies,
    topics: input.topics,
    developments: input.developments,
    status: input.status,
    source_count: input.sourceCount,
    created_at: existing.created_at,
    published_at: input.status === "published" ? existing.published_at ?? now : null,
    updated_at: now,
  };
  const path = filePath(input.date);
  const validation = validateBriefArtifact({ filePath: path, content: input.markdown, metadata });
  if (!validation.valid) { database.close(); throw new AdminContentValidationError(validation.issues); }

  const temporary = `${path}.${randomUUID()}.tmp`;
  const backup = `${path}.${randomUUID()}.bak`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, input.markdown, "utf8");
  let backedUp = false;
  let committed = false;
  try {
    await rename(path, backup); backedUp = true;
    await rename(temporary, path);
    const saved = database.saveDay(metadata);
    committed = true;
    try {
      database.operations.appendLog({ briefDate: input.date, eventType: "admin_brief_saved", level: "info", message: null, details: { status: saved.status }, occurredAt: now });
    } catch { /* The content commit remains authoritative if audit logging fails. */ }
    await rm(backup, { force: true }).catch(() => undefined);
    return saved;
  } catch (error) {
    if (!committed) {
      await rm(path, { force: true }).catch(() => undefined);
      if (backedUp) await rename(backup, path).catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
    database.close();
  }
}

export async function deleteAdminBrief(date: string): Promise<boolean> {
  const database = await openServerDatabase();
  const path = filePath(date);
  const backup = `${path}.${randomUUID()}.delete`;
  try {
    if (database.getDay(date) === null) return false;
    await rename(path, backup);
    let committed = false;
    try {
      if (!database.deleteDay(date)) throw new Error(`Brief ${date} disappeared during deletion.`);
      committed = true;
      try {
        database.operations.appendLog({ briefDate: date, eventType: "admin_brief_deleted", level: "warning", message: null, occurredAt: new Date().toISOString() });
      } catch { /* Deletion remains authoritative if audit logging fails. */ }
      await rm(backup, { force: true }).catch(() => undefined);
      return true;
    } catch (error) {
      if (!committed) await rename(backup, path).catch(() => undefined);
      throw error;
    }
  } finally { database.close(); }
}

function filePath(date: string): string {
  const relative = expectedBriefRelativePath(date);
  if (relative === null) throw new TypeError("Invalid brief date.");
  return join(getServerConfig().dailyStorageRoot, ...relative.split("/"));
}

export function stringList(value: string): readonly string[] {
  return [...new Set(value.split(/\r?\n|,/u).map((item) => item.trim()).filter(Boolean))];
}
