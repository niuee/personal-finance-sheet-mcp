# sheets-mcp

A personal [Model Context Protocol](https://modelcontextprotocol.io/introduction) server, deployed on Cloudflare Workers, that gives Claude web (via a custom connector) controlled access to one personal-finance Google Sheet. Access is locked to a single GitHub account via OAuth.

## Tools

- **list_tabs** — list the tabs in the spreadsheet with their row/column counts.
- **read_range** — read cell values from a tab using A1 notation; `mode` selects `formatted` (default), `raw` (unformatted numbers, for math), or `formulas`. Every returned row carries its real sheet row number (empty rows are omitted), so callers never have to count rows themselves.
- **append_rows** — append new rows below the existing data in a tab.
- **update_range** — overwrite cells in a range with new values. `expect_empty:true` refuses the write if any target cell is currently non-empty (for append-like writes); the response always includes `previousValues` (what was overwritten, with formulas) so a mistake can be reverted.
- **add_tab** — create a new empty tab.
- **add_expense** — log an expense into a monthly tab (defaults to the current month); a card param routes it into the 信用卡帳單對帳區.
- **month_summary** — get a month's numbers as clean JSON.
- **start_month** — open a new month by duplicating the previous month's tab.
- **add_trip_entry** — log a purchase into a trip tab's mosaic category block, discovering the block by title and choosing between jpy (¥-priced) or twd (NTD-direct) rows.
- **get_sheet_conventions** — read how the spreadsheet is organized.
- **insert_rows** — insert empty rows at a 1-indexed position.
- **find_cells** — find cells containing a text and get their exact A1 addresses, across one tab or every tab; the alternative to reading big ranges and counting rows.

## Auth architecture

Claude web talks to this server over OAuth, using [`workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) with GitHub as the identity provider; the callback rejects any GitHub login other than the one in `ALLOWED_GITHUB_LOGIN`. The server talks to Google using a service account: the spreadsheet is shared with the service account's email, and its private key is stored as a Worker secret (`GOOGLE_SA_PRIVATE_KEY`), never checked into the repo.

## Configuration

Secrets (`wrangler secret put <NAME>`):

- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — GitHub OAuth App credentials.
- `COOKIE_ENCRYPTION_KEY` — random string used to encrypt session cookies.
- `GOOGLE_SA_EMAIL` — the Google service account's email address.
- `GOOGLE_SA_PRIVATE_KEY` — the service account's private key (PEM).

Vars (in `wrangler.jsonc`):

- `SPREADSHEET_ID` — the target Google Sheet's ID.
- `ALLOWED_GITHUB_LOGIN` — the only GitHub username allowed to authenticate.

For local development, put these in a `.dev.vars` file at the repo root (never committed — it's gitignored).

## Commands

- `npm run dev` — run the server locally at `http://localhost:8788`.
- `npm test` — run the vitest suite.
- `npm run type-check` — run `tsc --noEmit`.
- `npm run deploy` — deploy to Cloudflare Workers.

To exercise the server locally, run `npx @modelcontextprotocol/inspector`, choose transport "Streamable HTTP", and point it at `http://localhost:8788/mcp`.

## More detail

- Full setup and deploy runbook: `docs/superpowers/plans/2026-07-02-sheets-mcp-server.md` (Tasks 0, 6, 7).
- Design and architecture rationale: `docs/superpowers/specs/2026-07-02-sheets-mcp-server-design.md`.
