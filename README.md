# Daily Tech

An automated engine that builds, over time, a curated Hebrew archive of the
developments that actually mattered in technology.

Once a day a pipeline of AI agents researches the previous day, filters noise and
duplicates, writes a short brief in Hebrew, reviews it, and runs deterministic
validation. Only after every check passes is the brief saved as a Markdown file (the
source of truth) with its metadata in SQLite, and published at a fixed hour. One
standalone Node service serves the public site, secure admin, feedback endpoint,
in-admin system alerts, and the daily generation/publication scheduler. The website
never calls an AI model at request time.

```
AI creates content  ->  code validates it  ->  SQLite + files store it  ->  the website displays it
```

## Repository structure

| Path                | Purpose |
| ------------------- | ------- |
| `apps/web/`         | Standalone Astro service: public site, secure admin, feedback, and alerts. |
| `packages/core/`    | Shared TypeScript: metadata schema, enums, deterministic validators. |
| `packages/db/`      | SQLite access layer and schema for the metadata database. |
| `packages/pipeline/`| The daily generation engine (research → filter → write → review → validate). |
| `packages/publisher/` | Safe local publication transition with an optional deployment webhook. |
| `scripts/`          | Operational scripts (e.g. reset login-attempt counters). |
| `tech_briefs/`      | Default content store: `daily/` Markdown briefs + `meta/` SQLite DB. |
| `docs/`             | Project documentation. |

## Development

- Node: version pinned in `.nvmrc`.
- Language: TypeScript across the site, the DB layer, and the pipeline.
- Package management: npm workspaces.

```sh
npm install
npm run typecheck
npm test
npm run build
npm run generate
npm run publish:brief
npm start
```

Generate an admin password hash, copy `.env.example` to `.env`, fill the secrets, and
run the single production service:

```sh
npm run admin:hash-password
npm run build
npm start
```

To build and run the same application as one containerized service:

```sh
docker compose up --build
```

For local development, keep the default `TECH_BRIEFS_ROOT` or point it at another
content store. Set `ADMIN_SECURE_COOKIES=false` only while using local HTTP, then run:

```sh
npm run dev --workspace @daily-tech/web
```

Public pages read SQLite and Markdown on demand, so a saved or published admin change
is visible immediately without another deployment. A missing database produces a
valid first-run state; an inconsistent published artifact fails closed instead of
rendering partial content. Set `SITE_URL` to the production origin for canonical URLs.

## Status

Early implementation stage. `packages/core` provides the metadata contract and full
artifact validation. `packages/db` now provides transactional migrations and typed
SQLite persistence for daily metadata, including normalized company, topic, and
development tables. `packages/pipeline` provides the tested orchestration foundation,
Israel-time windows, bounded editorial revision loop, failure boundaries, and an
OpenAI-compatible client. Production prompts, Brave Search, compensating Markdown +
SQLite persistence, operational logging, and System-ticket failure reporting are now
wired. `packages/publisher` revalidates ready artifacts, coordinates concurrent
publication attempts through SQLite leases, and transitions metadata atomically;
external deployment hooks are optional. `apps/web` provides the Hebrew RTL site,
password-protected admin editor, server-side sessions, CSRF protection, public
feedback form, feedback inbox, and system-alert view. The remaining release work is
production hosting and TLS configuration; the in-process scheduler, health checks,
trusted-proxy handling, and one-service container are implemented.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — components and dependency direction.
- [`docs/data-model.md`](docs/data-model.md) — file layout, brief structure, SQLite schema.
- [`docs/pipeline.md`](docs/pipeline.md) — how the daily brief is generated.
- [`docs/website.md`](docs/website.md) — pages, states, calendar, statistics, branding, mobile.
- [`docs/admin.md`](docs/admin.md) — admin area and security.
- [`docs/operations.md`](docs/operations.md) — feedback, system notifications, logging.
- [`docs/deployment.md`](docs/deployment.md) — build, publishing, and hosting.
- [`docs/decisions.md`](docs/decisions.md) — choices that shape the project, with reasoning.
- [`docs/roadmap.md`](docs/roadmap.md) — first-version scope, deferred work, priorities, success metrics.
