# Architecture

## Core principle

```
AI creates content  ->  code validates it  ->  SQLite + files store it  ->  the website displays it
```

The AI never modifies the website directly and is never on the request path of a user
reading a page. This separation keeps the system testable, maintainable, and able to
serve pages when AI services are unavailable.

## Components

| Component | Responsibility |
| --------- | -------------- |
| `packages/pipeline` | Staged cited research, deterministic research validation, constrained writing, artifact validation, and persistence. Provider-specific web tools and citations remain behind `AiWebResearchClient`. See [`pipeline.md`](pipeline.md). |
| `packages/core` | Framework-free TypeScript shared by everything: the metadata schema, its allowed values (`status`, `day_intensity`), operator-tunable pipeline settings, and the deterministic validators run before a brief is accepted. |
| `packages/db` | SQLite access: schema and typed read/write functions for day metadata, pipeline settings, feedback tickets, logs, and rate-limit counters. |
| `packages/demo-data` | Development-only CLI that destructively resets a configured content store and fills it with fake data through the real contracts, renderer, validators, and persistence APIs. It is never imported by production code. |
| `packages/publisher` | Revalidates a ready artifact, coordinates local publication with a durable SQLite lease, and atomically marks it published. |
| `apps/web` | One standalone Astro/Node service for public server-rendered pages, password-protected admin, feedback API/inbox, and system alerts. It caches SQLite metadata briefly, reads Markdown only for a requested brief or preview, and keeps reader-side JavaScript small. |
| `scripts` | Operational scripts, e.g. resetting all login-attempt counters. |
| `tech_briefs/` | The content store. `daily/` holds the Markdown briefs (source of truth); `meta/` holds the SQLite database. The path is configurable; this is the default. |

Dependency direction:

```
apps/web           -> core, db, pipeline, publisher
packages/demo-data -> core, db, pipeline
packages/pipeline  -> core, db
packages/publisher -> core, db
packages/db        -> core
packages/core      -> (nothing internal)
```

`core` stays framework-free so the site, the DB layer, and the pipeline can all
depend on it. The demo-data dependency is intentionally one-way: no production app
or package depends on `packages/demo-data`.

## Runtime boundary

`npm start` launches a single long-running Node process. That process owns every HTTP
route — public pages, `/feedback`, `/admin`, health endpoints, and their APIs — and an
in-process Israel-time scheduler for generation and publication. SQLite and Markdown
share one persistent content root. The existing generation/publication commands stay
available for manual recovery, but no separate scheduler or network service is
required.

Public metadata is held in a short-lived, process-local snapshot to avoid reopening
and scanning SQLite on every request. Admin writes and embedded scheduler completion
invalidate that snapshot immediately. The TTL covers Israel-date rollover and writes
performed by another process. Markdown is deliberately absent from the snapshot and
is read only for the requested daily page or an authenticated Admin preview. The AI
pipeline remains completely outside the reader request path.

The scheduler claims one durable SQLite job per action and target date. Active leases
prevent overlap, while terminal success/failure states prevent repeated AI cost after
a restart. Failures flow into the same operational log and Admin alert center.

## Key decisions

The choices behind this structure — Astro, TypeScript everywhere, Markdown as the
source of truth with metadata in SQLite, model access behind an abstraction, and the
single workspace-shaped repo — are recorded with their reasoning in
[`decisions.md`](decisions.md).
