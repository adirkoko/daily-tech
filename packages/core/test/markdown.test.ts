import { describe, expect, it } from "vitest";

import {
  inspectMarkdownStructure,
  validateMarkdownLinks,
} from "../src/index.js";
import { validMarkdown } from "./fixtures.js";

describe("Markdown inspection", () => {
  it("counts level-three items inside the two content sections", () => {
    expect(inspectMarkdownStructure(validMarkdown)).toEqual({
      significantSectionPresent: true,
      significantItems: 2,
      worthWatchingSectionPresent: true,
      worthWatchingItems: 1,
    });
  });

  it("does not count headings from unrelated sections", () => {
    const markdown = `${validMarkdown}\n## מקורות נוספים\n### הערת מערכת`;
    expect(inspectMarkdownStructure(markdown).worthWatchingItems).toBe(1);
  });

  it("supports configurable section headings", () => {
    const structure = inspectMarkdownStructure("## Main\n### One\n## Watch\n### Two", {
      significant: ["Main"],
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
