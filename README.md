# sheets-mcp

A personal [Model Context Protocol](https://modelcontextprotocol.io/introduction) server, deployed on Cloudflare Workers, that gives Claude web (via a custom connector) controlled access to one personal-finance Google Sheet. Access is locked to a single GitHub account via OAuth.

## Tools

- **list_tabs** — list the tabs in the spreadsheet with their row/column counts.
- **read_range** — read cell values from a tab using A1 notation; `mode` selects `formatted` (default), `raw` (unformatted numbers, for math), or `formulas`. Every returned row carries its real sheet row number (empty rows are omitted), so callers never have to count rows themselves.
- **append_rows** — append new rows below the existing data in a tab.
- **update_range** — overwrite cells in a range with new values. `expect_empty:true` refuses the write if any target cell is currently non-empty (for append-like writes); the response always includes `previousValues` (what was overwritten, with formulas) so a mistake can be reverted.
- **add_tab** — create a new empty tab.
- **add_expense** — log an expense into a monthly tab (defaults to the current month); a card param routes it into the 信用卡帳單對帳區.
- **set_expense_date** — date an existing expense row (dropping a card row into its 對帳區 bucket), growing the bucket when full.
- **delete_expense** — remove an expense row from a monthly tab entirely (scoped to columns A-G, leaving the neighbouring blocks in place); returns the deleted cells. On budget months it removes a block entry; `tag` narrows the search to one block.

Every write to a monthly tab (add_expense, add_lunch, set_expense_date, delete_expense, set_income, adjust_balance, add_transfer) also audits ALL 信用卡帳單對帳區 buckets and grows any whose mirror has outgrown its spill area — so rows typed straight into the UI, which trigger no tool write of their own, are healed by the next tool write of any kind.
- **month_summary** — get a month's numbers as clean JSON.
- **start_month** — open a new month by duplicating the previous month's tab, rolls the 信用卡帳單對帳區 forward, and pads every card bucket's spill area to 20 blank rows of headroom. When a `Budget Based` tab exists it builds a budget month by copying that template instead; `replace_old_layout` rebuilds an existing old-layout month and keeps the old tab as `N 月 DEP`.
- **add_trip_entry** — log a purchase into a trip tab's mosaic category block, discovering the block by title and choosing between jpy (¥-priced) or twd (NTD-direct) rows.
- **trip_budget_status** — read a trip tab's 目前實際開銷 budget-vs-actual summary: per-分類 spent / budget / remaining (NTD and JPY) plus totals.
- **get_sheet_conventions** — read how the spreadsheet is organized.
- **insert_rows** — insert empty rows at a 1-indexed position.
- **delete_rows** — delete rows outright (the row goes, everything below moves up), optionally scoped to a column band so the blocks beside it stay put; returns `deletedValues` and refuses when a formula points straight at a deleted cell (`force` overrides).
- **find_cells** — find cells containing a text and get their exact A1 addresses, across one tab or every tab; the alternative to reading big ranges and counting rows.

### Budget months

From 11 月 2026 on, month tabs use a budget layout. Every category has a USD and an NTD side: two budget rows per category (`<類別>美金預算`, `<類別>新臺幣預算`), and a block per category where its expenses are logged, topped by a 美金 row and a 新臺幣 row of 編列預算 / 總和 / 剩餘 (USD in USD, NTD in NTD), above an open-ended list. A single 本月匯率 cell below the budget list does every conversion (live until the 1st, then locked to the 1st's rate). Then come the income list, a 本月美金收支狀況 line (in USD) and a 本月新臺幣收支狀況 line built the same way (income − last month's overdraft − that currency's budget rows + that currency's overspend, 本月美金超支 / 本月新臺幣超支), and a 乾坤大挪移 log after the last block. `start_month` builds these months by copying the `Budget Based` template tab.

On budget months `add_expense` (tag required, card refused), `delete_expense`, `set_income`, `add_transfer`, `month_summary` (returns `layout: "budget"`) and `get_categories` (returns the blocks) work; `add_lunch`, `set_expense_date` and `adjust_balance` refuse, since budget months have no lunch log, card buckets or bank-balance sections. 5 月–10 月 keep the old layout and every tool behaves there as before.

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

## Deploying to a Cloudflare account

Nothing in `wrangler.jsonc` is tied to a specific Cloudflare account, so the same steps set the server up in a fresh account or move it to another one.

1. **Connect the repo.** In the account's dashboard, go to Workers & Pages → Create application → GitHub, pick this repo, and keep the Worker name `sheets-mcp` and the production branch `main` (Workers Builds then deploys every push to `main`). Or deploy once by hand with `npx wrangler login` and `npm run deploy`.
2. **KV is created for you.** The `OAUTH_KV` binding has no ID on purpose: the first deploy into an account creates the namespace (named after the Worker) and later deploys keep reusing it.
3. **Set the secrets** listed under Configuration, with `npx wrangler secret put <NAME>` or in the dashboard under the Worker's Settings → Variables and Secrets. The server returns errors until all five are set.
   - `GOOGLE_SA_EMAIL` / `GOOGLE_SA_PRIVATE_KEY`: the same service account as before, so the spreadsheet needs no new sharing.
   - `GITHUB_CLIENT_SECRET`: GitHub never shows an existing secret again, so generate a new one in the OAuth App.
   - `COOKIE_ENCRYPTION_KEY`: any fresh random string (`openssl rand -hex 32`).
4. **Point the GitHub OAuth App at the new URL.** The Worker's address is `https://sheets-mcp.<account-subdomain>.workers.dev` (the subdomain is shown under Workers & Pages). Set the OAuth App's Homepage URL to it and its Authorization callback URL to `…/callback`.
5. **Reconnect Claude.** Remove the old custom connector and add one for `https://sheets-mcp.<account-subdomain>.workers.dev/mcp`, then sign in with GitHub again. OAuth grants live in the old account's KV and don't carry over.
6. **Retire the old account's copy** once the new one works: disconnect its Workers Builds from this repo under the Worker's Settings → Builds (otherwise each push to `main` deploys to both), then delete its `sheets-mcp` Worker and its `OAUTH_KV` namespace.

## More detail

- Full setup and deploy runbook: `docs/superpowers/plans/2026-07-02-sheets-mcp-server.md` (Tasks 0, 6, 7).
- Design and architecture rationale: `docs/superpowers/specs/2026-07-02-sheets-mcp-server-design.md`.
