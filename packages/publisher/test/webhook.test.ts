import { describe, expect, it, vi } from "vitest";

import { DeploymentTriggerError, WebhookDeploymentTrigger } from "../src/index.js";

const context = {
  runId: "publish-run-1",
  date: "2026-08-27",
  publishedAt: "2026-08-28T04:00:00.000Z",
};

describe("deployment webhook", () => {
  it("posts a bounded event payload and returns the provider request id", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { "x-deployment-id": "deploy-42" },
      }),
    );
    const trigger = new WebhookDeploymentTrigger({
      url: "https://deploy.example/hook",
      token: "top-secret",
      fetchImplementation,
    });

    await expect(trigger.trigger(context)).resolves.toEqual({ requestId: "deploy-42" });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [, request] = fetchImplementation.mock.calls[0] ?? [];
    expect(request).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer top-secret",
      },
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      event: "brief.published",
      ...context,
    });
  });

  it("turns non-success responses into typed errors with bounded details", async () => {
    const trigger = new WebhookDeploymentTrigger({
      url: "https://deploy.example/hook",
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("provider unavailable", { status: 503 }),
      ),
    });

    await expect(trigger.trigger(context)).rejects.toMatchObject({
      name: "DeploymentTriggerError",
      status: 503,
    } satisfies Partial<DeploymentTriggerError>);
  });
});
