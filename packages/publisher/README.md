# @daily-tech/publisher

Publishes one validated Daily Tech brief and requests a site rebuild without calling
an AI provider.

The publisher:

1. Loads a `ready` brief for the requested date.
2. Acquires a durable SQLite lease so overlapping scheduler runs cannot trigger the
   same publication concurrently.
3. Revalidates the Markdown bytes, path, metadata, links, and item counts.
4. Atomically changes the brief to `published` and sets `published_at`.
5. Sends a bounded HTTP POST to the configured deployment webhook.
6. Records the accepted trigger, structured logs, and any failure as a System ticket.

A failed webhook can be retried safely. If the metadata transition already happened,
the retry keeps the original `published_at` and only triggers deployment again. A
successfully triggered date is a no-op on later runs.

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

The webhook receives:

```json
{
  "event": "brief.published",
  "runId": "publish-2026-08-27-...",
  "date": "2026-08-27",
  "publishedAt": "2026-08-28T04:00:00.000Z"
}
```

An HTTP success means the deployment provider accepted the trigger; it does not claim
that an asynchronous build has already completed.
