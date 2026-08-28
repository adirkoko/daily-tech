# Daily Brief Pipeline

Implemented in `packages/pipeline`. There is one production architecture and one
execution path. `NewsResearchProvider` expresses the Daily Tech research domain;
`AiWebResearchClient` isolates the provider's live web tool, strict structured output,
machine-readable citations, usage, and tool cost. Writing has its own completion
client and cannot invoke web research.

## Time window

Each brief covers exactly the previous calendar day in `Asia/Jerusalem`. The window is
represented by UTC start/end instants plus the Israel date, so 23-hour and 25-hour DST
days remain correct.

## Stages

1. **Model Web Research.** One request searches the live web across the relevant
   technology domains, reads multiple sources, semantically deduplicates reports about
   the same event, ranks significance, filters noise, and returns factual story inputs.
   The model does not assign internal IDs.

   Each story contains a title, factual summary, significance, key facts,
   availability, category, importance, event time, companies/topics, sources, and
   event-date evidence. A source URL is trusted only when it matches a machine-readable
   citation annotation returned by the provider API; a URL present only in generated
   JSON is not accepted.

2. **Deterministic Research Validation.** Code validates structure, categories,
   importance, research-window membership, source/citation consistency, and
   event-date evidence consistency. This is deliberately called evidence validation:
   code can prove that the referenced citation and dates line up, but does not pretend
   to understand semantically whether a source proves the model's prose.

   Validation is fail-closed at the narrowest safe boundary. No citations or a broken
   base response fails the whole Research request. A bad source or evidence entry
   rejects its entire story while valid sibling stories continue. If a non-empty
   response leaves no valid stories, Research fails; an explicitly empty response is
   an accepted quiet day.

3. **Conservative deterministic deduplication and IDs.** The model performs semantic
   deduplication. Code only merges high-confidence repeats, such as a shared canonical
   URL or a near-identical title with the same date, category, and central companies.
   Ambiguous semantic similarity is preserved. Code assigns story IDs only after
   validation and deduplication.

4. **Draft.** One writing request turns accepted `ResearchedStory[]` into the Hebrew
   brief and metadata. Those stories are the sole factual source of truth. The writer
   may improve phrasing, structure, concision, consistency, and redundancy, but may
   not add outside facts, numbers, dates, quotes, product/company names, comparisons,
   availability claims, data, or URLs.

5. **Deterministic Draft Validation.** Code requires each accepted story exactly once,
   rejects unknown or duplicate story IDs, ensures every Markdown URL belongs to the
   validated research sources, checks metadata company/topic boundaries, and runs the
   shared artifact validators.

6. **Model Web Gap Check.** One narrow research request asks only whether a significant
   technology development inside the same window is missing from both the accepted
   stories and draft. It does not critique prose, rearrange the brief, or repeat covered
   stories. Returned missing stories must already meet the system's significance bar.

7. **Conditional Revision.** An empty `missingStories` result proceeds directly to
   final validation. Otherwise, missing stories undergo the same citation, evidence,
   deduplication, and ID process, then one Revision request incorporates them. Another
   Gap Check follows. The configured maximum revision count bounds this loop.

8. **Final validation and persistence.** The final draft is converted to the shared
   artifact shape and fully validated by `packages/core`. Only then does the combined
   Markdown/SQLite sink persist it as `status=ready`. A metadata failure restores the
   prior Markdown state rather than leaving a partial artifact.

## Model-request shape

An ordinary non-empty run uses:

```text
Research -> Draft -> Gap Check
```

One justified revision uses:

```text
Research -> Draft -> Gap Check -> Revision -> Gap Check
```

This is a consequence of required work, not a quota. A true quiet day makes Research
and Gap Check requests but skips Draft. The deterministic stages never consume model
requests.

## Quiet day

When Research explicitly returns no meaningful stories and the Gap Check agrees, code
creates a small deterministic Hebrew quiet-day artifact. No artificial writing call is
made. The day is still persisted, scheduled for publication, and retained in the
archive/calendar so the historical sequence remains complete.

## Developing stories

Each brief covers only developments occurring inside its own window. A continuing
event can appear on a later day only when the research evidence identifies a new,
significant development during that later window.

## Failure handling

A critical provider, persistence, or validation failure never publishes a partial
artifact. The run records failure details in structured logs and creates a `system`
ticket in the Admin alert center. There are no outbound incident-notification services.

## Usage accounting

Every request contributes input tokens, output tokens, provider cost when supplied,
web-tool calls, and web-tool cost when supplied. The orchestrator also records total
model requests, accepted/rejected stories, gap additions, and revision rounds.

## Schedule

Generation defaults to `01:00` Israel time and persists `ready`; publication defaults
to `07:00`, revalidates the local artifact, and atomically changes it to `published`.
Both times remain configurable. The single standalone service runs the embedded
scheduler, while the same operations remain available for deliberate recovery:

```sh
npm run generate
npm run publish:brief
```
