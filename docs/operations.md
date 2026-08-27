# Operations

Covers user feedback, system notifications, and logging.

> **Implementation status:** structured logs, System tickets, ticket lifecycle, and
> rate-limit storage are implemented. The public feedback form and admin inbox UI are
> still planned.

## Feedback form

A simple contact form on the site. Fields:

- **Title** — required, short, single line, character-limited.
- **Name** — optional.
- **Category** — chosen from a list.
- **Body** — limited in characters and number of lines.

Rate limit: up to **3 submissions per IP within a 12-hour window**. Counters reset on
a fixed time window, not a per-user timer.

## Admin feedback inbox

After login, the admin can open a view of all submissions, with sorting, filtering,
and a clear distinction between categories.

## System tickets

Material system failures are also recorded as an automated ticket in the **System**
category, which carries a dedicated color or marking so it stands out. Examples:

- Brief-generation failure.
- Publishing failure.
- Search-service failure.
- Any other failure needing the admin's attention.

## Logging

Each daily run records at least:

- Start and end time of the run.
- Number of sources found.
- Number of candidates that passed filtering.
- Number of developments that entered the brief.
- Whether the missing-news check found additional items.
- How many review iterations ran.
- Whether validation passed.
- Whether publishing succeeded.
- Errors that occurred.
- AI model usage cost for the run.

Outside the daily run, the log also records admin actions, login attempts, feedback
submissions, system tickets, and every publication attempt. Publication logs distinguish
start, status transition, accepted deployment trigger, overlap/no-op, and failure.

The AI cost figure depends on the provider returning usage / token counts through the
OpenAI-compatible layer, which surfaces them to the caller. Logs are stored in the
SQLite `operational_logs` table as structured JSON details plus indexed run, date,
severity, and timestamp columns.

Feedback and automated System tickets are stored in `feedback_tickets`. Categories
are `general`, `correction`, `suggestion`, and `system`; statuses are `open` and
`resolved`. Fixed-window counters live in `rate_limit_counters`, keyed by a one-way
caller hash rather than a raw IP address.

## AI usage budget

The daily model budget — number of searches, number of review loops, or a token
budget — is not fixed in the first version. It can later become an explicit system
setting.
