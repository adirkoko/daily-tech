# Deployment

## One-service runtime

The production runtime is one Astro standalone Node service. It serves the public
site, Admin, feedback API/inbox, and system alerts from the same process and content
store. It is not compatible with a static-only host.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm start
```

`npm start` reads `.env` and starts `apps/web/dist/server/entry.mjs`. Put an HTTPS
reverse proxy or load balancer in front of it and forward traffic to the configured
`HOST`/`PORT`. The `TECH_BRIEFS_ROOT` directory must be a private persistent volume;
both its Markdown files and `meta/tech_briefs.db` must survive releases and restarts.

## Required server configuration

- `ADMIN_PASSWORD_HASH` — generated with `npm run admin:hash-password`.
- `ADMIN_SESSION_SECRET` — unique random value of at least 32 characters.
- `ADMIN_SECURE_COOKIES=true` — keep enabled in every HTTPS deployment.
- `SITE_URL` — the public HTTPS origin used for canonical URLs.
- `TECH_BRIEFS_ROOT` — persistent content/database path; defaults to `tech_briefs`.

Session TTL and login/feedback fixed-window durations have safe defaults documented
in `.env.example`. The Node server caps request bodies at 300 KiB.

## Generation and publication jobs

Generation and publication are scheduled commands against the same persistent store,
not additional HTTP services:

```sh
npm run generate
npm run publish:brief
```

The generation job requires the AI and search variables listed in `.env.example`.
The publisher targets the previous Israel calendar day unless `--date=YYYY-MM-DD` is
provided. It acquires a SQLite lease, revalidates the ready artifact, atomically moves
it to `published`, and finalizes the publication job. The running site sees the change
immediately, so `PUBLISH_WEBHOOK_URL` is optional. If supplied, the existing bounded
webhook integration runs after the status transition for external cache/build needs.

Failures are written to structured logs and create a `system` ticket visible at
`/admin/alerts`. There are deliberately no email, Telegram, or Slack dependencies.

## Production checklist

1. Terminate TLS and redirect HTTP to HTTPS.
2. Use a non-root process account and expose only the web port.
3. Mount one private persistent volume for `TECH_BRIEFS_ROOT`.
4. Back up Markdown and SQLite together, and periodically test restore.
5. Keep `.env` outside version control and rotate the session secret after exposure.
6. Schedule generation and publication in Israel-time-aware jobs while retaining UTC
   timestamps internally.
7. Monitor process health and disk capacity; inspect application failures inside the
   Admin alert center.

Container packaging and provider-specific infrastructure remain deployment work; the
application-level single-service boundary is already implemented.
