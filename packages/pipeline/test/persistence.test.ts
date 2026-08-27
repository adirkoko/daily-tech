import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DailyTechDatabase } from "@daily-tech/db";

import {
  ArtifactPersistenceError,
  FileSystemDatabaseArtifactSink,
} from "../src/index.js";
import { validArtifact } from "./fixtures.js";

const relativePath = join(
  "2026",
  "august",
  "2026-08-27",
  "2026-08-27-tech_briefs.md",
);

describe("FileSystemDatabaseArtifactSink", () => {
  let storageRoot: string;
  let database: DailyTechDatabase;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "daily-tech-sink-"));
    database = DailyTechDatabase.open({ filename: ":memory:" });
  });

  afterEach(async () => {
    database.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("writes Markdown and metadata as one logical operation", async () => {
    const sink = new FileSystemDatabaseArtifactSink({
      storageRoot,
      metadataStore: database,
    });

    await sink.saveReady(validArtifact);

    expect(await readFile(join(storageRoot, relativePath), "utf8")).toBe(
      validArtifact.content,
    );
    expect(database.getDay("2026-08-27")).toEqual(validArtifact.metadata);
  });

  it("removes a newly installed file when the database write fails", async () => {
    const sink = new FileSystemDatabaseArtifactSink({
      storageRoot,
      metadataStore: {
        saveDay: vi.fn(() => {
          throw new Error("database unavailable");
        }),
      },
    });

    await expect(sink.saveReady(validArtifact)).rejects.toMatchObject({
      name: "ArtifactPersistenceError",
      phase: "database",
      rollbackError: undefined,
    });
    await expect(readFile(join(storageRoot, relativePath), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("restores the previous file when replacement metadata fails", async () => {
    const targetPath = join(storageRoot, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "previous brief", "utf8");
    const sink = new FileSystemDatabaseArtifactSink({
      storageRoot,
      metadataStore: {
        saveDay: vi.fn(() => {
          throw new Error("database unavailable");
        }),
      },
    });

    await expect(sink.saveReady(validArtifact)).rejects.toBeInstanceOf(
      ArtifactPersistenceError,
    );

    expect(await readFile(targetPath, "utf8")).toBe("previous brief");
    expect((await readdir(dirname(targetPath))).sort()).toEqual([
      "2026-08-27-tech_briefs.md",
    ]);
  });

  it("rejects non-ready artifacts before touching storage", async () => {
    const sink = new FileSystemDatabaseArtifactSink({
      storageRoot,
      metadataStore: database,
    });

    await expect(
      sink.saveReady({
        ...validArtifact,
        metadata: { ...validArtifact.metadata, status: "published" },
      }),
    ).rejects.toMatchObject({ phase: "validation" });
    expect(await readdir(storageRoot)).toEqual([]);
  });
});
