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
request. Every research prompt permits structured-output URLs only when the current
provider response exposes the same URLs as machine-readable citations. Code removes
an unsupported source entry at the narrowest safe boundary. Its story may continue
only when another valid source remains and `eventDateEvidence.sourceUrl` still points
to a valid source retained by that story.

## Research date

The run derives the previous Israel calendar date, including daylight-saving
transitions. Research receives the date and time zone; stories use `occurredOn`,
sources use nullable `publishedOn`, and neither field carries invented time-of-day
precision. `occurredOn` is the event's Israel calendar date; research may derive it
from an explicit timestamp in another time zone, but may not guess a time zone or use
an article's publication date as a substitute for the event date.

Normal scheduled and CLI runs target the previous day. An authenticated Admin
regeneration supplies an explicit historical date and builds the same exact Israel
calendar window; it does not approximate the date through a UTC offset.

## Stages

### 1. Light Discovery

One broad request searches the configured technology categories and returns
`CandidateStory` inputs. Each candidate contains enough information for triage: a
title, short factual summary, category, importance, event-date evidence, central
companies/topics, and cited sources.

The model uses a shared 1-5 importance rubric and prefers authoritative primary
evidence such as official documentation, filings, regulators, court records, papers,
security advisories, standards bodies, status pages, and release repositories. Code
validates citation-backed URLs, the configured threshold, the requested date, and
event-evidence consistency. Invalid sources are removed individually; a story is
rejected only when its remaining sources or event-date evidence no longer satisfy the
contract. Valid siblings continue. Surviving candidates are conservatively
deduplicated and receive internal IDs from code.

Each Discovery response has a schema-level `maximumCandidatesPerCall` limit. When
more stories qualify, the model prioritizes importance, evidence quality, consequence,
and coverage diversity rather than exceeding the response bound.

### 2. Optional discovery passes

Gap Discovery asks whether the broad pass missed a significant eligible development.
Admin Keywords Research asks the same question within operator-selected companies,
products, technologies, or topics. Each pass compares against the candidates already
accepted and returns only new candidates.

With no focus keywords, Gap Discovery performs an adaptive cross-domain omission
check across the broader technology landscape rather than one narrow follow-up query.
With keywords, the same focused contract directs extra attention only to those areas;
it does not require a result for every keyword.

The two passes are independently configurable. Keyword research is also skipped when
the keyword list is empty. Keywords influence attention only; they do not lower the
importance, confirmation, source, or date requirements.

### 3. Candidate merge

Each discovery result is validated and deduplicated against the accumulated set. A
high internal safety cap bounds the candidate list sent to Deep Research on an
exceptionally busy day; it is a request-size safeguard, not the normal editorial
selection mechanism.

### 4. Deep Research

One web-enabled request investigates all surviving candidates. `maximumStories` is a
hard response ceiling, not a target. Each `DeepResearchedStory` contains the factual
material the writer may need, nullable fields for details that were not verified,
event-date evidence, and cited sources. Every candidate must be accounted for exactly
once: either as a selected dossier or in `excludedCandidates` with a bounded reason
such as insufficient evidence, wrong date, duplication, low importance, selection
priority, or missing eligible citations.

Code matches every dossier and exclusion to a known candidate ID, rejects duplicate
or unaccounted IDs, enforces the importance and response limits, and revalidates
source citations and date evidence. The candidate's code-assigned ID becomes the
final story ID.

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

Every discovery stage records a compact `research_stage_completed` event containing
bounded title/topic lists and found, contributed, rejected, and deduplicated counts.
Deep Research records candidate and final-selection counts plus bounded exclusion
reasons. Skipped optional stages are recorded as skipped. Admin uses the latest run's
events to explain how much each pass contributed and why candidates were removed;
logging these summaries never adds an AI call and a logging failure does not fail a
valid brief.

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

From an individual Admin brief page, a failed day can be retried and any existing
day can be regenerated. The operation uses this same pipeline and the same saved
settings. It runs in the web service background under the durable generation lease;
regenerating a published day replaces its content while preserving its published
lifecycle state and original publication timestamp. The old artifact and metadata
are retained unless the entire replacement reaches successful persistence. While the
lease is active, Admin save and delete operations for that date are refused.

To exercise the real provider without opening SQLite or publishing:

```sh
npm run generate:dry-run -- --date=YYYY-MM-DD
```

Dry-run outputs are documented in
[`packages/pipeline/README.md`](../packages/pipeline/README.md#real-provider-dry-run).
