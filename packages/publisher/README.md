# @daily-tech/publisher

Publishes one validated Daily Tech brief without calling an AI provider. The
standalone site reads content on demand, so local publication needs no rebuild.

The publisher:

1. Loads a `ready` brief for the requested date.
2. Acquires a durable SQLite lease so overlapping scheduler runs cannot publish the
   same publication concurrently.
3. Revalidates the Markdown bytes, path, metadata, links, and item counts.
4. Atomically changes the brief to `published` and sets `published_at`.
5. Finalizes the durable publication job locally.
6. Records completion, structured logs, and any failure as a System ticket.

The standalone site reads SQLite and Markdown on demand, so the status transition is
visible immediately and requires no external deployment trigger. A successfully
published date is a no-op on later runs.

## Command

From the repository root, with `.env` configured:

```sh
npm run publish:brief
```

The default target is the previous Israel calendar day. Operators can select an
explicit date or deterministic clock for recovery and testing:

```sh
npm run publish:brief -- --date=2026-08-27
npm run publish:brief -- --run-at=2026-08-28T04:00:00.000Z
```
