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

Most pages build statically and do not require dynamic rendering per request. AI is
never part of a page reader's request path. After a brief is published the site
updates automatically.

## Open questions

1. **Where the content store lives.** Committed to the repo (a publish is a commit
   that triggers a rebuild) versus a persistent path on the host that the build reads
   from. A configurable host path points to the latter, but a static host needs the
   content available at build time.
2. **Hosting target.** A static host (Netlify / Vercel / Cloudflare Pages / GitHub
   Pages) versus a small VPS. The admin area and the contact form need a server
   component, so a purely static host implies a separate small backend.
3. **Scheduler.** Host cron, a cloud scheduler, or a CI schedule for the `01:00`
   generation and the `07:00` publish.
4. **Rebuild trigger.** How `status = published` becomes a deployed site — build
   hook, webhook, or CI job.

## Secrets

The admin password and model API credentials live only in the server environment and
never reach the browser. `.env.example` lists every variable with a placeholder value.

The generation command is `npm run generate`. Required runtime variables are
`AI_API_KEY`, `AI_MODEL`, and `BRAVE_SEARCH_API_KEY`; `AI_BASE_URL` and
`TECH_BRIEFS_ROOT` are configurable. The command creates the metadata directory,
applies SQLite migrations, runs the previous-day pipeline, and closes the database on
both success and failure.
