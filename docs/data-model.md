# Data Model

## File layout

```
tech_briefs/
├── meta/
│   └── tech_briefs.db
└── daily/
    └── 2026/
        └── august/
            └── 2026-08-27/
                └── 2026-08-27-tech_briefs.md
```

Path convention:

```
tech_briefs/daily/{year}/{month-lowercase-english}/{date}/{date}-tech_briefs.md
File name: YYYY-MM-DD-tech_briefs.md
```

The Markdown file is the source of truth for a day's content. The storage root is
configurable; `tech_briefs/` is the default.

## Brief structure (the Markdown file)

1. Day title.
2. Short summary of the day.
3. The meaningful developments — each a separate unit with: what changed / why it
   matters / what you can do with it / availability / sources.
4. A **Worth watching** section, when there are items that fit.
5. Navigation to the previous and next day, when they exist.

Source links open in a new tab and are shown by source name rather than a long URL
where possible. Metadata is not shown to the reader.

## SQLite — day metadata

```yaml
date: 2026-08-27          # unique day id, matches the file name
summary: ...              # 1-2 sentences; used on home, calendar, SEO, share cards
significant_items: 9      # number of meaningful developments in the brief
worth_watching_items: 1   # number of items in the "Worth watching" section
day_intensity: high       # drives the calendar heatmap and quality checks
companies: [...]           # companies appearing in the brief
topics: [...]              # main topics
developments: [...]        # short digests, for search / filtering / statistics
status: published          # lifecycle state
source_count: 40           # number of sources used while creating the brief
created_at: ...
published_at: ...
updated_at: ...            # last manual edit
```

Timestamps are ISO 8601 UTC values. `published_at` and `updated_at` are `null` until
the corresponding event occurs.

### Allowed values

- `day_intensity` ∈ `minimal | low | medium | high | extreme`
- `status` lifecycle: `draft -> ready -> published`, plus `failed` on error.

### Array fields

`companies`, `topics`, and `developments` are stored in normalized child tables with
an explicit position. This keeps their source order stable while allowing indexed
statistics and filtering without parsing JSON.

## Other stored data

The same database also holds user feedback tickets (including automated
`system`-category tickets), structured operational logs, and fixed-window rate-limit
counters for admin login attempts and feedback submissions. These tables are created
through the same ordered migration system as the daily metadata tables.
