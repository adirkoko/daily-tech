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
- Persisted counts, intensity, companies, topics, development titles, and source
  count are derived from the writer's final selection rather than authored twice.
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

AI request controls (shared by CLI, dry runs, scheduled runs, and Admin generation):

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_RESEARCH_TIMEOUT_MS` | `240000` | Research timeout per attempt, in milliseconds. |
| `AI_COMPLETION_TIMEOUT_MS` | `120000` | Writing timeout per attempt, in milliseconds. |
| `AI_MAX_ATTEMPTS` | `3` | Total attempts, including the first. Set to `1` to disable retries. |
| `AI_RETRY_BASE_DELAY_MS` | `1000` | Initial exponential backoff delay, before jitter. |
| `AI_RETRY_MAX_DELAY_MS` | `8000` | Backoff cap before jitter; also caps provider Retry-After. |

All five accept integers from 1 to 2147483647; the maximum delay must be at
least the base delay. Invalid values fail configuration loading. Omitted values
use the defaults above. Restart the service after changing its environment.
Retries remain limited to HTTP 429/5xx and malformed successful responses;
timeouts are not automatically retried.

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
