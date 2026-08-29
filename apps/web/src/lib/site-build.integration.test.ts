import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expectedBriefRelativePath, type DayMetadata } from "@daily-tech/core";
import { DailyTechDatabase } from "@daily-tech/db";
import { afterEach, describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const temporaryRoots: string[] = [];
const adminPassword = "Daily-Tech-Test-Password-2026!";
const adminPasswordHash = "scrypt$131072$8$1$VCny8iCknm6szLH47Fkr7Q$_wY48D9I4pFxDSA2m23MBDifYg1EpUANpvYxNTcZKSg";

function runWebBuild(contentRoot: string): Promise<void> {
  const astroCli = join(webRoot, "..", "..", "node_modules", "astro", "bin", "astro.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [astroCli, "build"], {
      cwd: webRoot,
      env: {
        ...process.env,
        ASTRO_TELEMETRY_DISABLED: "1",
        SITE_URL: "https://daily-tech.example",
        TECH_BRIEFS_ROOT: contentRoot,
      },
      stdio: "pipe",
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Astro fixture build exited with ${code}.\n${output}`));
    });
  });
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) server.close(() => resolve(address.port));
      else reject(new Error("Could not allocate a test port."));
    });
  });
}

async function fetchWhenReady(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { return await fetch(url); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("standalone site service", () => {
  it("serves public content, feedback, alerts, and the protected admin workflow", async () => {
    const contentRoot = await mkdtemp(join(tmpdir(), "daily-tech-site-build-"));
    temporaryRoots.push(contentRoot);
    const databasePath = join(contentRoot, "meta", "tech_briefs.db");
    await mkdir(dirname(databasePath), { recursive: true });

    const day: DayMetadata = {
      date: "2026-08-26",
      summary: "מהדורת אינטגרציה בטוחה",
      significant_items: 1,
      worth_watching_items: 0,
      day_intensity: "medium",
      companies: ["Example"],
      topics: ["בדיקות"],
      developments: ["פיתוח שנבדק"],
      status: "published",
      source_count: 3,
      created_at: "2026-08-26T04:00:00.000Z",
      published_at: "2026-08-27T04:00:00.000Z",
      updated_at: null,
    };
    const database = DailyTechDatabase.open({ filename: databasePath });
    database.saveDay(day);
    database.operations.createTicket({
      title: "Fixture system failure",
      category: "system",
      body: "The integration fixture recorded a failure.",
      createdAt: "2026-08-27T05:00:00.000Z",
    });
    database.close();

    const relativePath = expectedBriefRelativePath(day.date);
    if (relativePath === null) throw new Error("Expected a valid fixture date.");
    const markdownPath = join(contentRoot, "daily", ...relativePath.split("/"));
    await mkdir(dirname(markdownPath), { recursive: true });
    await writeFile(
      markdownPath,
      "# מהדורה\n\n## מה באמת חשוב\n\n[מקור](https://example.com)\n\n<script>alert('bad')</script>",
      "utf8",
    );

    await runWebBuild(contentRoot);

    const port = await availablePort();
    const server = spawn(process.execPath, [join(webRoot, "dist", "server", "entry.mjs")], {
      cwd: webRoot,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        TECH_BRIEFS_ROOT: contentRoot,
        ADMIN_PASSWORD_HASH: adminPasswordHash,
        ADMIN_SESSION_SECRET: "integration-session-secret-32-characters-minimum",
        ADMIN_SECURE_COOKIES: "false",
      },
      stdio: "pipe",
    });
    try {
      const origin = `http://127.0.0.1:${port}`;
      const health = await fetchWhenReady(`${origin}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual({ status: "ok" });
      const ready = await fetch(`${origin}/ready`);
      expect(ready.status).toBe(200);
      await expect(ready.json()).resolves.toMatchObject({
        status: "ready",
        database: "ready",
        scheduler: "disabled",
      });
      const dailyHtml = await (await fetchWhenReady(`${origin}/daily/${day.date}`)).text();
      const monthHtml = await (await fetch(`${origin}/calendar/2026-08`)).text();
      expect(dailyHtml).toContain("מהדורת אינטגרציה בטוחה");
      expect(dailyHtml).toContain("noopener noreferrer");
      expect(dailyHtml).not.toContain("alert('bad')");
      expect(monthHtml).toContain(`/daily/${day.date}`);
      expect(monthHtml).toContain('data-level="medium"');

      const anonymousAdmin = await fetch(`${origin}/admin`, { redirect: "manual" });
      expect(anonymousAdmin.status).toBe(303);
      expect(anonymousAdmin.headers.get("location")).toBe("/admin/login");

      const feedback = await fetch(`${origin}/api/feedback`, {
        method: "POST",
        redirect: "manual",
        headers: { Origin: origin },
        body: new URLSearchParams({
          title: "Integration feedback",
          name: "Test reader",
          category: "correction",
          body: "Please review this integration item.",
        }),
      });
      expect(feedback.status).toBe(303);

      const login = await fetch(`${origin}/api/admin/login`, {
        method: "POST",
        redirect: "manual",
        headers: { Origin: origin },
        body: new URLSearchParams({ password: adminPassword }),
      });
      expect(login.status).toBe(303);
      expect(login.headers.get("location")).toBe("/admin");
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toMatch(/^dt_admin=/u);
      expect(login.headers.get("set-cookie")).toContain("HttpOnly");
      expect(login.headers.get("set-cookie")).toContain("SameSite=Strict");

      const adminHeaders = { Cookie: cookie ?? "" };
      const dashboard = await fetch(`${origin}/admin`, { headers: adminHeaders });
      const dashboardHtml = await dashboard.text();
      expect(dashboard.status).toBe(200);
      expect(dashboard.headers.get("cache-control")).toBe("no-store");
      expect(dashboardHtml).toContain(`/admin/briefs/${day.date}`);

      const feedbackHtml = await (await fetch(`${origin}/admin/feedback`, { headers: adminHeaders })).text();
      expect(feedbackHtml).toContain("Integration feedback");
      const alertsHtml = await (await fetch(`${origin}/admin/alerts`, { headers: adminHeaders })).text();
      expect(alertsHtml).toContain("Fixture system failure");

      const editorHtml = await (await fetch(`${origin}/admin/briefs/${day.date}`, { headers: adminHeaders })).text();
      const csrf = /name="csrf_token" value="([^"]+)"/u.exec(editorHtml)?.[1];
      expect(csrf).toBeTruthy();
      const rejectedEdit = await fetch(`${origin}/api/admin/briefs/${day.date}`, {
        method: "POST",
        redirect: "manual",
        headers: { ...adminHeaders, Origin: origin },
        body: new URLSearchParams({ csrf_token: "invalid" }),
      });
      expect(rejectedEdit.status).toBe(403);

      const updatedMarkdown = "# Updated brief\n\n## 1. Updated integration item\n\n[Source](https://example.com/updated)";
      const savedEdit = await fetch(`${origin}/api/admin/briefs/${day.date}`, {
        method: "POST",
        redirect: "manual",
        headers: { ...adminHeaders, Origin: origin },
        body: new URLSearchParams({
          csrf_token: csrf ?? "",
          action: "save",
          markdown: updatedMarkdown,
          summary: "Updated safely through the admin service.",
          significant_items: "1",
          worth_watching_items: "0",
          source_count: "3",
          day_intensity: "high",
          status: "published",
          companies: "Example",
          topics: "Integration",
          developments: "Updated integration item",
        }),
      });
      expect(savedEdit.status).toBe(303);
      const updatedPublicHtml = await (await fetch(`${origin}/daily/${day.date}`)).text();
      expect(updatedPublicHtml).toContain("Updated integration item");
      expect(updatedPublicHtml).toContain("Updated safely through the admin service.");

      const deleted = await fetch(`${origin}/api/admin/briefs/${day.date}`, {
        method: "POST",
        redirect: "manual",
        headers: { ...adminHeaders, Origin: origin },
        body: new URLSearchParams({ csrf_token: csrf ?? "", action: "delete" }),
      });
      expect(deleted.status).toBe(303);
      expect(deleted.headers.get("location")).toBe("/admin");
      const deletedPublicPage = await fetch(`${origin}/daily/${day.date}`, { redirect: "manual" });
      expect(deletedPublicPage.status).toBe(302);
      expect(deletedPublicPage.headers.get("location")).toBe("/404");
    } finally { server.kill(); }
  }, 45_000);
});
