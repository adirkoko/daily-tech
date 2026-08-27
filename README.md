# Daily Tech

An automated engine that builds, over time, a curated Hebrew archive of the
developments that actually mattered in technology.

Once a day a pipeline of AI agents researches the previous day, filters noise and
duplicates, writes a short brief in Hebrew, reviews it, and runs deterministic
validation. Only after every check passes is the brief saved as a Markdown file (the
source of truth) with its metadata in SQLite, and published to a static website at a
fixed hour. The website never calls an AI model at request time.

```
AI creates content  ->  code validates it  ->  SQLite + files store it  ->  the website displays it
```

## Repository structure

| Path                | Purpose |
| ------------------- | ------- |
| `apps/web/`         | Astro static website (home, daily brief, archive, calendar, statistics). |
| `packages/core/`    | Shared TypeScript: metadata schema, enums, deterministic validators. |
| `packages/db/`      | SQLite access layer and schema for the metadata database. |
| `packages/pipeline/`| The daily generation engine (research → filter → write → review → validate). |
| `packages/publisher/` | Safe publication transition and deployment webhook orchestration. |
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
```

For local website development, keep the default `TECH_BRIEFS_ROOT` or point it at a
different content store, then run:

```sh
npm run dev --workspace @daily-tech/web
```

The site reads SQLite and Markdown only at build time. A missing database produces a
valid first-run state; a `published` database record without its Markdown file fails
the build instead of deploying a broken page. Set `SITE_URL` to the production origin
when building canonical URLs.

## Status

Early implementation stage. `packages/core` provides the metadata contract and full
artifact validation. `packages/db` now provides transactional migrations and typed
SQLite persistence for daily metadata, including normalized company, topic, and
development tables. `packages/pipeline` provides the tested orchestration foundation,
Israel-time windows, bounded editorial revision loop, failure boundaries, and an
OpenAI-compatible client. Production prompts, Brave Search, compensating Markdown +
SQLite persistence, operational logging, and System-ticket failure reporting are now
wired. `packages/publisher` revalidates ready artifacts, coordinates concurrent
publication attempts through SQLite leases, transitions metadata atomically, and
triggers a configurable deployment webhook. `apps/web` provides the static Hebrew RTL site with first-run and failure
states, daily pages, a calendar heatmap, archive navigation, and aggregate statistics.
The remaining release work is scheduler/hosting configuration and the secured admin
surface.

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
