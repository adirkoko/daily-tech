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
the scheduler by default. Set the Compose input
`DAILY_TECH_SCHEDULER_ENABLED=false` to disable it; this is passed to the application
as `SCHEDULER_ENABLED`.

`npm start` reads `.env` and starts `apps/web/dist/server/entry.mjs`. Put an HTTPS
reverse proxy or load balancer in front of it. The server binds to the runtime's
standard address defaults. The `TECH_BRIEFS_ROOT` directory must be a private
persistent volume; both its Markdown files and `meta/tech_briefs.db` must survive
releases and restarts.

## Server configuration

Required by the application:

- `ADMIN_PASSWORD` — a unique password of at least 14 characters, stored only in the
  server environment and never committed to source control.
- `ADMIN_SESSION_SECRET` — unique random value of at least 32 characters.

Set explicitly for production:

- `ADMIN_SECURE_COOKIES=true` — keep enabled in every HTTPS deployment.
- `SITE_URL` — the exact public HTTP(S) origin, without credentials, a path, query,
  or fragment. It is used at build time for canonical URLs and Astro's validated
  reverse-proxy origin reconstruction. Compose passes it into the image build;
  changing it requires rebuilding the image, not only restarting the container.
- `TECH_BRIEFS_ROOT` — persistent content/database path; defaults to `tech_briefs`.
- `TRUSTED_PROXY_HOPS` — `0` without a proxy; otherwise the exact number of trusted
  reverse proxies represented in `X-Forwarded-For`. This setting controls caller-IP
  resolution for rate limiting; it is separate from host/protocol validation.

Optional performance setting:

- `SITE_SNAPSHOT_CACHE_TTL_SECONDS` — positive integer lifetime for the process-local
  SQLite metadata snapshot; defaults to `10`. Writes performed inside the running
  service invalidate it immediately. Keep the TTL short when manual CLI tools or
  another process can modify the same content store.

Session TTL and login/feedback fixed-window durations have safe defaults documented
in `.env.example`. The Node server caps request bodies at 300 KiB.

`ALLOW_DESTRUCTIVE_DEMO_DATA_RESET` belongs only to the development CLI. It defaults
to `false`, is not required by the application runtime, and must remain false or
unset in production. Even when it is explicitly set to `true`, the demo-data
commands still refuse to run without `--confirm-reset`.

## Reverse proxy and origin validation

Astro's origin check remains enabled. The build derives one exact
`security.allowedDomains` entry from `SITE_URL`; only matching forwarded host and
protocol values are trusted when reconstructing the request URL. This lets form POSTs
arriving through a TLS-terminating proxy pass same-origin checks without accepting an
arbitrary `X-Forwarded-Host`.

The final reverse proxy in front of the container must overwrite, rather than append
or pass through, the public-origin headers. For an HTTPS-only Nginx Proxy Manager host:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Port 443;
```

The forced HTTPS values are appropriate when Cloudflare terminates public TLS but
connects to Nginx Proxy Manager over an internal HTTP hop. Deployments that expose a
different public scheme or port must send values matching `SITE_URL`. Do not disable
`security.checkOrigin`; Admin mutations still add their session-bound CSRF token on
top of Astro's framework-level origin check.

## Embedded generation and publication schedule

Set `SCHEDULER_ENABLED=true` to run generation and publication inside the same Node
process. Generate and publish times are managed in `/admin/settings`, defaulting to
`01:00` and `07:00` in `Asia/Jerusalem`; changes take effect without restarting the
service. A durable SQLite job lease prevents duplicate work after restarts or
overlapping instances. A failed daily job is recorded once and remains visible in
Admin rather than being retried on every scheduler tick.

The same operations remain available as manual recovery commands:

```sh
npm run generate
npm run publish:brief
```

The generation job requires `AI_API_KEY` and `AI_MODEL`. `AI_BASE_URL` is optional and
defaults to `https://api.openai.com/v1`. A different provider must expose both chat
completions for writing and a Responses-compatible live web-research endpoint that
returns machine-readable source citations.
The publisher targets the previous Israel calendar day unless `--date=YYYY-MM-DD` is
provided. It acquires a SQLite lease, revalidates the ready artifact, atomically moves
it to `published`, and finalizes the publication job locally. Embedded publication
invalidates the site's metadata snapshot immediately; a manual command running in a
separate process becomes visible within the configured snapshot TTL. Publication has
no external deployment trigger.

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
4. Set the exact public `SITE_URL`, configure the final proxy to overwrite the
   forwarded host/protocol headers, and rebuild the image.
5. Keep `.env` outside version control with access restricted to the service account;
   rotate both the Admin password and session secret after exposure.
6. Enable the embedded scheduler when automatic daily runs are wanted.
7. Monitor process health and disk capacity; inspect application failures inside the
   Admin alert center.

Provider-specific TLS and domain configuration remain deployment work; the
application-level single-service container is implemented.
