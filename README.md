# Custody Calendar

A rotating custody schedule planner, hosted at https://custody-calendar.com.

Enter the cycle (days with each parent, who starts, the start date or the moving parent's move date), toggle the holiday periods, and the page draws every month, lists every exchange, flags any stretch over the day limit, and saves the result as an .ics or .csv calendar file.

Everything runs in the browser. Nothing is uploaded.

## How it is built and served

- `index.html` is the page. `engine.js` is the schedule engine, shared with the server so both compute the same calendar. `account.js` is the account layer on the page: sign-in by email link, the shared calendar, drafts that become proposals, approvals, the record and the calendar feed.
- `server/pb_migrations` and `server/pb_hooks` are the PocketBase schema and routes for parent accounts (sign-in by email link, linking the other parent, proposals and approvals, the record, a private calendar feed).
- Hosting: a DigitalOcean droplet. Caddy serves the page from `/var/www/custody-calendar` and proxies `/api/` and `/_/` to PocketBase on the same host. A merge to `main` runs `.github/workflows/deploy.yml`, which copies the page and the server code over SSH and restarts PocketBase.
- Parents are two slots (M and F in the data) with a role each: mother, father or parent. Plan defaults are written in role words and resolved through the roles, so either parent can be Parent 1.

## License

Copyright (c) 2026 Justin Nevins. All rights reserved. The source code is published for review only. See `LICENSE`.
