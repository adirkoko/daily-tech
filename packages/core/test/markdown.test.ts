import { describe, expect, it } from "vitest";

import {
  inspectMarkdownStructure,
  validateMarkdownLinks,
} from "../src/index.js";
import { validMarkdown } from "./fixtures.js";

describe("Markdown inspection", () => {
  it("counts numbered headings as significant items and level-three items under Worth watching", () => {
    expect(inspectMarkdownStructure(validMarkdown)).toEqual({
      significantSectionPresent: true,
      significantItems: 2,
      worthWatchingSectionPresent: true,
      worthWatchingItems: 1,
    });
  });

  it("does not treat an unnumbered heading as a significant item", () => {
    const structure = inspectMarkdownStructure("## תמצית היום\n\nטקסט.\n\n## שורה תחתונה\n\nטקסט.");
    expect(structure.significantItems).toBe(0);
    expect(structure.significantSectionPresent).toBe(false);
  });

  it("does not count headings from unrelated sections", () => {
    const markdown = `${validMarkdown}\n## מקורות נוספים\n### הערת מערכת`;
    expect(inspectMarkdownStructure(markdown).worthWatchingItems).toBe(1);
  });

  it("supports a configurable Worth watching heading", () => {
    const structure = inspectMarkdownStructure("## 1. Main\n### Ignored\n## Watch\n### Two", {
      worthWatching: ["Watch"],
    });
    expect(structure.significantItems).toBe(1);
    expect(structure.worthWatchingItems).toBe(1);
  });

  it("finds empty Markdown link destinations with line numbers", () => {
    const issues = validateMarkdownLinks("תקין [מקור](https://example.com)\nשבור [מקור]()");
    expect(issues).toEqual([
      expect.objectContaining({ code: "empty_link", path: "content:2" }),
    ]);
  });
});
