# @daily-tech/pipeline

The daily brief generation engine for Daily Tech.

## Architecture

The production path is deliberately singular:

```text
Model Web Research
  -> story-level event-date evidence validation
  -> conservative deterministic deduplication and code-assigned IDs
  -> constrained Draft
  -> deterministic draft validation
  -> narrow Model Web Gap Check
  -> optional Revision + another Gap Check
  -> final artifact validation
  -> Markdown + SQLite persistence as status=ready
```

`NewsResearchProvider` owns the news domain, significance threshold, research window,
stories, and gap question. `AiWebResearchClient` owns provider-specific web tools,
strict structured output, machine-readable citations, usage, and web-tool cost.
`BriefWriter` may only reorganize and phrase accepted `ResearchedStory[]`; it may not
introduce factual details or URLs from outside that input.

Citation validation fails closed. A missing citation set or structurally broken
provider response fails the Research request. A story with an unverifiable source or
inconsistent event-date evidence is rejected on its own, allowing other valid stories
to continue. If a non-empty response leaves no valid stories, Research fails. An
explicitly empty response is a quiet day and skips Draft.

An ordinary non-empty run makes three model requests: Research, Draft, and Gap Check.
One justified revision makes five: Research, Draft, Gap Check, Revision, and Gap Check.
These are outcomes of the required stages, not quotas; quiet days do not make
artificial writing calls.

## Other guarantees

- Previous-day windows use `Asia/Jerusalem`, including DST transition days.
- Deterministic artifact validation runs through `@daily-tech/core` before persistence.
- A bounded revision loop prevents uncontrolled cost.
- Model, token, web-tool, and provider-cost usage is aggregated across the run.
- A compensating filesystem + SQLite sink restores the prior Markdown file if the
  metadata transaction fails.
- Structured logs, failed-day state, and System tickets share SQLite.

## Run locally

Copy `.env.example` to `.env` and configure a provider that supports chat completions,
Responses-compatible live web research, strict structured output, and
machine-readable citations. Then run:

```sh
npm run generate
```

For a deterministic backfill window, pass an ISO run timestamp. The generated brief
always covers the previous Israel calendar day:

```sh
npm run generate -- --run-at=2026-08-28T01:00:00.000Z
```

External capabilities remain dependency-injected, so research, writing, storage,
logging, and failure reporting are testable without calling an external API.
