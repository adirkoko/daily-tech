# Daily Brief Pipeline

`packages/pipeline` generates one validated brief for the previous Israel calendar
day. There is one production path:

```text
Research -> validation and IDs -> Draft -> validation -> Gap Check
         -> optional Revision -> final validation -> persist as ready
```

`NewsResearchProvider` defines the Daily Tech research domain. `AiWebResearchClient`
isolates the configured provider's live web-search and citation mechanics. Writing
uses a separate completion client and cannot search the web.

## Research date

The pipeline derives the previous calendar date in `Asia/Jerusalem`, including DST
transitions. Only `date` and `timeZone` are sent to Research; stories and sources do
not carry time-of-day fields.

## Stages

### 1. Model Web Research

One request searches across the configured technology categories, compares sources,
deduplicates reports about the same event, evaluates significance, and returns
structured story inputs. Research returns all qualifying stories up to the configured
limit; it does not curate the final edition or assign internal IDs.

Each story contains its factual summary, significance, key facts, availability,
category, importance, companies/topics, sources, `occurredOn`, and separate
event-date evidence. Each source has a nullable `publishedOn`. A generated URL is
accepted only when it matches a machine-readable citation returned by the provider.

### 2. Research validation, deduplication, and IDs

Code validates schema shape, the importance threshold, citation-backed source URLs,
the requested calendar date, and event-date evidence consistency. Validation is
fail-closed at the smallest safe boundary:

- A broken base response or missing citation set fails the request.
- An invalid story is rejected without discarding valid sibling stories.
- A non-empty response from which no valid story survives fails the request.
- An explicitly empty response is a valid quiet-day result.

The model performs semantic deduplication. Code only merges stories that share a
canonical source URL, then assigns internal IDs to the surviving stories.

### 3. Draft

When Research returns stories, one writing request produces structured Hebrew content
and metadata. The writer decides selection, grouping, order, wording, and which of the
stories' verified sources to cite.

`ResearchedStory[]` is the only factual input. The writer may not introduce a fact,
name, number, date, comparison, availability claim, or URL that is absent from the
referenced research.

### 4. Draft validation and Markdown rendering

Code verifies that every referenced story ID exists and every cited URL belongs to
the referenced stories. It then renders the structured draft as deterministic
Markdown with numbered developments, optional subsections, an optional
worth-watching section, and the closing paragraph. `packages/core` validates the
complete Markdown/metadata artifact.

The writer is not required to use every researched story; inclusion is an editorial
decision.

### 5. Model Web Gap Check

One narrow research request asks whether the research date contains a significant,
eligible technology development that is missing from both the accepted stories and
the draft. It does not review prose or propose stylistic changes. Returned stories
must already meet the normal significance and source requirements.

### 6. Optional Revision

If Gap Check returns valid missing stories, the pipeline assigns their IDs and makes
one Revision request. The revised draft is validated again. There is no second Gap
Check and no revision loop.

### 7. Final validation and persistence

The final artifact is validated once more and saved as Markdown plus SQLite metadata
with `status=ready`. The combined sink restores the previous Markdown state if the
metadata transaction fails.

## Model requests

Normal non-empty run:

```text
Research -> Draft -> Gap Check
```

Run with a missing story:

```text
Research -> Draft -> Gap Check -> Revision
```

A quiet day skips the initial Draft. Gap Check still runs; if it also returns no
stories, code creates the quiet-day artifact without a writing request. The pipeline
therefore makes only the calls required by the result, with four as the maximum.

## Continuing stories

A continuing topic can appear on a later date only when that date contains a new,
significant development. An article published during the window about an older event
does not make the event eligible.

## Failures and diagnostics

A provider, validation, or persistence failure never produces a publishable partial
artifact. The run creates one failure log and one System ticket in Admin. When every
story in a non-empty Research or Gap response is rejected, the failure includes each
story's index, title, and rejection reason.

See [`operations.md`](operations.md) for the wider logging and alert behavior.

## Schedule and manual execution

Generation defaults to `01:00` Israel time and publication to `07:00`; both are
configurable. The embedded scheduler runs them inside the application service. Manual
commands remain available:

```sh
npm run generate
npm run publish:brief
```

To run the real provider and full pipeline without opening SQLite or publishing, use:

```sh
npm run generate:dry-run -- --date=YYYY-MM-DD
```

Dry-run configuration and outputs are documented in
[`packages/pipeline/README.md`](../packages/pipeline/README.md#real-provider-dry-run).
