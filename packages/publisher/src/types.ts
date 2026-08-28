export interface PublisherClock {
  now(): Date;
}

export type PublicationOutcome = "published" | "retriggered" | "already_triggered";

export interface PublicationResult {
  readonly runId: string;
  readonly date: string;
  readonly outcome: PublicationOutcome;
  readonly publishedAt: string;
  readonly attemptCount: number;
}

export type PublicationPhase =
  | "load"
  | "acquire"
  | "validate"
  | "transition"
  | "finalize";
