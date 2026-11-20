# Custody Calendar

A rotating custody schedule planner, hosted at https://custody-calendar.com.

Enter the cycle (days with each parent, who starts, the start date or the moving parent's move date), toggle the holiday periods, and the page draws every month, lists every exchange, flags any stretch over the day limit, and saves the result as an .ics or .csv calendar file.

Everything runs in the browser. Nothing is uploaded.

## How it is built and served

- `index.html` is the page. `engine.js` is the schedule engine, shared with the server so both compute the same calendar. `account.js` is the account layer on the page: sign-in by email link, the shared calendar, drafts that become proposals, approvals, the record and the calendar feed.
- `server/pb_migrations` and `server/pb_hooks` are the PocketBase schema and routes for parent accounts (sign-in by email link, linking the other parent, proposals and approvals, the record, a private calendar feed), third-party viewers (an attorney or mediator invited by code sees the calendar, proposals and record read-only; either parent can end the access), and published calendar addresses (a .ics address for calendar apps made from the settings in a browser, without an account, updated by whoever holds its secret). Outgoing mail goes through ForwardEmail's HTTPS API (the droplet host blocks outbound SMTP).
- Hosting: a DigitalOcean droplet. Caddy serves the page from `/var/www/custody-calendar` and proxies `/api/` and `/_/` to PocketBase on the same host. A merge to `main` runs `.github/workflows/deploy.yml`, which copies the page and the server code over SSH and restarts PocketBase.
- Parents are two slots (M and F in the data) with a role each: mother, father or parent. Plan defaults are written in role words and resolved through the roles, so either parent can be Parent 1.

## Tests

- CI (`.github/workflows/check.yml`) syntax-checks the page, the engine and the server code and runs engine checks for the make-up modes, exchange rules, swaps, repeats and the proposal flow.
- `server/tests/run.sh [pocketbase-binary]` starts a throwaway PocketBase in a temp dir with the repo's migrations and hooks and runs `server/tests/e2e.mjs` against it: sign-in, family and join, proposals with answer-by dates, counter-offers, care requests, approvals, the feed. It removes the temp dir when done and never touches the live server.

## License

Copyright (c) 2026 Justin Nevins. All rights reserved. The source code is published for review only. See `LICENSE`.
