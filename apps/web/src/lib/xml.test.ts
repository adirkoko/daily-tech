import { describe, expect, it } from "vitest";

import { escapeXml } from "./xml.js";

describe("XML escaping", () => {
  it("escapes feed and sitemap values", () => {
    expect(escapeXml(`<Daily & "Tech">`)).toBe("&lt;Daily &amp; &quot;Tech&quot;&gt;");
  });
});
