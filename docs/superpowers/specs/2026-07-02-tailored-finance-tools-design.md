# Tailored Finance Tools (v2) — Design

**Date:** 2026-07-02
**Status:** Approved
**Builds on:** `2026-07-02-sheets-mcp-server-design.md` (v1, deployed at sheets-mcp.niuee.workers.dev)

## Goal

Add six tools tailored to how Vincent actually documents personal finance in
the spreadsheet, so Claude web can log expenses, summarize months, open new
month tabs, and log trip purchases correctly on the first try — without
rediscovering the sheet layout every conversation.

## The observed sheet layout (ground truth, verified 2026-07-02)

- **Monthly tabs** named `N 月` (with a space). Expense list in columns A–C
  (item / 美金 / 新臺幣) from row 3 down to a `花費總額` row containing
  `=SUM(C3:C24)` — a fixed window, so new expenses must be *inserted inside*
  it. USD rows convert via `=B{r}*GOOGLEFINANCE("CURRENCY:USDTWD")`.
  Row 3 `上月透支` pulls the previous month's overdraft via a cross-tab
  formula (e.g. `=IF(-'8 月'!B32 > 0, -'8 月'!B32, 0)`). A summary block at
  E5:F10 holds category sums over *hand-picked cells*
  (e.g. `訂閱費 = sum(C4,C5,…,C16)`, `本月額外雜支 = sum(C22,C3)`);
  `基本房租生活費` is a fixed amount, not a sum. Below the list: 總預算,
  沛還, 薪水, 剩餘 (`=sum(B28:B30)-C25`), 美金支付.
- **Trip tabs** (e.g. `2026/07/25 京都東京`): side-by-side category blocks
  (模型 at columns A–G, 書 at I–M, …) each with columns
  日期 / 店鋪 / 品項 / 支付方式 / 日幣原價 / 臺幣 0.22 匯率 / 臺幣 進位.
- **火車模型**: hobby purchase planner; monthly tabs may cross-reference it
  (`='火車模型'!C4`).
- All default reads return locale-formatted strings ("13,603.67"), which is
  hostile to math.

## Decisions made during brainstorming

- **Approach C (hybrid):** bespoke workflow tools that encode the layout,
  plus cheap generic primitives as an escape hatch.
- **`add_expense` updates category formulas:** the new cell is spliced into
  the chosen category's sum formula automatically.
- **`start_month` keeps fixed, clears one-offs:** recurring rows are defined
  by an explicit, editable item-name list in code — no heuristics.
- **Conventions live server-side, not in a claude.ai skill:** a
  `get_sheet_conventions` tool serves the layout knowledge. Rationale:
  claude.ai personal-account skills require manual zip re-upload on every
  change, while the MCP server auto-deploys on git push (Workers Builds).

## Components

### 1. `src/conventions.ts` — single source of truth

Exports (consumed by all bespoke tools):

- `MONTH_TAB_PATTERN` and helpers: `monthTabName(n)` → `"N 月"`,
  `currentMonthTab(now)` — resolves the tab for "this month".
- `TOTAL_ROW_LABEL = "花費總額"` — anchor for the expense window.
- `CATEGORIES`: map from short category name to the exact label text in the
  sheet (`訂閱費` → "訂閱費", `交通中餐雜支` → "交通中餐等等雜支",
  `額外雜支` → "本月額外雜支"). The category's formula cell is located at
  runtime by searching column E for the label (one column right of it) —
  never by hardcoded cell address, since the block has moved between months
  before (5月 differs from 6–9月). Default category for one-offs: `額外雜支`.
- `RECURRING_ITEMS`: string list seeded with: Google Cloud, ElevenLabs,
  iCloud, Google One, Netflix, ECSI Loan, Fed Loan, Cursor, 每月銀行管理,
  電話費, 公車儲值, 中餐, 荒野亂鬥月票, 中餐額外, ChatGPT,
  GitHub Action Minutes, Claude, 基本生活費, 上月透支.
- Trip-tab block geometry: how to find category headers and each block's
  column offsets (7 columns per block, one spacer column between blocks).
