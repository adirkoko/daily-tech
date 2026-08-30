# Daily Tech

An automated engine that builds, over time, a curated Hebrew archive of the
developments that actually mattered in technology.

Once a day, a web-enabled model researches the previous Israel calendar day and
returns cited, deduplicated stories. Deterministic code validates their source and
event-date evidence, a constrained writer turns only those stories into a Hebrew
brief, and a narrow web gap check looks for significant omissions. Only after every
check passes is the brief saved as a Markdown file (the
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
| `packages/demo-data/` | Destructive development-only utility for resetting and filling a local content store with valid fake data. |
| `packages/pipeline/`| The daily generation engine (web research → evidence validation → writing → gap check → validation). |
| `packages/publisher/` | Safe local publication transition with a durable SQLite lease. |
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

Copy `.env.example` to `.env`, set a unique `ADMIN_PASSWORD` of at least 14
characters, fill the remaining secrets, and run the single production service:

```sh
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

To preview a populated archive and Admin UI without AI or external APIs, the
development-only demo-data utility can reset the configured content store and fill
it with valid fake briefs, feedback, alerts, and operational logs. Enable it only in
a local `.env` and always review the printed absolute paths before proceeding:

```env
ALLOW_DESTRUCTIVE_DEMO_DATA_RESET=true
```

```sh
npm run demo-data:generate -- --months=6 --confirm-reset
npm run demo-data:clear -- --confirm-reset
```

Both commands are destructive and require `--confirm-reset`; generation clears the
existing dataset before writing anything. See
[`packages/demo-data/README.md`](packages/demo-data/README.md) for flags, retained
tables, and reset behavior.

Public index pages use a short-lived in-process snapshot of SQLite metadata, while a
daily page reads its Markdown only when requested. Writes made by Admin or the
embedded scheduler invalidate the snapshot immediately; changes made by a separate
process appear after `SITE_SNAPSHOT_CACHE_TTL_SECONDS` (10 seconds by default). A
missing database produces a valid first-run state. Markdown written through the
pipeline or Admin is validated before persistence; if a published file is later
missing, only its requested daily page fails rather than every metadata-driven page.
Set `SITE_URL` to the production origin for canonical URLs.

## Status

The application is implemented and tested end to end: daily research and writing,
deterministic validation, local publication, the Hebrew public site, secure Admin,
feedback and in-admin alerts, and the embedded scheduler all run in one service.
Production hosting, TLS, and persistent-volume configuration remain deployment work.

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
