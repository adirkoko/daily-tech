import { describe, expect, it } from "vitest";

import { homePublicationStatus } from "./home-status.js";

describe("public home publication status", () => {
  it("hides internal generation state before publication time", () => {
    expect(homePublicationStatus({
      publicationDue: false,
      targetStatus: "failed",
      publicationState: null,
    })).toBeNull();
  });

  it("reports missing and failed publication outcomes only after publication time", () => {
    expect(homePublicationStatus({
      publicationDue: true,
      targetStatus: "ready",
      publicationState: null,
    })).toBe("pending");
    expect(homePublicationStatus({
      publicationDue: true,
      targetStatus: "ready",
      publicationState: "failed",
    })).toBe("failed");
    expect(homePublicationStatus({
      publicationDue: true,
      targetStatus: "failed",
      publicationState: null,
    })).toBe("failed");
  });

  it("never warns when the target edition is already public", () => {
    expect(homePublicationStatus({
      publicationDue: true,
      targetStatus: "published",
      publicationState: "failed",
    })).toBeNull();
  });
});
