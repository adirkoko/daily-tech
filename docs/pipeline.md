# Daily Brief Pipeline

Implemented in `packages/pipeline`. Model access goes through an OpenAI-compatible API
behind an abstraction layer. One model may serve every stage; research, writing, and
review stay logically separate.

The orchestration foundation is implemented with dependency-injected ports for every
stage. Hardened prompts, an OpenAI-compatible model adapter, a Brave Search adapter,
and the combined filesystem/SQLite sink are implemented separately, so any provider
can be changed without altering the run logic.

## Time window

Each brief summarizes `00:00–23:59 of the previous day, Israel time`. The system runs
in UTC internally; user-facing times are Israel time.

## Stages

1. **News collection.** Scan the window since the previous cutoff. Source priority:
   official company blogs and newsrooms → official docs → GitHub and release notes →
   reliable tech-news outlets → extra sources for cross-checking. Tracked companies
   and areas (OpenAI, Google, Anthropic, Microsoft, Apple, Meta, NVIDIA, Amazon, xAI,
   Hugging Face, notable startups, major open source, AI models, dev tools, hardware,
   robotics, computing, consumer tech) are a guide, not a hard whitelist. Raw research
   is not archived.

   The default adapter uses exact-date freshness filtering in Brave Search. Search
   results are treated as untrusted data, and an AI-produced source URL is rejected
   unless that exact URL appeared in the supplied search results.

2. **Filter, rank, deduplicate.** Keep real launches and changes with practical
   impact that happened inside the window. Drop rumors, unverified leaks, tiny
   changes, routine bug fixes, opinion pieces with no new development, clickbait,
   duplicates, and pre-window events without materially new information. Financial and
   scientific items enter only with a clear technological or product impact. No hard
   numeric threshold — filtering aggressiveness is set through the system prompt,
   following "a little, but important".

3. **Write the brief.** Natural Hebrew, short, to the point, accurate, no marketing
   enthusiasm, clear to a reader without the background. Each item covers what
   changed, why it matters, what the reader can do with it, availability, and sources.
   This stage also produces the metadata: `summary`, `significant_items`,
   `day_intensity`, `worth_watching_items`, `companies`, `topics`, `developments`,
   `source_count`.

   Every meaningful claim rests on an official, primary, or reliable journalistic
   source. When sources conflict, an official one wins where it is relevant and
   trustworthy. A material conflict that cannot be resolved is not presented as fact —
   the brief states plainly that the detail is unclear or unconfirmed.

4. **Editorial review.** A separate agent checks that claims are source-backed and
   interpretation is not presented as fact; that there is no needless duplication or
   noise and the importance ranking is reasonable; that all headings are present in
   the right order with no broken Markdown; that the metadata matches the content; and
   that the Hebrew reads naturally with no mojibake or stray direction marks.

5. **Missing-news check.** A separate search from another angle: which meaningful
   developments from the period are not in the brief? If something important was
   missed, return to revision, update content and metadata, and re-run the checks.
   Capped at 2–3 iterations.

6. **Deterministic validation** (ordinary code, no AI), before the brief becomes
   `ready`: file name valid; date matches file name and path; metadata record exists;
   all required fields present; `status` valid; `day_intensity` in the allowed set;
   `source_count` valid; item counts match the file structure; no empty links; file
   not empty; file is valid UTF-8. These validators live in `packages/core`.

Only an artifact that passes every check moves to `ready`.

## Quiet day

When nothing meaningful happened, the pipeline does not force content. It produces a
very short brief that says so. The brief is still saved as a file, gets a metadata
record, and appears in the archive and calendar, keeping the historical sequence
unbroken.

## Developing stories

There is no mechanism that aggregates one event across several days. Each brief covers
only what developed inside its own window. A continuing event may be reported again on
a later day, framed around the new information only.

## Failure handling

If the AI, the search service, or another critical stage is unavailable: no partial
file is published; `status` is set to `failed`; a log entry is written; an automated
`system`-category ticket is created; the relevant page shows the user a short "there
was a problem" note with no technical detail.

## Schedule

The intended production schedule is `01:00` Israel time for generation and `07:00`
for publication. Generation saves a valid file with `ready` status. The separate
publisher revalidates it, changes it to `published`, and requests a site rebuild.
Separating the two lets every check finish before anything goes live.

Both commands are implemented and target the previous Israel calendar day by default:

```sh
npm run generate
npm run publish:brief
```

The scheduler that invokes them is deployment-specific and is not configured in this
repository yet.
