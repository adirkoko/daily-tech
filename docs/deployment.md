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

The equivalent one-command container launch is:

```sh
docker compose up --build
```

`compose.yaml` contains exactly one application service. Its named `/data` volume is
the live persistent content store; no backup workflow is included. Compose enables
the scheduler by default; set `DAILY_TECH_SCHEDULER_ENABLED=false` only when a manual
run is intentionally required.

`npm start` reads `.env` and starts `apps/web/dist/server/entry.mjs`. Put an HTTPS
reverse proxy or load balancer in front of it. The server binds to the runtime's
standard address defaults. The `TECH_BRIEFS_ROOT` directory must be a private persistent volume;
both its Markdown files and `meta/tech_briefs.db` must survive releases and restarts.

## Required server configuration

- `ADMIN_PASSWORD_HASH` — generated with `npm run admin:hash-password`.
- `ADMIN_SESSION_SECRET` — unique random value of at least 32 characters.
- `ADMIN_SECURE_COOKIES=true` — keep enabled in every HTTPS deployment.
- `SITE_URL` — the public HTTPS origin used for canonical URLs.
- `TECH_BRIEFS_ROOT` — persistent content/database path; defaults to `tech_briefs`.
- `TRUSTED_PROXY_HOPS` — `0` without a proxy; otherwise the exact number of trusted
  reverse proxies in front of Node. Forwarding headers are ignored when it is `0`.

Session TTL and login/feedback fixed-window durations have safe defaults documented
in `.env.example`. The Node server caps request bodies at 300 KiB.

## Embedded generation and publication schedule

Set `SCHEDULER_ENABLED=true` to run generation and publication inside the same Node
process. Defaults are `01:00` and `07:00` Israel time. A durable SQLite job lease
prevents duplicate work after restarts or overlapping instances. A failed daily job
is recorded once and stays visible in Admin rather than retrying AI calls repeatedly.

The same operations remain available as manual recovery commands:

```sh
npm run generate
npm run publish:brief
```

The generation job requires `AI_API_KEY`, `AI_MODEL`, and `AI_BASE_URL` from
`.env.example`. The provider must expose both chat completions for writing and a
Responses-compatible live web-research endpoint that returns machine-readable source
citations.
The publisher targets the previous Israel calendar day unless `--date=YYYY-MM-DD` is
provided. It acquires a SQLite lease, revalidates the ready artifact, atomically moves
it to `published`, and finalizes the publication job locally. The running site sees
the change immediately; publication has no external deployment trigger.

Failures are written to structured logs and create a `system` ticket visible at
`/admin/alerts`. There are deliberately no email, Telegram, or Slack dependencies.

## Health checks

- `GET /health` is a lightweight process liveness check.
- `GET /ready` verifies SQLite access and the current schema, and reports whether the
  embedded scheduler is enabled.

Both endpoints return JSON and disable response caching. Docker uses `/health`; Compose
uses the stronger `/ready` check.

## Production checklist

1. Terminate TLS and redirect HTTP to HTTPS.
2. Use a non-root process account and expose only the web port.
3. Mount one private persistent volume for `TECH_BRIEFS_ROOT`.
4. Keep `.env` outside version control and rotate the session secret after exposure.
5. Enable the embedded scheduler when automatic daily runs are wanted.
6. Monitor process health and disk capacity; inspect application failures inside the
   Admin alert center.

Provider-specific TLS and domain configuration remain deployment work; the
application-level single-service container is implemented.
