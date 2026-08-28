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

## Domain research and provider access are separate

`NewsResearchProvider` owns the Daily Tech domain: the Israel-time window, relevant
categories, significance threshold, researched stories, and the narrow gap check.
`AiWebResearchClient` owns provider mechanics: live web-search tools, strict structured
output, machine-readable citations, usage, and tool cost. The writing client is kept
separate. This allows provider replacement without reducing research back to raw
result lists or leaking provider details into business code.

## Single repository, workspace-shaped

`apps/*` and `packages/*` live in one npm workspace. This keeps shared code (`core`)
and its consumers in one place with one dependency graph and one set of root quality
commands.

## Durable publication lease with local-first visibility

Publication is separate from AI generation. A SQLite lease prevents overlapping
scheduler runs from publishing the same date concurrently and permits recovery after
a crashed or failed attempt. Once the artifact is revalidated, its status changes
atomically from `ready` to `published`. The standalone server sees that transition
immediately, so publication has no external deployment service or outbound trigger.

## One HTTP service

The public site, admin, feedback endpoint, inbox, and system-alert center run under
one Astro standalone Node process. This avoids separate frontend/backend/admin
deployments and keeps authentication, content, and operations on one persistent
SQLite/filesystem boundary. Scheduled generation and publication are operational CLI
jobs against that same store, not independent network services.

## Embedded scheduler with durable daily claims

Generation and publication run inside the standalone service when scheduling is
enabled. A generic SQLite job ledger claims each action/date once, recovers expired
leases, and preserves terminal failures without automatic repeated AI spend. Manual
CLI commands remain available for deliberate recovery.

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

## Model-native web research

Research is one high-level model request that searches the live web, compares sources,
deduplicates events, ranks significance, and returns factual `ResearchedStory` inputs.
Provider-returned citation annotations are authoritative; a URL written only inside
model JSON is rejected. Code validates evidence consistency per story, conservatively
deduplicates obvious repeats, and assigns internal IDs only afterward.
