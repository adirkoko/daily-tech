# Operations

## Feedback

The public feedback form accepts:

- A required, length-limited title.
- An optional name.
- A category.
- A body limited by characters and lines.

Submissions are limited to three per caller within a 12-hour fixed window. The window
duration is configurable. Rate-limit keys use a one-way caller hash; raw IP addresses
are not stored.

`/admin/feedback` lists submissions and lets the operator resolve open tickets.
Ticket categories are `general`, `correction`, `suggestion`, and `system`; statuses
are `open` and `resolved`.

## System alerts

Material generation, publication, scheduler, or provider failures create a `system`
ticket. `/admin/alerts` combines those tickets with recent error-level operational
logs.

Admin is the only incident-notification channel. The application has no email,
Telegram, Slack, webhook, or other outbound alert integration.

## Logging

Each generation run records one terminal event:

- `run_completed` with the final status and accepted-research source count.
- `run_failed` with the failing stage and error message; the same failure also creates
  a System ticket.

The pipeline does not write per-stage events or maintain local token/cost accounting.
Provider usage remains available through the provider's own reporting.

Operational logs also cover Admin actions, login attempts, feedback handling,
publication attempts, and scheduler claims/completions/failures. Publication events
distinguish successful transitions, no-ops caused by an existing publication or
active lease, and failures.

Logs are stored in `operational_logs` as structured JSON details with indexed run,
date, severity, and timestamp fields. Feedback and System tickets live in
`feedback_tickets`; fixed-window counters live in `rate_limit_counters`.

For pipeline-specific failure diagnostics, see
[`pipeline.md`](pipeline.md#failures-and-diagnostics).
