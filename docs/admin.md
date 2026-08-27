# Admin & Security

## Login

A small login page is reachable from the site. Login is by **password only**, with no
username.

## Editing content and metadata

After login, the admin area allows:

- Opening the day's Markdown file as text and editing the whole content.
- Editing that day's metadata in SQLite.

## Actions

Every edit page has three actions:

1. **Delete** — remove the day's file and its metadata record. The day then shows as a
   "day without a page" on the calendar.
2. **Copy** — copy the file content.
3. **Save** — persist the changes, and set `updated_at` to the time of the save.

Every administrative action is written to a short log.

## Security

- The admin password and all other secrets exist only in the server environment and
  are never sent to the browser.
- Rate limit: up to **3 login attempts per IP** within a fixed window of `X` hours.
  `X` is set at deployment time.
- Counters reset automatically on a fixed time window, not a per-user timer.
- A simple server command / script (`scripts/`) resets all login-attempt counters.
- The mostly-static site keeps the attack surface and server load small.

## Open point

The session mechanism after a successful login (signed cookie, server session) is not
decided. Whatever is chosen keeps secrets server-side.
