import { DeploymentTriggerError } from "./errors.js";
import type {
  DeploymentContext,
  DeploymentReceipt,
  DeploymentTrigger,
} from "./types.js";

export interface WebhookDeploymentTriggerOptions {
  readonly url: string;
  readonly token?: string | null;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

export class WebhookDeploymentTrigger implements DeploymentTrigger {
  readonly #url: string;
  readonly #token: string | null;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: WebhookDeploymentTriggerOptions) {
    this.#url = options.url;
    this.#token = options.token ?? null;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async trigger(context: DeploymentContext): Promise<DeploymentReceipt> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.#token !== null) {
      headers.Authorization = `Bearer ${this.#token}`;
    }

    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          event: "brief.published",
          runId: context.runId,
          date: context.date,
          publishedAt: context.publishedAt,
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new DeploymentTriggerError("Deployment webhook request failed.", { cause: error });
    }

    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 500);
      throw new DeploymentTriggerError(
        `Deployment webhook returned HTTP ${response.status}${responseBody ? `: ${responseBody}` : "."}`,
        { status: response.status },
      );
    }
    return {
      requestId:
        response.headers.get("x-request-id") ??
        response.headers.get("x-deployment-id") ??
        null,
    };
  }
}
