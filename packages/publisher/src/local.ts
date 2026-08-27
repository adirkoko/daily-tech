import type { DeploymentContext, DeploymentReceipt, DeploymentTrigger } from "./types.js";

/**
 * Completes publication without an external deployment service. The standalone
 * Astro server reads SQLite and Markdown on demand, so the status transition is
 * immediately visible to readers.
 */
export class LocalDeploymentTrigger implements DeploymentTrigger {
  async trigger(_context: DeploymentContext): Promise<DeploymentReceipt> {
    return { requestId: null };
  }
}
