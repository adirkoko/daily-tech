# Website

Served by `apps/web` (Astro standalone Node output). The guiding line is minimalism: a quiet,
modern content product, not a busy news portal and not an enterprise dashboard. Every
meaningful touchpoint makes clear that this is a short daily brief.

## Navigation

Implemented items: Today, Calendar, Statistics, and Feedback. Search is added later.
The admin route exists at `/admin` but is deliberately not promoted in public
navigation.

## Home page

The center of the page shows the site name and logo, the current date, a short
sentence summarizing the character of the day, a primary button ("Read today's
update"), and a short, prominent note that this is a short daily brief.

- **Today's brief not published yet** — when generation has not finished or the brief
  is waiting to publish, the page does not link to a broken target. It shows a state
  such as "Today's update is still in preparation" alongside a link to the last
  published brief.
- **Failure** — when generation or research failed and there is no valid brief, the
  page shows a short note that there was a problem, with no technical detail and no
  partial file.

## Daily brief page

Fixed address per day:

```
/daily/YYYY-MM-DD
```

Renders that day's Markdown file in a readable layout, marked clearly as a short daily
brief. Structure of the brief is in [`data-model.md`](data-model.md). Source links are
clickable, open in a new tab, and show the source name rather than a long URL where
possible. Navigation to the previous and next day appears when those days exist.
Metadata is not shown on the page.

## Calendar and archive

The Calendar opens a monthly view with two states per day:

- **Day with a page** — a day inside the system's active period with a valid record.
  A quiet day is still a day with a page; its page shows a short "the day was quiet"
  note instead of being empty.
- **Day without a page** — not usable, not linked. Covers days before the system was
  set up, future days, and days deleted through the admin.

Each day with a page gets a visual intensity from `day_intensity`
(`minimal`, `low`, `medium`, `high`, `extreme`), so the calendar also works as a
historical heatmap of industry activity.

The current calendar uses color and a top marker for intensity. Desktop hover exposes
the summary, development count, and main companies through the native tooltip. On
mobile, tapping a published day opens its accessible daily page directly, so no
content depends on hover.

## Statistics page

Built directly from the SQLite metadata, with no AI at page-load time.

Implemented in the basic statistics page:

- Total briefs and developments.
- Average source count.
- Count of high/extreme days.
- Top companies and topics.
- Distribution by day intensity.

Planned extensions after the basic page:

- Activity per company — number of developments each company appeared in.
- Activity over time — developments per day, or day intensity.
- Most active company — by week, month, year, or all time.
- Most significant days — days marked `high` or `extreme`.
- This week vs. last week — comparison of development counts.

Planned time ranges for those extended charts: 7 days, 30 days, 90 days, 1 year, all
time.
AI-generated weekly or monthly summaries are not part of the MVP.

## Search

Wanted but not required for the first version. Later it allows searching by company,
product, model, technology, topic, or free text, and shows the days a term appeared
together with the relevant development for each day.

## Branding and visual language

- Product name: **Daily Tech**. Logo: a geometric monogram based on D / T. Interface
  language: Hebrew. The domain is not decided yet.
- Plenty of white space, strong typography, few colors, emphasis on text and content,
  few cards and superfluous UI elements, subtle animations only, and a consistent
  reminder that briefs are short.

## Display mode

Light mode, dark mode, and a simple, prominent toggle between them.

## Mobile

Designed mobile-first: comfortable line length, typography suited to small screens,
thumb-friendly buttons, source links with a large enough tap area, a calendar usable
without hover, responsive charts, and simple, uncrowded navigation.

## Performance

Pages are rendered on demand from local SQLite and Markdown with minimal browser
JavaScript. This keeps admin changes immediately visible while retaining fast loads,
SEO-friendly HTML, and resilience when AI providers are down. No AI or external
API runs on a reader's request path.
