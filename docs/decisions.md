# Decisions

Durable choices that shape the project. This file records the current decision and
the reasoning that should survive implementation changes; operational instructions
belong in the other documents.

## Astro for the website

Daily Tech is primarily a content archive. Astro provides server-rendered pages with
minimal browser JavaScript, native Markdown support, and a clear boundary that keeps
AI outside the reader request path.

## TypeScript across the repository

The website, pipeline, publisher, and database layer share one language and toolchain.
Metadata contracts and deterministic validators live in `packages/core` and are reused
at every boundary.

## Markdown content with SQLite metadata

Markdown is the source of truth for each brief: portable, inspectable, and editable
without proprietary tooling. SQLite stores lifecycle state, queryable metadata,
operational data, sessions, and scheduler leases.

## Model-native research behind a domain boundary

Research is a high-level operation that returns cited stories, not raw search hits.
`NewsResearchProvider` owns Daily Tech concepts such as scope, significance, stories,
and the gap question. `AiWebResearchClient` owns provider mechanics such as web-search
tools, structured output, and machine-readable citations. This keeps the domain
independent of a specific AI provider.

## One workspace-shaped repository

Applications and packages live in one npm workspace. Shared contracts and their
consumers therefore use one dependency graph and the same root quality commands.

## One application service

The public site, Admin, feedback, alerts, and daily scheduler run in one standalone
Astro/Node process against one private content store. Generation and publication also
remain available as local CLI operations for deliberate recovery.

## Embedded scheduler with durable claims

Generation and publication are scheduled inside the application process. SQLite
claims make each job/date pair restart-safe, prevent overlapping instances from doing
the same work, and preserve terminal failures for operator review instead of silently
repeating AI requests.

## Local publication with a durable lease

Publication does not trigger an external deployment. The publisher leases the target
date, revalidates the artifact, and atomically changes its state from `ready` to
`published`. Embedded publication invalidates the site's metadata snapshot
immediately; publication from another process becomes visible when the short cache
TTL expires.

## Password-only Admin authentication

Admin is designed for one operator. A strong password, server-side sessions, CSRF
protection, same-origin checks, and rate limiting provide the required boundary
without introducing user-account management.

## UTC internally, Israel time at the product boundary

Stored timestamps are UTC. Scheduling, research dates, publication dates, and all
user-facing time use `Asia/Jerusalem`.

## JSON columns for metadata lists

Companies, topics, and development digests are stored as checked JSON arrays on the
`daily_briefs` row. The dataset grows by one row per day, so separate child tables
would add joins and ordering columns without a useful scale or integrity benefit.

## `better-sqlite3` for database access

The workload is small, local, and transaction-oriented. `better-sqlite3` provides a
simple synchronous transaction model without depending on Node's experimental SQLite
API.

## Deterministic code validates objective boundaries

Code enforces properties it can establish reliably: schema shape, citation-backed
URLs, calendar-date and event-evidence consistency, internal IDs, writer source
boundaries, and final artifact structure. Semantic relevance, factual synthesis,
confirmation, semantic deduplication, and editorial judgment remain explicit model
instructions rather than heuristic validators.

Validation fails closed at the narrowest safe boundary. A broken provider response or
missing citation set fails the research request; an invalid individual story is
discarded while valid siblings continue.

## The research domain is date-only

Stories use `occurredOn`; sources use nullable `publishedOn`. Both represent calendar
dates, never inferred timestamps. Source publication metadata does not establish the
event date, so each story carries separate event-date evidence. A story is omitted
when the event cannot be placed confidently inside the requested Israel date.

## Structured writing output and deterministic rendering

The writer returns structured brief content and metadata rather than opaque Markdown.
It retains editorial control over selection, grouping, order, wording, and which
verified sources to cite. Code verifies story/source boundaries and renders the final
Markdown structure consistently; it does not make editorial decisions.

## Discovery precedes deep research and writing

A broad discovery pass finds candidate developments. Optional general-gap and
Admin-keyword passes expand that set before one Deep Research request builds the
full dossiers. The writer then makes one editorial pass over accepted dossiers.

Running omission checks before Deep Research gives every candidate the same research
depth and avoids patching an already-written draft through a revision loop.

## Only confirmed developments are eligible

Discovery stages exclude claims supported only by unconfirmed third-party reporting.
Forward-looking items are eligible only when an authoritative party has announced
them. `worthWatching` is reserved for genuinely pending developments, not as a lower
tier for events that already happened.

## Models make editorial selections within bounded requests

Deep Research chooses which candidates justify a dossier, up to the operator's
`maximumStories` ceiling. The writer separately decides which accepted dossiers
belong in the edition. Code enforces response bounds but does not replace either
editorial choice with ranking heuristics. A larger internal candidate cap exists only
to bound pathological request sizes.

## Pipeline settings live in SQLite

Operator-facing settings — focus keywords, story ceiling, discovery toggles,
editorial guidance, and the daily schedule — are stored as one validated SQLite row
and edited as a unit in Admin. The row is seeded with defaults, generation reads it
once per run, and the scheduler reads its times on every tick. Secrets and
infrastructure tuning remain outside Admin. See
[`data-model.md`](data-model.md#pipeline-settings).

## Retry only transient AI client failures

The AI client retries rate limits, server failures, and malformed provider envelopes
with bounded backoff. It does not retry downstream schema, citation-boundary, or
story-validation failures: those are deterministic results that require diagnosis,
not another paid request. Exhausted retries still leave the scheduler job terminal
for operator review.

## Minimal pipeline logging

A generation run records one success event or one failure event. Failures also create
a System ticket in Admin. Per-stage telemetry and duplicate token/cost accounting are
not maintained locally; provider dashboards remain the source for provider usage.
