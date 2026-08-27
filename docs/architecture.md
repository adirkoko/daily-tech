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
| `packages/pipeline` | The daily generation engine: research, filtering, ranking, deduplication, writing, editorial review, missing-news check. Reaches the model through a thin OpenAI-compatible abstraction so the model or provider can be swapped. |
| `packages/core` | Framework-free TypeScript shared by everything: the metadata schema, its allowed values (`status`, `day_intensity`), and the deterministic validators run before a brief is accepted. |
| `packages/db` | SQLite access: schema and typed read/write functions for day metadata, feedback tickets, logs, and rate-limit counters. |
| `packages/publisher` | Revalidates a ready artifact, coordinates publication with a durable SQLite lease, and atomically marks it published. Publication is local by default; an HTTP webhook is optional. |
| `apps/web` | One standalone Astro/Node service for public server-rendered pages, password-protected admin, feedback API/inbox, and system alerts. It reads Markdown and SQLite on demand and ships almost no client JavaScript. |
| `scripts` | Operational scripts, e.g. resetting all login-attempt counters. |
| `tech_briefs/` | The content store. `daily/` holds the Markdown briefs (source of truth); `meta/` holds the SQLite database. The path is configurable; this is the default. |

Dependency direction:

```
apps/web           -> core, db
packages/pipeline  -> core, db
packages/publisher -> core, db
packages/db        -> core
packages/core      -> (nothing internal)
```

`core` stays framework-free so the site, the DB layer, and the pipeline can all
depend on it.

## Runtime boundary

`npm start` launches a single long-running Node process. That process owns every HTTP
route: public pages, `/feedback`, `/admin`, and their APIs. SQLite and Markdown share
one persistent content root. Generation and publication remain commands run by cron
or another scheduler, but they use the same repository, database, filesystem, and
validation contracts; they are not separate network services.

Because public content is rendered on demand, an admin save or local publication
transition becomes visible immediately. The AI pipeline remains completely outside
the reader request path.

## Key decisions

The choices behind this structure — Astro, TypeScript everywhere, Markdown as the
source of truth with metadata in SQLite, model access behind an abstraction, and the
single workspace-shaped repo — are recorded with their reasoning in
[`decisions.md`](decisions.md).
