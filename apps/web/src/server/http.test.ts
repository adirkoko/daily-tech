import { describe, expect, it } from "vitest";

import { resolveClientAddress } from "./http.js";

describe("client address resolution", () => {
  it("ignores forwarding headers unless a proxy is explicitly trusted", () => {
    expect(resolveClientAddress("10.0.0.8", "203.0.113.10", 0)).toBe("10.0.0.8");
  });

  it("selects the caller before the configured number of trusted proxies", () => {
    expect(resolveClientAddress("10.0.0.8", "203.0.113.10", 1)).toBe("203.0.113.10");
    expect(resolveClientAddress("10.0.0.8", "203.0.113.10, 10.0.0.7", 2)).toBe("203.0.113.10");
  });

  it("falls back to the direct peer for malformed or incomplete chains", () => {
    expect(resolveClientAddress("10.0.0.8", "spoofed", 1)).toBe("10.0.0.8");
    expect(resolveClientAddress("10.0.0.8", "203.0.113.10", 2)).toBe("10.0.0.8");
  });
});
