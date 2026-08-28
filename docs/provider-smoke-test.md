# Real-provider pipeline smoke test

This command runs the real Daily Tech pipeline and configured AI provider for one
explicit Israel calendar day:

```text
Research -> Validation -> Draft -> Gap Check -> optional Revision -> Final Validation
```

It does not use mocks, open SQLite, write to the production content store, or invoke
publication. Output files are created only after the full pipeline returns a valid
`ready` artifact.

## Configuration

Create the local environment file from the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
```

Required for this command:

- `AI_API_KEY` — the real provider credential.
- `AI_MODEL` — one model that supports both the writing endpoint and the live
  web-research endpoint described below.

Optional:

- `AI_BASE_URL` — defaults to `https://api.openai.com/v1`. A different provider must
  expose an OpenAI-compatible `/chat/completions` endpoint and a Responses-compatible
  `/responses` endpoint with the `web_search` tool, strict JSON-schema output, and
  machine-readable URL citations.
- `PIPELINE_MAX_REVISION_ROUNDS` — defaults to `3`; allowed range is `1` through `3`.
- Every Admin, scheduler, publication, site, and storage variable in `.env.example` is
  ignored by this smoke command.

The command intentionally uses one configured model for Research, Draft, Gap Check,
and any Revision. Never commit `.env`.

## Run

Choose the exact Israel calendar date to research:

```powershell
npm run generate:smoke -- --date=2026-08-27
```

The explicit date is required to avoid accidental provider spend for the wrong day.
An optional output root can be supplied:

```powershell
npm run generate:smoke -- --date=2026-08-27 --output-root=tmp/my-provider-smoke
```

## Output

With the default output root and the example date, successful files are:

```text
tmp/pipeline-smoke/daily/2026/august/2026-08-27/2026-08-27-tech_briefs.md
tmp/pipeline-smoke/meta/2026-08-27-database-write.yaml
```

The Markdown bytes come directly from the final production-shaped artifact. The YAML
mirrors the values production would write to `daily_briefs`,
`daily_brief_companies`, `daily_brief_topics`, `daily_brief_developments`, and
`operational_logs`. SQLite-generated primary keys are omitted because no database is
opened. The `tmp/` tree is ignored by Git.

## Terminal status

Every stage prints a start and completion line:

```text
[pipeline-smoke] START stage=research
[pipeline-smoke] OK stage=research
```

Success ends with `SUCCESS`, request/usage totals, and the two absolute output paths.
A failure exits with a non-zero status and prints `EXIT_FAILURE`, the failed stage, the
error/cause chain, and deterministic validation issues when present. No new output is
written by a failed run; files left by an earlier successful run are not evidence that
the latest run succeeded.
