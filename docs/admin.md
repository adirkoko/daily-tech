# Admin & Security

## Login

The login page is `/admin/login`. Authentication is by **password only**, with no
username. Set a unique password of at least 14 characters in the server-side
`ADMIN_PASSWORD` environment variable.

`ADMIN_PASSWORD` is intentionally a plaintext deployment secret. Keep `.env` out of
source control, restrict filesystem access to the service account, and never place
the password in command arguments, logs, screenshots, or client-side configuration.

## Content management

The dashboard includes briefs in every lifecycle status and links each populated day
to `/admin/briefs/<date>`. Day colour retains the public intensity scale, while a
separate indicator shows editorial status (`draft`, `ready`, `published`, or
`failed`). Summary counts and a short list of recent unpublished briefs provide
direct routes into work that still needs attention. The editor can change the
Markdown and all editable metadata.

The editor provides:

- **Edit / preview** — switch between the Markdown source and a server-rendered
  preview. Preview uses the same Markdown parser, sanitizer, and hardened-link rules
  as the public daily page; it does not save or publish the draft.
- **Structured metadata controls** — counts, lifecycle status, intensity, and
  add/remove fields for companies, topics, and development summaries.
- **Copy** — copy the complete Markdown source, with visible success feedback.
- **Save** — validate and persist Markdown plus metadata and update `updated_at`.
- **Delete** — after an explicit confirmation, remove the Markdown and metadata
  record together. The day becomes unavailable in both calendars.

Preview and every state-changing editor request remain protected by the Admin
session, same-origin checks, and the session CSRF token. Repeated metadata inputs are
bounded and normalized on the server rather than trusted as client-side arrays.

Save runs the same deterministic artifact validation used by the pipeline. Filesystem
changes use a temporary file and a short-lived rollback copy, preventing a database
failure from leaving partially written content. Administrative save, delete, login,
and feedback-resolution actions are recorded in the operational log.

## Pipeline settings

`/admin/settings` manages the operator-facing generation settings:

- **Admin keywords** — up to 50 companies, products, technologies, or topics that
  receive an additional focused discovery pass. Each value is limited to 60
  characters. Keywords affect attention, not eligibility; an empty list skips the
  call.
- **Maximum stories** — the maximum number of dossiers Deep Research may return
  (`1–20`). It is a ceiling, not a target.
- **Discovery toggles** — independently enable the general gap pass and the focused
  keyword pass.
- **Editorial instructions** — optional guidance about emphasis. It cannot override
  sourcing, confirmation, or research-date rules.
- **Generate and publish times** — the daily schedule in `Asia/Jerusalem`.

The settings are stored as one validated SQLite row. Generation reads the row at the
start of each run, while the scheduler reads the two times on every tick so schedule
changes do not require a restart. Saving records an `admin_settings_saved` event.
Secrets, provider configuration, storage paths, cache settings, and safety limits
remain deployment or implementation concerns rather than Admin settings. See
[`pipeline.md`](pipeline.md) and [`data-model.md`](data-model.md#pipeline-settings).

## Feedback and alert inboxes

`/admin/feedback` and `/admin/alerts` share a compact inbox interface. Client-side
search covers titles, bodies, and displayed metadata; the lists also support
domain-specific filters, chronological sorting, pagination, expandable details, and
resolving open tickets. The feedback inbox filters by status and category. The alert
center combines System tickets with recent error-level operational logs and can
filter by item type and ticket status. Timestamps are shown in Israel time while
remaining stored as UTC.

## Security controls

- Password verification hashes both the submitted and configured values to
  fixed-length SHA-256 digests and compares those digests with a constant-time
  primitive. The password is never written to logs or returned in an error.
- Sessions use random opaque tokens stored only as SHA-256 digests in SQLite. The
  browser cookie is `HttpOnly`, `SameSite=Strict`, path-scoped to `/`, and `Secure`
  in production. Sessions expire after the configured TTL; logout revokes them.
- Every state-changing admin form requires an exact same-origin request and a random,
  session-bound CSRF token.
- Admin responses use `Cache-Control: no-store`. Middleware also applies anti-framing,
  MIME-sniffing, referrer, and browser-permission headers.
- Login is limited to three attempts per caller in the configured fixed window.
  Raw caller IPs are not stored; rate-limit keys are HMAC digests.
- Forwarded caller addresses are trusted only when `TRUSTED_PROXY_HOPS` explicitly
  matches the reverse-proxy chain; the default ignores forwarding headers.
- Form fields and request bodies are bounded. The Node adapter rejects bodies above
  300 KiB.
- The Admin password, session secret, and other secrets remain server-side and are
  never rendered to the browser.

Production must terminate HTTPS before the service, keep
`ADMIN_SECURE_COOKIES=true`, use unique high-entropy values for `ADMIN_PASSWORD` and
`ADMIN_SESSION_SECRET`, and keep the content store on a private persistent volume.
`npm run rate-limits:reset -- --scope=admin_login` clears login counters when the
operator deliberately needs to recover access.
