import { describe, expect, it } from "vitest";
import type { FeedbackTicket } from "@daily-tech/db";
import { presentAlert } from "./admin-alerts.js";

const ticket: FeedbackTicket = {
  id: 1, title: "Daily brief failed for 2026-10-22", category: "system",
  submitterName: null, status: "open", createdAt: "2026-10-23T01:00:00.000Z", resolvedAt: null,
  body: "Run: run/1?x=y\nStage: light_discovery\nError: AI web-research request was aborted or timed out.",
};
describe("alert presentation", () => {
  it("explains a timeout without claiming to know whether it was cancelled", () => {
    const view = presentAlert(ticket);
    expect(view.title).toContain("יצירת התקציר");
    expect(view.summary).toBe("הבקשה לספק ה־AI בוטלה או חרגה מזמן ההמתנה.");
    expect(view.stage).toBe("איתור חדשות");
    expect(view.briefDate).toBe("2026-10-22");
    expect(new URL(view.logsHref!, "http://localhost").searchParams.get("runId")).toBe("run/1?x=y");
  });
  it("preserves unknown historical alerts and their message", () => {
    expect(presentAlert({ ...ticket, title: "Legacy alert", body: "Original diagnostic\nsecond line" }))
      .toMatchObject({ title: "Legacy alert", summary: "Original diagnostic\nsecond line", logsHref: undefined });
  });
  it("falls back to date-filtered logs for scheduler tickets without a run ID", () => {
    const view = presentAlert({ ...ticket, title: "Scheduled publish failed for 2026-10-22", body: "Scheduler error: Disk full" });
    expect(view.title).toContain("פרסום התקציר");
    expect(view.logsHref).toBe("/admin/logs?date=2026-10-22");
    expect(view.summary).toBe("Disk full");
  });
  it("rejects invalid dates rather than constructing a broken brief link", () => {
    expect(presentAlert({ ...ticket, title: "Daily brief failed for 2026-02-30" }).briefDate).toBeUndefined();
  });
  it("falls back to date filtering when an old run ID exceeds the log filter limit", () => {
    const view = presentAlert({ ...ticket, body: `Run: ${"x".repeat(201)}\nError: Legacy failure` });
    expect(view.runId).toBeUndefined();
    expect(view.logsHref).toBe("/admin/logs?date=2026-10-22");
  });
  it("does not resolve inherited object properties as stage labels", () => {
    expect(presentAlert({ ...ticket, body: "Stage: __proto__\nError: Unknown stage" }).stage).toBe("__proto__");
  });
  it("keeps unrecognized stages visible and recognizes CRLF reporter bodies", () => {
    expect(presentAlert({ ...ticket, body: "Run: run-2\r\nPhase: disk-write\r\nError: Disk full" }))
      .toMatchObject({ runId: "run-2", stage: "disk-write", summary: "Disk full" });
  });
});
