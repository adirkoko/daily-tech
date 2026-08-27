import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { DailyTechDatabase } from "@daily-tech/db";

import { getServerConfig } from "./config.js";

export async function openServerDatabase(): Promise<DailyTechDatabase> {
  const { databaseFile } = getServerConfig();
  await mkdir(dirname(databaseFile), { recursive: true });
  return DailyTechDatabase.open({ filename: databaseFile });
}
