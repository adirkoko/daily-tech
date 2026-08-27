import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  expectedBriefRelativePath,
  validateBriefArtifact,
  type BriefArtifact,
  type DayMetadata,
} from "@daily-tech/core";

import type { ArtifactSink } from "./types.js";

export interface DayMetadataStore {
  saveDay(metadata: unknown): DayMetadata;
}

export interface FileSystemDatabaseSinkOptions {
  readonly storageRoot: string;
  readonly metadataStore: DayMetadataStore;
}

export type PersistencePhase = "validation" | "filesystem" | "database";

export class ArtifactPersistenceError extends Error {
  readonly phase: PersistencePhase;
  readonly rollbackError: unknown;

  constructor(
    phase: PersistencePhase,
    message: string,
    cause: unknown,
    rollbackError?: unknown,
  ) {
    super(message, { cause });
    this.name = "ArtifactPersistenceError";
    this.phase = phase;
    this.rollbackError = rollbackError;
  }
}

/**
 * Persists Markdown (the source of truth) and its SQLite metadata as one logical
 * operation. SQLite is written only after the new file is in place. If the database
 * write fails, the prior file is restored (or the new file is removed).
 */
export class FileSystemDatabaseArtifactSink implements ArtifactSink {
  readonly #storageRoot: string;
  readonly #metadataStore: DayMetadataStore;

  constructor(options: FileSystemDatabaseSinkOptions) {
    if (options.storageRoot.trim().length === 0) {
      throw new TypeError("storageRoot cannot be empty.");
    }
    this.#storageRoot = resolve(options.storageRoot);
    this.#metadataStore = options.metadataStore;
  }

  async saveReady(artifact: BriefArtifact): Promise<void> {
    const validation = validateBriefArtifact(artifact);
    if (!validation.valid || artifact.metadata.status !== "ready") {
      throw new ArtifactPersistenceError(
        "validation",
        "The sink accepts only valid artifacts with ready status.",
        validation.valid ? new Error("Artifact status is not ready.") : validation.issues,
      );
    }

    const relativePath = expectedBriefRelativePath(artifact.metadata.date);
    if (relativePath === null) {
      throw new ArtifactPersistenceError(
        "validation",
        "Artifact date cannot be mapped to a storage path.",
        new Error(`Invalid date: ${artifact.metadata.date}`),
      );
    }

    const targetPath = join(this.#storageRoot, ...relativePath.split("/"));
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    const backupPath = `${targetPath}.${randomUUID()}.bak`;
    let backupCreated = false;
    let targetInstalled = false;

    try {
      await mkdir(dirname(targetPath), { recursive: true });
      const handle = await open(temporaryPath, "wx");
      try {
        await handle.writeFile(artifact.content, { encoding: "utf8" });
        await handle.sync();
      } finally {
        await handle.close();
      }

      if (await fileExists(targetPath)) {
        await rename(targetPath, backupPath);
        backupCreated = true;
      }
      await rename(temporaryPath, targetPath);
      targetInstalled = true;
    } catch (error) {
      const rollbackError = await rollbackFile(
        targetPath,
        backupPath,
        targetInstalled,
        backupCreated,
      );
      await removeIfExists(temporaryPath).catch(() => undefined);
      throw new ArtifactPersistenceError(
        "filesystem",
        "Failed to install the Markdown artifact.",
        error,
        rollbackError,
      );
    }

    try {
      this.#metadataStore.saveDay(artifact.metadata);
    } catch (error) {
      const rollbackError = await rollbackFile(
        targetPath,
        backupPath,
        targetInstalled,
        backupCreated,
      );
      throw new ArtifactPersistenceError(
        "database",
        "Metadata write failed; the Markdown change was rolled back.",
        error,
        rollbackError,
      );
    }

    if (backupCreated) {
      await removeIfExists(backupPath).catch(() => undefined);
    }
  }
}

async function rollbackFile(
  targetPath: string,
  backupPath: string,
  targetInstalled: boolean,
  backupCreated: boolean,
): Promise<unknown> {
  try {
    if (targetInstalled) {
      await removeIfExists(targetPath);
    }
    if (backupCreated) {
      await rename(backupPath, targetPath);
    }
    return undefined;
  } catch (error) {
    return error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, { encoding: "utf8" });
    return true;
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isFileSystemError(error, "ENOENT")) {
      throw error;
    }
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
