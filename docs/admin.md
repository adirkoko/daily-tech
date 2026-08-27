# Admin & Security

> **Implementation status:** implemented. The admin UI, authentication, server-side
> sessions, editing actions, feedback inbox, and system alerts run in `apps/web`.

## Login

The login page is `/admin/login`. Authentication is by **password only**, with no
username. Run `npm run admin:hash-password` and place the result in
`ADMIN_PASSWORD_HASH`; the plaintext password is never stored in configuration.

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

- Password verification uses scrypt with `N=131072`, `r=8`, `p=1`, a random salt,
  and constant-time comparison.
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
- The password hash, session secret, and other secrets remain server-side and are
  never rendered to the browser.

Production must terminate HTTPS before the service, keep
`ADMIN_SECURE_COOKIES=true`, use a unique high-entropy
`ADMIN_SESSION_SECRET` of at least 32 characters, and keep the content/SQLite path on
a private persistent volume. `npm run rate-limits:reset -- --scope=admin_login` clears login counters when
the operator deliberately needs to recover access.
