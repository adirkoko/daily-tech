# Operations

## Feedback

The public feedback form accepts:

- A required title limited to 50 characters and exactly one line.
- An optional name limited to 24 characters and exactly one line.
- A category.
- A body limited to 1,500 characters and 20 lines.

Submissions are limited to three per caller within a 12-hour fixed window. The window
duration is configurable. Rate-limit keys use a one-way caller hash; raw IP addresses
are not stored.

`/admin/feedback` presents submissions in a searchable, filterable, sortable inbox
with expandable details and lets the operator resolve open tickets. Ticket categories
are `general`, `correction`, `suggestion`, and `system`; statuses are `open` and
`resolved`.

## System alerts

Material generation, publication, scheduler, or provider failures create a `system`
ticket. `/admin/alerts` combines those tickets with recent error-level operational
logs in the same inbox interface. Operators can separate tickets from logs, filter
ticket status, inspect structured details, and resolve open System tickets.

Admin is the only incident-notification channel. The application has no email,
Telegram, Slack, webhook, or other outbound alert integration.

## Provider reliability

Each AI request retries HTTP 429/5xx responses and malformed provider envelopes such
as missing output text, web-search calls, or machine-readable citations. The default
is three attempts with exponential backoff and jitter; a valid `Retry-After` header
takes precedence.

Other 4xx responses and downstream validation failures are not retried. After the
client exhausts its attempts, the run fails, creates a System ticket, and remains a
terminal scheduler job. An operator can retry that date from its Admin brief page;
the explicit action safely reopens the finished generation job without changing the
scheduler's normal once-per-day behavior.

## Logging

Each generation run records one terminal event:

- `run_completed` with the final status and accepted-research source count.
- `run_failed` with the failing stage and error message; the same failure also creates
  a System ticket.

In addition, it records bounded `research_stage_completed` summaries for the three
discovery passes and Deep Research. They contain contribution/filter counts and
short title/topic lists for Admin visibility. Deep Research also records bounded
exclusion reasons for candidates it investigated but did not select. These events do
not contain complete prompts, model responses, source contents, or secrets. The
pipeline does not maintain local token/cost accounting; provider usage remains
available through the provider's own reporting.

Operational logs also cover Admin actions, login attempts, feedback handling,
publication attempts, and scheduler claims/completions/failures. Publication events
distinguish successful transitions, no-ops caused by an existing publication or
active lease, and failures.

Logs are stored in `operational_logs` as structured JSON details with indexed run,
date, severity, and timestamp fields. Feedback and System tickets live in
`feedback_tickets`; fixed-window counters live in `rate_limit_counters`.

Admin retry/regeneration also records start, completion, or failure events. It uses
the same `scheduled_jobs` generation lease as the embedded scheduler, preventing two
service instances or repeated clicks from generating one date concurrently. Manual
save and delete requests are refused while that lease is active. Regeneration is
replace-on-success, so a provider or validation failure creates an alert without
overwriting the existing brief or changing its status.

When **Retry** repairs a day after its scheduled publication job has already failed,
Admin explicitly reopens only that failed `publish` job and invokes the same local
publisher used by the scheduler. Publication validation, publication leases, and
failure tickets therefore remain unchanged; successful generation alone never marks
a day as published.

For pipeline-specific failure diagnostics, see
[`pipeline.md`](pipeline.md#failures-and-diagnostics).
