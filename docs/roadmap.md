# Roadmap

## Current implementation status

| Area | Status |
| ---- | ------ |
| Core validation, SQLite schema, and lifecycle | Implemented and tested |
| Cited AI web research, writing, narrow gap check, and persistence | Implemented; production credentials still required |
| Hebrew website, archive, heatmap, and basic statistics | Implemented and tested |
| Safe local publication with a durable lease | Implemented and tested |
| Single standalone Node service | Implemented and integration-tested |
| Secure admin authentication and editing UI | Implemented and integration-tested |
| Public feedback, admin inbox, and in-admin alerts | Implemented and integration-tested |
| Embedded Israel-time scheduler and durable job leases | Implemented and tested |
| Health/readiness endpoints and one-service container | Implemented and tested |
| Production TLS and persistent storage configuration | Infrastructure configuration pending |

“Automatic” in the first-version list below includes both implemented application
commands and the implemented embedded scheduler; hosting configuration is still
deployment-specific.

## Required for the first version

- Automatic brief generation once a day.
- Cited web research and deterministic evidence validation.
- Brief written in Hebrew.
- Narrow significant-omission gap check.
- Deterministic code validation.
- Markdown storage.
- Metadata stored in SQLite.
- `status` lifecycle management.
- Automatic publishing at 07:00 Israel time.
- Home page.
- Daily brief page.
- Archive.
- Calendar with `day_intensity` heatmap.
- Basic statistics page.
- Working mobile layout.
- Automatic deploy to the cloud.
- Admin area with manual editing and delete / copy / save.
- Contact form and admin feedback inbox.
- System notifications.
- Operational logging.
- Modular AI layer through an OpenAI-compatible API.

## Deferred

- Search.
- Weekly summaries.
- Monthly summaries.
- Advanced trend and historical analysis.

## Development priority

1. **Daily brief quality** — good news selection, clear phrasing, reliable sources.
2. **Pipeline reliability** — evidence validation, gap check, failure handling.
3. **A useful archive** — daily pages and a calendar that accumulate into something
   valuable over time.
4. **Simple operations** — admin, logs, feedback, and the ability to fix problems
   without changing the architecture.

Search, advanced trends, and periodic summaries come only after the system runs
stably.

## Success metrics

Tracked over time:

- Consecutive days running without intervention.
- Manual fixes needed after publishing.
- Published items later found to be wrong.
- Times the gap check caught something significant.
- Site load time.
- Returning-visitor rate.
- Use of the archive, the calendar, and the statistics page.
- Average cost per daily brief.
