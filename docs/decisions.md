# Decisions

A short running list of choices that shape the project, with the reasoning behind
them, so they are not re-argued later. Not a formal process — new entries are appended
as decisions are actually made. Unresolved choices live in
[`deployment.md`](deployment.md#open-questions) and the "open point" notes in other
docs.

## Astro for the website

The product is a mostly-static content archive. Astro ships zero JS by default, has
native Markdown handling, and makes the "AI is never on the request path" rule easy to
hold. Next.js would mean working against the framework for a static content site.

## TypeScript across the whole repo

One language and toolchain for the site, the DB layer, and the pipeline. The metadata
schema, the `day_intensity` / `status` enums, and the deterministic validators are
defined once in `packages/core` and reused everywhere. An OpenAI-compatible client is
small in TypeScript, so Python's AI ecosystem does not justify a second toolchain.

## Markdown as the source of truth, metadata in SQLite

The Markdown files stay clean, portable, and hand-editable. SQLite provides type and
enum enforcement plus fast queries for search, filtering, and the statistics page,
without re-analyzing the archive with an AI.

## Model access behind an abstraction

The pipeline reaches the model through a thin OpenAI-compatible layer. Swapping model
or provider must not touch business code. One model can serve every AI stage; the
research, writing, and review roles stay logically separate as distinct agents or role
prompts.

## Single repository, workspace-shaped

`apps/*` and `packages/*` in one repo, intended to become npm workspaces once the
packages carry a `package.json`. Keeps shared code (`core`) and its consumers in one
place with one dependency graph.

## Password-only admin auth

The admin area is for a single operator. A password with no username, plus per-IP rate
limiting, is enough and keeps the surface minimal. Secrets stay server-side.

## UTC internally, Israel time for content and users

The system runs in UTC behind the scenes. The content window
(`00:00–23:59 of the previous day`) and every user-facing time are Israel time.

## Normalized metadata lists in SQLite

Companies, topics, and development digests use child tables rather than JSON columns.
Each row retains its list position. This makes statistics and filtering directly
queryable and indexable while preserving the order produced by the pipeline.

## better-sqlite3 for database access

The database package uses `better-sqlite3`: its synchronous transaction model fits
the small, local metadata workload and avoids basing a critical persistence layer on
Node's still-experimental `node:sqlite` API.
