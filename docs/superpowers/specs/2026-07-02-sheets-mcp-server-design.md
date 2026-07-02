# Personal Finance Sheets MCP Server — Design

**Date:** 2026-07-02
**Status:** Approved

## Goal

A remote MCP server on Cloudflare Workers that lets Claude web (via a custom
connector) read, analyze, append to, and update one specific personal-finance
Google Sheet. Access is restricted to a single user via GitHub OAuth.

## Decisions made during brainstorming

- **Capabilities:** read data, append rows, update cells, minimal structure
  management (add tab). Formatting operations are out of scope for v1.
- **Claude → server auth:** OAuth with GitHub as the identity provider,
  allowlisted to one GitHub account. (Claude web custom connectors support
  only "no auth" or OAuth; static API keys are not an option.)
- **Server → Google auth:** Google Cloud service account. The sheet is shared
  with the service account's email; its key is a Worker secret.
- **Scope:** locked to one spreadsheet. The spreadsheet ID lives in Worker
  config; no tool accepts a spreadsheet ID parameter.
- **Approach:** scaffold from Cloudflare's official `remote-mcp-github-oauth`
  template (Agents SDK `McpAgent` + `workers-oauth-provider`), rather than
  hand-rolling the OAuth server or using a third-party hosted MCP server.

## Architecture

One Cloudflare Worker with three components:

1. **`workers-oauth-provider`** wraps the Worker and acts as the OAuth
   authorization server Claude web talks to: token issuance, dynamic client
   registration (required by Claude web), and grant storage in a KV namespace
   (`OAUTH_KV`, included in the template).
2. **GitHub OAuth handler** — the human login step of that flow. The user
   approves once in the browser. The Worker compares the authenticated GitHub
   login against a single allowlisted username from config and rejects anyone
   else.
3. **`McpAgent` Durable Object** — serves MCP over Streamable HTTP at `/mcp`
   and hosts the tools. It contains a small **Google Sheets client** module:
   - Signs a service-account JWT (RS256) with WebCrypto.
   - Exchanges it at Google's token endpoint for a ~1-hour access token,
     cached until shortly before expiry.
   - Calls the Google Sheets REST API with plain `fetch`. The official Google
     SDK is not used (it does not run on Workers, and only ~4 endpoints are
     needed).

### Data flow

Claude web connector → OAuth discovery + dynamic client registration →
browser redirect to GitHub → callback → `workers-oauth-provider` issues a
bearer token → MCP tool calls with that token → `McpAgent` tool handler →
Sheets client (cached Google access token) → Google Sheets REST API →
result returned to Claude.

## Tools

| Tool | Signature | Sheets API call | Notes |
|---|---|---|---|
| `list_tabs` | `()` | `spreadsheets.get` | Returns tab names and row/column counts so Claude can orient itself. |
| `read_range` | `(range)` | `values.get` | A1 notation, e.g. `Transactions!A1:F200`. Large results are truncated with an explicit note saying so. |
| `append_rows` | `(tab, rows)` | `values.append` | Appends below existing data. `valueInputOption=USER_ENTERED` so dates/numbers parse as if typed. |
| `update_range` | `(range, values)` | `values.update` | Tool description warns that this overwrites existing cells. `USER_ENTERED` mode. |
| `add_tab` | `(title)` | `spreadsheets.batchUpdate` | The one structure-management operation with clear value for v1. |

## Configuration

**Secrets** (via `wrangler secret put`):

- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — GitHub OAuth app credentials.
- `COOKIE_ENCRYPTION_KEY` — required by the template's approval-dialog cookie.
- `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY` — service account identity/key.

**Plain vars** (in `wrangler.jsonc`):

- `SPREADSHEET_ID` — the one finance spreadsheet.
- `ALLOWED_GITHUB_LOGIN` — the single GitHub username permitted access.

**One-time manual setup** (step-by-step checklist to be included in the
implementation plan):

1. Create a GitHub OAuth app (separate apps for local dev and production, per
   the template's convention).
2. Create a GCP project, enable the Google Sheets API, create a service
   account, and download a JSON key.
3. Share the finance spreadsheet with the service account's email as Editor.
4. Create the KV namespace, set secrets, deploy with `wrangler deploy`.
5. Add the deployed `/mcp` URL as a custom connector in Claude web and
   complete the GitHub login.

## Error handling

- Google API errors (bad range, unknown tab) are returned as MCP tool errors
  carrying the underlying Google message, so Claude can self-correct and
  retry.
- A failed Google token exchange is retried once, then surfaced as a tool
  error.
- Write tools echo back what the API reported (updated range / updated row
  count) so Claude can confirm to the user what actually changed.

## Testing

- **Unit (vitest):** service-account JWT signing and token caching against a
  mocked token endpoint; A1-range/input validation.
- **Integration:** `wrangler dev` locally, driving tools with the MCP
  Inspector against a *copy* of the finance sheet.
- **Acceptance:** connect Claude web to the deployed Worker; have it read a
  tab, append a test row, and verify the row appears in the sheet.

## Out of scope for v1

- Formatting/styling operations, column insertion, tab deletion.
- Multiple spreadsheets.
- Any identity provider other than GitHub; more than one allowed user.
