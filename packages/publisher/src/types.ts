export interface PublisherClock {
  now(): Date;
}

export interface DeploymentContext {
  readonly runId: string;
  readonly date: string;
  readonly publishedAt: string;
}

export interface DeploymentReceipt {
  readonly requestId: string | null;
}

export interface DeploymentTrigger {
  trigger(context: DeploymentContext): Promise<DeploymentReceipt>;
}

export type PublicationOutcome = "published" | "retriggered" | "already_triggered";

export interface PublicationResult {
  readonly runId: string;
  readonly date: string;
  readonly outcome: PublicationOutcome;
  readonly publishedAt: string;
  readonly deploymentRequestId: string | null;
  readonly attemptCount: number;
}

export type PublicationPhase =
  | "load"
  | "acquire"
  | "validate"
  | "transition"
  | "deploy"
  | "finalize";
