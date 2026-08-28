import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  expectedBriefRelativePath,
  type BriefArtifact,
  type DayMetadata,
} from "@daily-tech/core";

import type { PipelineLogEvent } from "./types.js";

export interface SmokeExportPaths {
  readonly markdownPath: string;
  readonly yamlPath: string;
}

export async function exportSmokeArtifacts(
  artifact: BriefArtifact,
  events: readonly PipelineLogEvent[],
  outputRoot: string,
): Promise<SmokeExportPaths> {
  const relativeMarkdownPath = expectedBriefRelativePath(artifact.metadata.date);
  if (relativeMarkdownPath === null) {
    throw new TypeError(`Cannot create a smoke output path for ${artifact.metadata.date}.`);
  }

  const resolvedRoot = resolve(outputRoot);
  const markdownPath = join(
    resolvedRoot,
    "daily",
    ...relativeMarkdownPath.split("/"),
  );
  const yamlPath = join(
    resolvedRoot,
    "meta",
    `${artifact.metadata.date}-database-write.yaml`,
  );
  const yaml = databaseWriteYaml(artifact.metadata, events);

  await Promise.all([
    mkdir(dirname(markdownPath), { recursive: true }),
    mkdir(dirname(yamlPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(markdownPath, artifact.content, { encoding: "utf8" }),
    writeFile(yamlPath, yaml, { encoding: "utf8" }),
  ]);

  return { markdownPath, yamlPath };
}

export function databaseWriteYaml(
  metadata: DayMetadata,
  events: readonly PipelineLogEvent[],
): string {
  const document = {
    daily_briefs: {
      date: metadata.date,
      summary: metadata.summary,
      significant_items: metadata.significant_items,
      worth_watching_items: metadata.worth_watching_items,
      day_intensity: metadata.day_intensity,
      status: metadata.status,
      source_count: metadata.source_count,
      created_at: metadata.created_at,
      published_at: metadata.published_at,
      updated_at: metadata.updated_at,
    },
    daily_brief_companies: positionedRows(
      metadata.date,
      "company",
      metadata.companies,
    ),
    daily_brief_topics: positionedRows(metadata.date, "topic", metadata.topics),
    daily_brief_developments: positionedRows(
      metadata.date,
      "digest",
      metadata.developments,
    ),
    operational_logs: events.map((event) => ({
      run_id: event.runId,
      brief_date: event.date,
      event_type: event.type,
      level: event.type === "run_failed" ? "error" : "info",
      message:
        typeof event.details?.message === "string" ? event.details.message : null,
      details_json: JSON.stringify(event.details ?? {}),
      occurred_at: event.occurredAt,
    })),
  };

  return [
    "# Database rows the production pipeline would write for this successful run.",
    "# SQLite-generated primary keys are omitted because this smoke test never opens a database.",
    renderYaml(document),
    "",
  ].join("\n");
}

function positionedRows(
  date: string,
  valueName: "company" | "topic" | "digest",
  values: readonly string[],
): readonly Readonly<Record<string, string | number>>[] {
  return values.map((value, position) => ({
    day_date: date,
    position,
    [valueName]: value,
  }));
}

function renderYaml(value: unknown): string {
  if (!isRecord(value)) throw new TypeError("YAML document root must be an object.");
  return renderObject(value, 0).join("\n");
}

function renderObject(value: Readonly<Record<string, unknown>>, depth: number): string[] {
  const lines: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    const indentation = "  ".repeat(depth);
    if (isScalar(item)) {
      lines.push(`${indentation}${key}: ${renderScalar(item)}`);
    } else if (Array.isArray(item)) {
      if (item.length === 0) lines.push(`${indentation}${key}: []`);
      else {
        lines.push(`${indentation}${key}:`);
        lines.push(...renderArray(item, depth + 1));
      }
    } else if (isRecord(item)) {
      const entries = Object.keys(item);
      if (entries.length === 0) lines.push(`${indentation}${key}: {}`);
      else {
        lines.push(`${indentation}${key}:`);
        lines.push(...renderObject(item, depth + 1));
      }
    } else {
      throw new TypeError(`Unsupported YAML value at ${key}.`);
    }
  }
  return lines;
}

function renderArray(value: readonly unknown[], depth: number): string[] {
  const indentation = "  ".repeat(depth);
  const lines: string[] = [];
  for (const item of value) {
    if (isScalar(item)) {
      lines.push(`${indentation}- ${renderScalar(item)}`);
    } else if (isRecord(item)) {
      const entries = Object.entries(item);
      if (entries.length === 0) lines.push(`${indentation}- {}`);
      else {
        const [first, ...rest] = entries;
        if (first === undefined) throw new Error("Unexpected empty YAML object.");
        const [firstKey, firstValue] = first;
        if (!isScalar(firstValue)) {
          lines.push(`${indentation}-`);
          lines.push(...renderObject(item, depth + 1));
          continue;
        }
        lines.push(`${indentation}- ${firstKey}: ${renderScalar(firstValue)}`);
        lines.push(...renderObject(Object.fromEntries(rest), depth + 1));
      }
    } else {
      throw new TypeError("YAML arrays may contain only scalars or objects.");
    }
  }
  return lines;
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean";
}

function renderScalar(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("YAML output cannot contain non-finite numbers.");
  }
  return String(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
