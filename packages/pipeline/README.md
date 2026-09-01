# @daily-tech/pipeline

Generates one cited, validated Hebrew technology brief for the previous Israel
calendar day.

The package coordinates staged model-native research, deterministic evidence
validation, code-assigned IDs, a single structured writing pass, Markdown rendering,
and persistence. The full stage contract is documented in
[`docs/pipeline.md`](../../docs/pipeline.md).

## Boundaries

- `NewsResearchProvider` owns research scope, significance, discovery, gap
  checking, and deep research.
- `AiWebResearchClient` owns provider web-search tools, structured output, and
  machine-readable citations.
- `BriefWriter` writes only from accepted `DeepResearchedStory[]` and cannot search.
- `@daily-tech/core` validates the final Markdown and metadata artifact.
- External research, writing, persistence, logging, and failure reporting are
  dependency-injected for tests.

## Provider configuration

Copy the example environment file from the repository root:

```powershell
Copy-Item .env.example .env
```

Required:

- `AI_API_KEY`
- `AI_MODEL`

Optional:

- `AI_BASE_URL` — defaults to `https://api.openai.com/v1`.
- `TECH_BRIEFS_ROOT` — defaults to `tech_briefs` and is used by production generation.

The configured provider must support chat completions for writing and a
Responses-compatible live web-search endpoint with strict structured output and
machine-readable URL citations.

## Production generation

```sh
npm run generate
```

The default run covers the previous Israel calendar day and persists a validated
artifact as `ready`. For deterministic recovery or backfill, provide the instant from
which that previous-day window is calculated:

```sh
npm run generate -- --run-at=2026-08-28T01:00:00.000Z
```

## Real-provider dry run

The dry run uses the same provider and pipeline but does not open SQLite, write the
production content store, or publish:

```sh
npm run generate:dry-run -- --date=2026-08-27
```

The explicit date prevents accidental provider spend for the wrong day. Use
`--output-root=PATH` to replace the default `tmp/pipeline-dry-run` directory.

A successful run prints `SUCCESS` and the absolute paths of:

```text
tmp/pipeline-dry-run/daily/2026/august/2026-08-27/2026-08-27-tech_briefs.md
tmp/pipeline-dry-run/meta/2026-08-27-database-write.yaml
```

The Markdown is the production-shaped artifact. The YAML mirrors the values that
would be persisted for the run, excluding database-generated IDs. On failure the
command exits non-zero and prints the failing stage, message, and deterministic
validation issues when available.
