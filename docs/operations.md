# Operations

Covers user feedback, system notifications, and logging.

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
submissions, and system tickets.

The AI cost figure depends on the provider returning usage / token counts through the
OpenAI-compatible layer, which surfaces them to the caller. Where log records are
stored — a table in the SQLite database or structured files under `logs/` — is not
decided; `logs/` is ignored by git either way.

## AI usage budget

The daily model budget — number of searches, number of review loops, or a token
budget — is not fixed in the first version. It can later become an explicit system
setting.
