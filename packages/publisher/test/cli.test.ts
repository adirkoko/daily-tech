import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DailyTechDatabase } from "@daily-tech/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runPublisherCli } from "../src/cli.js";
import { readyMetadata, writeBrief } from "./fixtures.js";

let temporaryRoot: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (temporaryRoot !== undefined) {
    await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  }
});

describe("publisher CLI", () => {
  it("publishes the previous Israel day without AI environment variables", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "daily-tech-publisher-cli-"));
    const databasePath = join(temporaryRoot, "meta", "tech_briefs.db");
    await mkdir(join(temporaryRoot, "meta"), { recursive: true });
    const database = DailyTechDatabase.open({ filename: databasePath });
    database.saveDay(readyMetadata());
    database.close();
    await writeBrief(join(temporaryRoot, "daily"));

    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runPublisherCli(
      {
        TECH_BRIEFS_ROOT: temporaryRoot,
      },
      ["--run-at=2026-08-28T04:00:00.000Z"],
    );

    const verificationDatabase = DailyTechDatabase.open({ filename: databasePath });
    expect(verificationDatabase.getDay("2026-08-27")).toMatchObject({
      status: "published",
      published_at: expect.any(String),
    });
    verificationDatabase.close();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
