# Admin & Security

## Login

The login page is `/admin/login`. Authentication is by **password only**, with no
username. Set a unique password of at least 14 characters in the server-side
`ADMIN_PASSWORD` environment variable.

`ADMIN_PASSWORD` is intentionally a plaintext deployment secret. Keep `.env` out of
source control, restrict filesystem access to the service account, and never place
the password in command arguments, logs, screenshots, or client-side configuration.

## Content management

The dashboard lists the latest briefs and their status, intensity, and item count.
An editor can change the Markdown and all editable metadata. Every brief page offers:

1. **Delete** — remove the Markdown and metadata record together. The day becomes an
   unavailable calendar day.
2. **Copy** — copy the complete Markdown source.
3. **Save** — validate and persist Markdown plus metadata and update `updated_at`.

Save runs the same deterministic artifact validation used by the pipeline. Filesystem
changes use a temporary file and short-lived rollback copy so a database failure does not leave
half-written content. Administrative save, delete, login, and feedback-resolution
actions are recorded in the operational log.

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
`ADMIN_SECURE_COOKIES=true`, use a unique high-entropy
`ADMIN_PASSWORD`, use a unique high-entropy `ADMIN_SESSION_SECRET` of at least 32
characters, and keep the content/SQLite path on
a private persistent volume. `npm run rate-limits:reset -- --scope=admin_login` clears login counters when
the operator deliberately needs to recover access.
