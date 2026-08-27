# @daily-tech/db

Typed SQLite persistence for Daily Tech, built on `better-sqlite3`.

## Responsibilities

- Apply ordered, transactional schema migrations.
- Store scalar day metadata in `daily_briefs`.
- Store companies, topics, and development digests in normalized child tables.
- Enforce allowed statuses, intensities, non-negative counts, and foreign keys in
  SQLite as a second line of defense after `@daily-tech/core` validation.
- Hydrate stored rows back into validated `DayMetadata` objects.
- Store structured operational events and filter them by run, date, and severity.
- Store feedback/System tickets and their open/resolved lifecycle.
- Atomically count admin-login and feedback attempts inside fixed rate-limit windows.

## Usage

```ts
import { DailyTechDatabase } from "@daily-tech/db";

const database = DailyTechDatabase.open({
  filename: "tech_briefs/meta/tech_briefs.db",
});

database.saveDay(metadata);
const latest = database.listDays({ status: "published", limit: 30 });
const failures = database.operations.listTickets({
  category: "system",
  status: "open",
});
database.close();
```

File-backed writable databases use WAL mode and a five-second SQLite busy timeout.
Foreign keys are always enabled. Callers should keep one instance open for the
lifetime of a process and close it during graceful shutdown.

Reset all rate-limit counters with `npm run rate-limits:reset`, or only one scope with
`npm run rate-limits:reset -- --scope=feedback`.
