import type { PipelineSettings } from "@daily-tech/core";
import type { SavePipelineSettingsInput } from "@daily-tech/db";

import { openServerDatabase } from "./database.js";

export type AdminPipelineSettingsInput = Omit<SavePipelineSettingsInput, "updatedAt">;

export async function loadAdminPipelineSettings(): Promise<PipelineSettings> {
  const database = await openServerDatabase();
  try {
    return database.pipelineSettings.get();
  } finally {
    database.close();
  }
}

export async function saveAdminPipelineSettings(
  input: AdminPipelineSettingsInput,
): Promise<PipelineSettings> {
  const database = await openServerDatabase();
  try {
    const now = new Date().toISOString();
    const saved = database.pipelineSettings.save({ ...input, updatedAt: now });
    try {
      database.operations.appendLog({
        eventType: "admin_settings_saved",
        level: "info",
        message: null,
        occurredAt: now,
      });
    } catch {
      /* The settings commit remains authoritative if audit logging fails. */
    }
    return saved;
  } finally {
    database.close();
  }
}
