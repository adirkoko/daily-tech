# Demo data utility

`@daily-tech/demo-data` is a small, development-only command-line utility that resets Daily Tech application data and creates months of fake but valid content. It uses the production data contracts, Markdown renderer, validators, database API, feedback operations, and operational-log operations. It does not use AI, web search, or external APIs.

> **Warning — destructive:** both commands permanently delete application data from the configured `TECH_BRIEFS_ROOT`. Never enable or run this tool against production.

## Enable it locally

The tool is disabled by default. Set this only in a local development `.env`:

```env
ALLOW_DESTRUCTIVE_DEMO_DATA_RESET=true
```

Every destructive command also requires the explicit `--confirm-reset` flag. There is no interactive confirmation.

## Generate data

Generation always clears the current dataset first, so repeated runs do not accumulate or duplicate data.

```bash
npm run demo-data:generate -- --months=6 --confirm-reset
```

Options:

- `--months=<1-24>` — number of months to generate; defaults to `6`.
- `--seed=<integer>` — deterministic random seed; a fixed default is used when omitted.
- `--confirm-reset` — required confirmation for the destructive reset.
- `--help` — show command help without touching data.

The period is calendar-based rather than a fixed day count: it ends yesterday in
`Asia/Jerusalem` and starts on the first day of the month `months - 1` calendar
months before the ending month. For example, when yesterday is `2026-08-28`,
`--months=6` produces `2026-03-01` through `2026-08-28`.

Example with an explicit seed:

```bash
npm run demo-data:generate -- --months=6 --seed=123 --confirm-reset
```

## Clear data

```bash
npm run demo-data:clear -- --confirm-reset
```

Both commands clear these tables in one database transaction:

- `publication_jobs`
- `scheduled_jobs`
- `operational_logs`
- `feedback_tickets`
- `rate_limit_counters`
- `daily_briefs`

They keep `schema_migrations` and `admin_sessions`. They also remove everything under `<TECH_BRIEFS_ROOT>/daily/` except `.gitkeep`, while preserving `<TECH_BRIEFS_ROOT>/meta/` and the database stored there.

The generated rows carry no demo flag or origin marker. To the application they are ordinary records, which is why safe configuration and avoiding production are the operator's responsibility.
