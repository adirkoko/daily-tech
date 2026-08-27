# Deployment

## Stack

| Concern | Choice |
| ------- | ------ |
| Frontend | Astro, static output |
| Styling | Tailwind CSS |
| Content | Markdown files |
| Metadata | SQLite |
| Storage | Filesystem on the host; path configurable |
| AI | OpenAI-compatible API behind an abstraction layer; model and provider swappable |
| Search | Brave Search by default, behind a swappable search port |

All public content pages build statically and do not require dynamic rendering per
request. AI is never part of a page reader's request path. `npm run publish:brief`
performs the safe publication transition and sends the configured deployment webhook;
the selected host must make the same content store available to its build.

## Implemented publication contract

1. The publisher targets the previous Israel calendar day unless `--date` is given.
2. A SQLite lease prevents overlapping publication attempts.
3. The ready Markdown artifact and metadata are deterministically revalidated.
4. The status changes atomically to `published` and `published_at` is set once.
5. `PUBLISH_WEBHOOK_URL` receives a `brief.published` POST event. An optional bearer
   token is supplied through `PUBLISH_WEBHOOK_TOKEN`.
6. A failed trigger is logged, creates a System ticket, and can be retried without
   changing the original publication time. A previously accepted trigger is a no-op.

## Open questions

1. **Where the content store lives.** Committed to the repo (a publish is a commit
   that triggers a rebuild) versus a persistent path on the host that the build reads
   from. A configurable host path points to the latter, but a static host needs the
   content available at build time.
2. **Hosting target.** A static host (Netlify / Vercel / Cloudflare Pages / GitHub
   Pages) versus a small VPS. The admin area and the contact form need a server
   component, so a purely static host implies a separate small backend.
3. **Scheduler target.** Host cron, a cloud scheduler, or a CI schedule for the
   `01:00` generation and `07:00` publication commands.
4. **Deployment provider.** Which provider owns `PUBLISH_WEBHOOK_URL` and whether it
   can read the content store directly or needs a synchronized copy.

## Secrets

The admin password and model API credentials live only in the server environment and
never reach the browser. `.env.example` lists every variable with a placeholder value.

The generation command is `npm run generate`. Required runtime variables are
`AI_API_KEY`, `AI_MODEL`, and `BRAVE_SEARCH_API_KEY`; `AI_BASE_URL` and
`TECH_BRIEFS_ROOT` are configurable. The command creates the metadata directory,
applies SQLite migrations, runs the previous-day pipeline, and closes the database on
both success and failure.

The publication command is `npm run publish:brief`. It needs
`PUBLISH_WEBHOOK_URL`; `PUBLISH_WEBHOOK_TOKEN`, `PUBLISH_WEBHOOK_TIMEOUT_MS`, and
`PUBLISH_LEASE_DURATION_MS` are optional. It does not need AI or search credentials.
