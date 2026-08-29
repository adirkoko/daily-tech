import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyAdminPassword } from "./auth.js";
import { getServerConfig } from "./config.js";

const configuredPassword = "a strong admin password 2026";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin password configuration", () => {
  it("preserves and verifies the configured password exactly", () => {
    vi.stubEnv("ADMIN_PASSWORD", configuredPassword);
    vi.stubEnv("ADMIN_SESSION_SECRET", "test-session-secret-at-least-32-characters");

    expect(verifyAdminPassword(configuredPassword)).toBe(true);
    expect(verifyAdminPassword("a strong admin password 2027")).toBe(false);
    expect(verifyAdminPassword(` ${configuredPassword}`)).toBe(false);
  });

  it("rejects oversized login input before comparison", () => {
    vi.stubEnv("ADMIN_PASSWORD", configuredPassword);
    vi.stubEnv("ADMIN_SESSION_SECRET", "test-session-secret-at-least-32-characters");

    expect(verifyAdminPassword("x".repeat(1_025))).toBe(false);
  });

  it("requires a non-empty password of at least 14 characters", () => {
    const baseEnvironment = {
      ADMIN_SESSION_SECRET: "test-session-secret-at-least-32-characters",
    } satisfies NodeJS.ProcessEnv;

    expect(() => getServerConfig(baseEnvironment)).toThrow(
      "Missing required environment variable: ADMIN_PASSWORD.",
    );
    expect(() => getServerConfig({ ...baseEnvironment, ADMIN_PASSWORD: "too-short" })).toThrow(
      "ADMIN_PASSWORD must contain at least 14 characters.",
    );
    expect(() => getServerConfig({ ...baseEnvironment, ADMIN_PASSWORD: " ".repeat(14) })).toThrow(
      "ADMIN_PASSWORD cannot contain only whitespace.",
    );
  });

  it("rejects a configured password larger than the accepted login boundary", () => {
    expect(() =>
      getServerConfig({
        ADMIN_PASSWORD: "🙂".repeat(300),
        ADMIN_SESSION_SECRET: "test-session-secret-at-least-32-characters",
      }),
    ).toThrow("ADMIN_PASSWORD must not exceed 1024 bytes.");
  });
});
