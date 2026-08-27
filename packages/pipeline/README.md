# @daily-tech/pipeline

The daily brief orchestration layer for Daily Tech.

## Implemented

- Previous-day windows based on `Asia/Jerusalem`, including 23-hour and 25-hour DST
  transition days.
- Separate ports for research, filtering, writing, editorial review, and missing-news
  review. Implementations can use one model while keeping agent roles isolated.
- A bounded review/revision loop with missing-item deduplication.
- Deterministic artifact validation through `@daily-tech/core` before persistence.
- Failure reporting and structured stage/run events. The sink is never called with an
  invalid or partial artifact.
- Token and provider-cost aggregation across AI stages.
- A small OpenAI-compatible chat-completions client with timeouts, cancellation, JSON
  mode, error sanitization, and caller-owned response parsing.
- Hardened prompts and strict response parsing for every AI stage. Model-returned
  source URLs must exist in the search results supplied to that model call.
- A Brave Search adapter with exact-date freshness filtering.
- A compensating filesystem + SQLite sink: a failed metadata write restores the prior
  Markdown file instead of leaving a partial artifact.
- SQLite-backed operational logging, failed-day state, and System tickets.

## Run locally

Copy `.env.example` to `.env`, fill in the model and Brave Search credentials, then:

```sh
npm run generate
```

For a deterministic backfill window, pass an ISO run timestamp. The generated brief
always covers the previous Israel calendar day:

```sh
npm run generate -- --run-at=2026-08-28T01:00:00.000Z
```

`DailyBriefPipeline` still receives every external capability as a dependency, so the
search provider, model provider, storage, logger, and failure reporter remain
replaceable. Automated tests use fakes and never call either external API.
