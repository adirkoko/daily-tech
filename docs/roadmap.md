# Roadmap

## Current implementation status

| Area | Status |
| ---- | ------ |
| Core validation, SQLite schema, and lifecycle | Implemented and tested |
| AI research, writing, review, missing-news check, and persistence | Implemented; production credentials still required |
| Static Hebrew website, archive, heatmap, and basic statistics | Implemented and tested |
| Safe publication command and deployment webhook | Implemented and tested |
| Production scheduler, hosting, and content-store synchronization | Deployment decision pending |
| Admin authentication and editing UI | Not started |
| Public feedback form and admin inbox UI | Not started; storage primitives exist |

“Automatic” in the first-version list below includes both implemented application
commands and the still-pending production scheduler/hosting configuration.

## Required for the first version

- Automatic brief generation once a day.
- Research and filtering of developments.
- Brief written in Hebrew.
- Editorial review.
- Missing-news check.
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
2. **Pipeline reliability** — review, missing-news check, validation, failure handling.
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
- Times the missing-news check caught something significant.
- Site load time.
- Returning-visitor rate.
- Use of the archive, the calendar, and the statistics page.
- Average cost per daily brief.
