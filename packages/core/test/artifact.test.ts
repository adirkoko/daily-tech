import { describe, expect, it } from "vitest";

import { validateBriefArtifact } from "../src/index.js";
import { validMarkdown, validMetadata } from "./fixtures.js";

const validPath =
  "C:\\content\\daily\\2026\\august\\2026-08-27\\2026-08-27-tech_briefs.md";

describe("validateBriefArtifact", () => {
  it("accepts a complete artifact and returns decoded content", () => {
    const content = new TextEncoder().encode(validMarkdown);
    const result = validateBriefArtifact({
      filePath: validPath,
      content,
      metadata: validMetadata,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.content).toBe(validMarkdown);
      expect(result.data.metadata).toBe(validMetadata);
    }
  });

  it("accepts a quiet-day brief without item sections", () => {
    const result = validateBriefArtifact({
      filePath: validPath,
      content: "# Daily Tech — 27 באוגוסט 2026\n\nהיום היה שקט.",
      metadata: {
        ...validMetadata,
        summary: "היום היה שקט.",
        significant_items: 0,
        worth_watching_items: 0,
        day_intensity: "minimal",
        companies: [],
        topics: [],
        developments: [],
        source_count: 0,
      },
    });

    expect(result.valid).toBe(true);
  });

  it("rejects invalid UTF-8 bytes", () => {
    const result = validateBriefArtifact({
      filePath: validPath,
      content: new Uint8Array([0xc3, 0x28]),
      metadata: validMetadata,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: "invalid_utf8", path: "content" }),
      );
    }
  });

  it("cross-checks path, filename date, metadata date, and item counts", () => {
    const result = validateBriefArtifact({
      filePath:
        "tech_briefs/daily/2026/august/2026-08-28/2026-08-28-tech_briefs.md",
      content: validMarkdown.replace("## 2. כלי הפיתוח קיבל עדכון", "כלי הפיתוח קיבל עדכון"),
      metadata: validMetadata,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "invalid_file_path" }),
          expect.objectContaining({ code: "date_mismatch" }),
          expect.objectContaining({ code: "item_count_mismatch" }),
        ]),
      );
    }
  });

  it("requires sections when metadata declares items", () => {
    const result = validateBriefArtifact({
      filePath: validPath,
      content: "# Daily Tech\n\nתקציר ללא אזורי תוכן.",
      metadata: validMetadata,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.filter(({ code }) => code === "missing_section")).toHaveLength(2);
    }
  });

  it("rejects empty content and invalid filenames", () => {
    const result = validateBriefArtifact({
      filePath: "tech_briefs/daily/today.md",
      content: "  \n",
      metadata: validMetadata,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "invalid_file_name" }),
          expect.objectContaining({ code: "invalid_file_path" }),
          expect.objectContaining({ code: "empty_content" }),
        ]),
      );
    }
  });
});