- `CONVENTIONS_TEXT`: human-readable description of all of the above (the
  payload of `get_sheet_conventions`).

Editing this file + `git push` is the upgrade path when the sheet layout
changes.

### 2. New tools (in `src/tools.ts`, alongside the existing five)

| Tool | Behavior |
|---|---|
| `add_expense(item, amount, currency: "TWD"\|"USD", category?, month?)` | Resolve month tab (default: current month). Locate the `花費總額` row; **insert one row above it** (inside the SUM window) via `insertDimension`; write item + amount — USD: B=amount, C=`=B{r}*GOOGLEFINANCE("CURRENCY:USDTWD")`; TWD: C=amount. Splice `C{r}` into the category's sum formula. Insert + writes + formula update happen in **one atomic `batchUpdate`**. Returns the row written and the updated category formula. |
| `month_summary(month?)` | Unformatted (`valueRenderOption=UNFORMATTED_VALUE`) read of: 花費總額, 剩餘, 上月透支, all category totals, 薪水, 沛還, 美金支付. Returns clean JSON numbers plus the tab name. |
| `start_month(month)` | The *previous month* is defined as month−1 of the target (January's previous is 12 月). `duplicateSheet` that previous tab (formulas intact) → rename to `N 月` → rewrite the `上月透支` formula to reference the previous tab → delete expense rows whose item is not in `RECURRING_ITEMS`. Returns lists of kept and cleared items. Refuses if the target tab already exists, and errors if the previous month's tab is missing. |
| `add_trip_entry(tab, category, date, shop, item, payment_method, jpy)` | Find the category block header in the trip tab; find the block's first empty row; write 日期/店鋪/品項/支付方式/日幣原價 plus the two TWD conversion columns following the block's existing pattern (copy the formula/rate style from the row above; if the block has no data rows yet, use the tab's stated rate). |
| `get_sheet_conventions()` | Returns `CONVENTIONS_TEXT`. |
| `insert_rows(tab, row, count)` | Generic `insertDimension` primitive (1-indexed row = insertion point; existing rows shift down). |

Also: **`read_range` gains an optional `mode` parameter**
(`formatted` (default) | `raw` | `formulas`) mapping to
`valueRenderOption` FORMATTED_VALUE / UNFORMATTED_VALUE / FORMULA.
Backward compatible.

### 3. `src/sheets-client.ts` additions

- `batchUpdate(requests: object[])` — generic wrapper over
  `spreadsheets.batchUpdate` (existing `addTab` refactors onto it).
- `getSheetId(title)` — resolves the numeric sheetId needed by
  `insertDimension` / `duplicateSheet` / `deleteDimension` (cached per
  request via `spreadsheets.get?fields=sheets.properties`).
- `readRange(range, renderOption?)` — passes `valueRenderOption`.

### 4. Error handling

Anchor-based and fail-closed. If a tool cannot find its anchor — the month
tab, the `花費總額` row, the category label/cell, the trip block header — it
returns a descriptive tool error naming exactly what it searched for and
**writes nothing**. Multi-step writes are single `batchUpdate` calls, so
there are no partial states. `start_month` refuses to overwrite an existing
tab.

### 5. Testing

- **Unit (vitest, mocked fetch):** formula splicing (existing
  `sum(C22,C3)` → `sum(C22,C3,C23)`), insert positioning relative to the
  `花費總額` anchor, USD vs TWD cell writes, recurring-row filtering for
  `start_month`, trip-block location and first-empty-row logic,
  `read_range` mode mapping, anchor-missing error paths.
- **Integration:** `bun run dev` + MCP Inspector against the **copy** sheet
  (same layout as the real one). Exercise every new tool, including
  `start_month` creating a fresh tab and `add_expense` with both currencies.
- **Acceptance (Claude web, real sheet):** "我今天中餐花了 250" lands in the
  current month correctly categorized; "how am I doing this month?" returns
  real numbers.

## Out of scope

- Editing or deleting existing expenses (v1's `update_range` covers it).
- 火車模型 planner tools (readable via generic tools; revisit if needed).
- Multi-currency beyond USD/TWD in monthly tabs and JPY in trip tabs.
- Any claude.ai skill upload.
