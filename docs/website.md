# Website

Served by `apps/web` (Astro standalone Node output). The guiding line is minimalism: a quiet,
modern content product, not a busy news portal and not an enterprise dashboard. Every
meaningful touchpoint makes clear that this is a short daily brief.

## Navigation

Implemented items: Today, Calendar, Statistics, and Feedback. Search is added later.
The admin route exists at `/admin` but is deliberately not promoted in public
navigation.

## Home page

The home page is centred on the latest published edition: the current Israel date,
the product headline, the latest brief's short metadata summary, its publication
date, and direct actions for reading it or opening the calendar. Two compact metrics
show the number of significant developments and the day's intensity. Earlier
editions are deliberately left to the calendar instead of repeated as a card feed.

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

Reads and renders that day's Markdown file in a readable layout. Structure of the
brief is in [`data-model.md`](data-model.md). Raw HTML is sanitized; source links are
hardened, open in a new tab, and show the source name rather than a long URL where
possible. Compact navigation to the previous and next published editions appears
when they exist. Metadata is not shown on the page.

## Calendar and archive

The Calendar opens a monthly view with two states per day:

- **Day with a page** — a day with published metadata. A quiet day is still a day
  with a page; its page shows a short "the day was quiet" note instead of being empty.
- **Day without a page** — not usable, not linked. Covers days before the system was
  set up, future days, and days deleted through the admin.

Each day with a page gets a visual intensity from `day_intensity`
(`minimal`, `low`, `medium`, `high`, `extreme`), so the calendar also works as a
historical heatmap of industry activity.

The calendar uses one Indigo scale: a deeper square means a more active day. It shows
only dates in the selected month and keeps the weekday grid visible. Month and year
have separate controls without a select menu; the year can also be typed directly, so
navigation is not limited to the period that already contains data. The view always
starts on the current Israel month after a fresh page load.

On desktop, hover or keyboard focus opens a compact summary popover. On touch devices,
the first tap selects the day and opens the same information below the grid, including
an explicit link to the daily brief. No essential content depends on hover.

## Statistics page

Built directly from published SQLite metadata, with no AI at page-load time. One
global range controls the whole page:

- **Last month** — the 30 complete Israel calendar dates before today; this is the
  default.
- **Last year** — the equivalent rolling 365-day window, not a named calendar year.

The page shows total editions and developments, a daily intensity trend, the ten most
frequent companies and topics by number of distinct days, and the distribution of
days across the five intensity levels. The trend spans the data actually available
inside the selected window, so a partial archive is not compressed into the end of an
otherwise empty year. Rankings use at most one count per value per day.

Comparative periods, arbitrary ranges, and AI-generated weekly or monthly summaries
remain outside the current scope.

## Search

Wanted but not required for the first version. Later it allows searching by company,
product, model, technology, topic, or free text, and shows the days a term appeared
together with the relevant development for each day.

## Branding and visual language

- Product name: **Daily Tech**. The logo is an abstract open brief built from two
  Indigo facets, with a restrained copper beacon representing the daily insight
  extracted from the news stream. The transparent SVG has separately tuned light
  and dark palettes; the same geometry is used in public/Admin headers and as the
  browser favicon. Interface language is Hebrew. Browser titles are intentionally
  limited to `Daily Tech` and `Daily Tech Admin`. The domain is not decided yet.
- Generous spacing, strong typography, and an Indigo foundation keep the interface
  quiet and content-led. Copper is a restrained contrast colour for selected primary
  headings and accents; semantic status colours remain reserved for success, warning,
  and failure states.
- The main archive views and Admin sit above a full-viewport animated faceted mesh.
  Semi-transparent frosted surfaces preserve depth without sacrificing legibility;
  denser Admin work surfaces use greater opacity. Motion is decorative, remains
  subtle, and is disabled when the browser requests reduced motion.

## Display mode

Light mode, dark mode, and a simple, prominent toggle between them.

## Mobile

Designed mobile-first: comfortable line length, typography suited to small screens,
thumb-friendly buttons, source links with a large enough tap area, a calendar usable
without hover, responsive charts, and simple, uncrowded navigation.

## Performance

Pages are rendered on demand with no AI or external API on a reader's request path.
A short process-local snapshot caches SQLite metadata and derived page data; Admin
writes and the embedded scheduler invalidate it immediately, while its configurable
TTL covers date rollover and out-of-process changes. Markdown is not scanned for
index pages and is read only when a specific daily edition is requested. A missing
file therefore fails that request without taking down the home, calendar, or
statistics pages. Public pages retain minimal browser JavaScript, SEO-friendly HTML,
and resilience when AI providers are down.
