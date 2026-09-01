# Daily Brief Pipeline

`packages/pipeline` generates one validated brief for the previous calendar date in
`Asia/Jerusalem`.

```text
Light Discovery
  -> optional Gap Discovery
  -> optional Admin Keywords Research
  -> Deep Research
  -> Draft
  -> validation and persistence
```

Research uses live web search and machine-readable citations. Writing uses a separate
completion client with no web-search capability. The pipeline never runs on a reader
request.

## Research date

The run derives the previous Israel calendar date, including daylight-saving
transitions. Research receives the date and time zone; stories use `occurredOn`,
sources use nullable `publishedOn`, and neither field carries invented time-of-day
precision.

## Stages

### 1. Light Discovery

One broad request searches the configured technology categories and returns
`CandidateStory` inputs. Each candidate contains enough information for triage: a
title, short factual summary, category, importance, event-date evidence, central
companies/topics, and cited sources.

Code validates citation-backed URLs, the importance threshold, the requested date,
and event-evidence consistency. Invalid stories are rejected individually; valid
siblings continue. Surviving candidates are conservatively deduplicated and receive
internal IDs from code.

### 2. Optional discovery passes

Gap Discovery asks whether the broad pass missed a significant eligible development.
Admin Keywords Research asks the same question within operator-selected companies,
products, technologies, or topics. Each pass compares against the candidates already
accepted and returns only new candidates.

The two passes are independently configurable. Keyword research is also skipped when
the keyword list is empty. Keywords influence attention only; they do not lower the
importance, confirmation, source, or date requirements.

### 3. Candidate merge

Each discovery result is validated and deduplicated against the accumulated set. A
high internal safety cap bounds the candidate list sent to Deep Research on an
exceptionally busy day; it is a request-size safeguard, not the normal editorial
selection mechanism.

### 4. Deep Research

One web-enabled request investigates all surviving candidates. It may omit a
candidate that does not hold up under closer inspection and returns at most the
configured `maximumStories` dossiers. Each `DeepResearchedStory` contains the factual
material the writer may need, nullable fields for details that were not verified,
event-date evidence, and cited sources.

Code matches every dossier to a known candidate ID, rejects duplicate candidate IDs,
and revalidates source citations and date evidence. The candidate's code-assigned ID
becomes the final story ID.

### 5. Draft

One non-search model request turns `DeepResearchedStory[]` into structured Hebrew
content and metadata. The writer controls selection, grouping, order, and wording,
but may use only facts and URLs present in the referenced dossiers. Optional
editorial instructions can affect emphasis without overriding that factual boundary.

When Deep Research returns no stories, code creates the quiet-day draft without a
writing request.

### 6. Validation and persistence

Draft validation checks that every referenced story ID exists and every cited URL
belongs to the referenced dossiers. Code then renders deterministic Markdown and
validates the final Markdown/metadata artifact with `@daily-tech/core`.

The accepted artifact is written to the content store with `status=ready`. If the
metadata write fails, the combined sink restores the previous Markdown state.

## Model requests

With both optional discovery passes enabled and at least one Admin keyword, a
non-empty run makes five requests:

```text
Light Discovery       web search
Gap Discovery         web search
Admin Keywords        web search
Deep Research         web search
Draft                 no web search
```

Disabled optional passes make no request. A missing keyword list skips the keyword
pass, and an empty candidate/story set skips Deep Research or Draft as appropriate.
A run therefore makes between one and five logical model requests. Transient
provider retries may produce additional HTTP attempts for any one request.

## Pipeline settings

Production generation loads `PipelineSettings` from SQLite at the start of the run:

- Admin focus keywords.
- Maximum Deep Research stories.
- Gap and keyword discovery toggles.
- Editorial instructions.
- Generate and publish times used by the embedded scheduler.

The real-provider dry run does not open SQLite and uses the built-in defaults. See
[`admin.md`](admin.md#pipeline-settings) and
[`data-model.md`](data-model.md#pipeline-settings).

## Continuing stories

A continuing topic may appear on a later date only when that date contains a new,
significant development. A newly published article about an older event does not
make the event eligible.

## Failures and diagnostics

A provider, validation, or persistence failure never produces a publishable partial
artifact. The run records `run_failed` and creates a System ticket in Admin. When an
entire non-empty research batch is rejected, diagnostics include each story's index,
title, and rejection reason.

Transient provider failures are retried by the AI client as documented in
[`operations.md`](operations.md#provider-reliability).

## Schedule and manual execution

The embedded scheduler uses the Admin-configured generate and publish times,
defaulting to `01:00` and `07:00` in `Asia/Jerusalem`. It reads the times on every
tick, so changes do not require a restart.

Manual commands remain available:

```sh
npm run generate
npm run publish:brief
```

To exercise the real provider without opening SQLite or publishing:

```sh
npm run generate:dry-run -- --date=YYYY-MM-DD
```

Dry-run outputs are documented in
[`packages/pipeline/README.md`](../packages/pipeline/README.md#real-provider-dry-run).
