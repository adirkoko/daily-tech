# Operations

Covers user feedback, system notifications, and logging.

> **Implementation status:** implemented end to end. Structured logs, public feedback,
> the admin inbox, System alerts, ticket resolution, and rate limiting share SQLite.

## Feedback form

A simple contact form on the site. Fields:

- **Title** — required, short, single line, character-limited.
- **Name** — optional.
- **Category** — chosen from a list.
- **Body** — limited in characters and number of lines.

Rate limit: up to **3 submissions per IP within a 12-hour window**. Counters reset on
a fixed time window, not a per-user timer.

## Admin feedback inbox

After login, `/admin/feedback` lists reader submissions and lets the operator mark an
open ticket resolved. `/admin/alerts` separately highlights System tickets and recent
error-level operational logs.

## System tickets

Material system failures are also recorded as an automated ticket in the **System**
category, which carries a dedicated color or marking so it stands out. Examples:

- Brief-generation failure.
- Publishing failure.
- Web-research provider failure.
- Any other failure needing the admin's attention.

The Admin alert center is the only notification channel in this architecture. There
is no email, Telegram, Slack, or other outbound incident-notification dependency.

## Logging

Each daily run records at least:

- Start and end time of the run.
- Number of cited research sources.
- Number of stories accepted or rejected by evidence validation.
- Number of developments that entered the brief.
- Whether the gap check found a significant missing story.
- How many revision rounds ran.
- Whether validation passed.
- Whether publishing succeeded.
- Errors that occurred.
- AI model usage cost for the run.

Outside the daily run, the log also records admin actions, login attempts, feedback
submissions, system tickets, and every publication attempt. Publication logs distinguish
start, status transition, local completion, overlap/no-op, and failure.
The embedded scheduler additionally records claimed, completed, and failed generation
and publication jobs. Its durable terminal state prevents repeated execution after a
restart.

The AI cost figure depends on the provider returning usage / token counts through the
OpenAI-compatible layer, which surfaces them to the caller. Logs are stored in the
SQLite `operational_logs` table as structured JSON details plus indexed run, date,
severity, and timestamp columns.

Feedback and automated System tickets are stored in `feedback_tickets`. Categories
are `general`, `correction`, `suggestion`, and `system`; statuses are `open` and
`resolved`. Fixed-window counters live in `rate_limit_counters`, keyed by a one-way
caller hash rather than a raw IP address.

## AI usage budget

The daily model budget — web tool calls, model requests, revision rounds, or a token
budget — is not fixed in the first version. It can later become an explicit system
setting. An ordinary non-empty run uses one Research request, one Draft request, and
one Gap Check request. Quiet days skip Draft; each justified revision adds one
Revision request and one new Gap Check.
