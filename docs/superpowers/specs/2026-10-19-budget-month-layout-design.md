# Budget-based month tabs — Design

**Date:** 2026-10-19
**Status:** Draft, awaiting approval

## Context

Monthly tabs are moving from one long expense list to a budget layout:
every 類別 gets a budget and its own block where that category's
expenses are logged, and each block shows 編列預算 / 總和 / 剩餘. Vincent
built the layout by hand in the **"Budget Based"** tab (titled 12 月花費,
wired to 11 月), and it was reworked in the conversation that produced
this document; those sheet edits are already done, so the tab is the
reference for everything below.

The MCP tools only understand the old layout (expense list in A–G,
銀行餘額, 帳戶實際數字對應, 信用卡帳單對帳區, 午餐預算 log). This design
makes the monthly tools work on budget months and leaves 5 月–11 月,
which stay on the old layout, working exactly as today.

## Decisions already made (Vincent's)

1. Keep the per-category block layout from the "Budget Based" tab. Expenses
   are logged straight into their category's block. No single expense list.
2. Each block's 總和 sits above the block's list and adds the whole column
   down (`=SUM(J7:J)` style), so a block grows without any insert logic,
   by tool or by hand. Nothing else may live below the blocks.
3. A block's 4th column is **幣別** (USD/TWD), not the card.
4. One USD→TWD rate per month, in a single **本月匯率** cell. Every
   conversion on the tab references it; nothing uses a live
   `GOOGLEFINANCE` directly.
5. 本月匯率 is a formula that shows today's live rate until the 1st of the
   month, then locks to the 1st's rate (see *Rate formula*).
6. **本月美金收支狀況** = the USD account's own month, in USD: USD income −
   上月美金透支 − every block entry marked USD. No conversion.
7. **本月新臺幣收支狀況** = TWD income − 上月新臺幣透支 − the budget lines
   whose 支付幣別 is TWD − the 乾坤大挪移 手續費 total. 沛還 (USD) stays on
   the USD side only.
8. 上月新臺幣透支 carries the previous month's negative 本月新臺幣收支狀況,
   the same way 上月美金透支 carries the USD side.
9. Card reconciliation (信用卡帳單對帳區), 銀行餘額 and 帳戶實際數字對應
   are **dropped** from budget months.
10. 乾坤大挪移 (NTD→USD transfers) stays, to the right of the last block,
    built the same way as a block (total on top, list grows down).
11. `start_month` must create budget months from this layout and set up
    本月匯率.

## The budget-month layout

As it stands in "Budget Based" today. Row numbers describe the current
tab; the tools must locate everything by its labels, like the rest of
this codebase, never by fixed rows.

**Left side (A–F)**

| Where | What |
|---|---|
| A1 | Title, `N 月花費` |
| B3 / D3 / E3 / F3 | 上月美金透支: D = `=IF(-('prev'!D<收支狀況 row>) > 0, -(…), 0)` against the previous month's 本月美金收支狀況; E = `=D3*$C$15`; F = USD |
| B4 / E4 / F4 | 上月新臺幣透支: E = same shape against the previous month's 本月新臺幣收支狀況; F = TWD |
| B5:F13 | Budget list, one row per category: B = `<類別>預算` (e.g. 購物預算, 中餐預算), C = 類別, D = USD amount (USD budgets only), E = NTD amount (`=D*$C$15` for USD budgets), F = 支付幣別 |
| D14 / E14 | 預算總額 `=sum(E5:E13)` (excludes the two 透支 rows) |
| B15 / C15 / D15 | **本月匯率** label, the rate, a "← 月初更新" note |
| B26 | 總預算 (income section title) |
| B27:D27 | Income header 項目 / 幣別 / 金額 |
| B28:D31 | Income rows (薪水 TWD today; 沛還 USD goes here too). D32/D33 read C28:C31 / D28:D31 |
| B32 / D32 | 本月美金收支狀況 (decision 6) |
| B33 / D33 | 本月新臺幣收支狀況 (decision 7) |
| B35 / D35 | 本月超支 = sum of the negative block 剩餘 |
| B36 / D36 | 本月超支（加上回補） = sum of every block 剩餘 |
| B40 / D40 | 總支出 = sum of the nine block 總和 + 乾坤大挪移 手續費 total |

**Category blocks (H–AY).** Nine blocks, 4 columns each plus a spacer
column: 午餐 H–K, 購物 M–P, 吃喝 R–U, 生活用品 W–Z, 訂閱 AB–AE, 交通 AG–AJ,
娛樂 AL–AO, 學貸 AQ–AT, 其他 AV–AY. For a block starting at column `s`:

| Row | Content |
|---|---|
| 2 | Title `<category>支出` in `s` (午餐支出, 購物支出, …) |
| 3 | 編列預算 (merged `s:s+1`), 剩餘 (負數會加回去支出） (merged `s+2:s+3`) |
| 4 | `s`: `=INDEX($E3:$E23, MATCH("<類別>預算", $B3:$B23, 0))`; `s+2`: `=s4 - (s+2)5` |
| 5 | `s+1`: 總和; `s+2`: `=SUMIF(<幣別>7:<幣別>,"<>USD",<金額>7:<金額>)+SUMIF(<幣別>7:<幣別>,"USD",<金額>7:<金額>)*$C$15` |
| 6 | Header 日期 / 項目 / 金額 / 幣別 |
| 7+ | Entries, open-ended. A blank 幣別 counts as TWD. Rows 7–8 carry a pre-typed "TWD" in 幣別 |

Rows 3–4 are merged cells: writes into `s+1` / `s+3` on those rows are
silently dropped by Sheets, which is why 總和 sits on row 5.

The 午餐 block is the one name mismatch: its title is 午餐支出 but its
budget line is 中餐預算 (類別 中餐). Treat 午餐 and 中餐 as the same
category, as the old 午餐預算 / 中餐預算 anchors already do.

**乾坤大挪移 (BA–BG).** Title in BA2; row 5: BA "總和", BB–BG
`=SUM(<col>7:<col>)`; row 6 header 日期 / 新臺幣 / 當下美金 / 實際美金 /
匯差 / 手續費 / 當筆總額外花費; entries from row 7 down, open-ended. Per-row
formulas are the same as today's `add_transfer` writes (rate pinned at
entry). The tab is 62 columns wide (to BJ).

## Goals

- `start_month` creates budget months (see below).
- `add_expense`, `delete_expense`, `set_income`, `add_transfer`,
  `month_summary` and `get_categories` work on budget months.
- Old-layout months (5 月–11 月) keep working exactly as today, with
  every existing test still passing.
- `get_sheet_conventions` and the README describe the budget layout.

## Non-goals

- Migrating 5 月–11 月 to the budget layout.
- Card reconciliation, bank balances or reconciliation adjustments in
  budget months.
- A tool to change budget amounts. Budgets are edited by hand in the
  budget list. *(My call.)*
- Number formatting beyond what tab duplication carries over.

## Anti-goals

- **No whole-row inserts or deletes on a budget tab.** The budget list,
  income list and the nine blocks share sheet rows; a whole-row
  operation tears through all of them. Every insert/delete is scoped to
  one section's own columns (`bandInsert` / band-scoped `deleteRange`,
  as the old layout already does for its sections).
- **Nothing written below a block or below 乾坤大挪移 except entries.**
  Anything else in those columns would be counted by the open-ended 總和.
- **No live rate on the tab.** All conversions reference 本月匯率.

## Telling budget months apart

A month tab is a budget month when its column B contains 本月匯率. *(My
call; the builder may pick another anchor unique to the layout.)* Every
monthly tool checks this first and branches. Old-layout code paths stay
as they are.

## Tool behavior on budget months

**Refused, with a clear message.** `add_lunch` (lunches are entries in
the 午餐 block, via `add_expense`), `set_expense_date` (no card buckets
to drop into), `adjust_balance` (no bank-balance blocks), and
`add_expense`'s `card` param.

**`add_expense`.**
- `tag` is required and picks the block (`中餐` and `午餐` both mean the
  午餐 block). An unknown tag errors and lists the available categories.
- Writes 日期 (optional, stamped mm/dd as today), 項目, 金額 and 幣別 into
  the block's first entry row whose 日期, 項目 and 金額 are all empty;
  the pre-typed "TWD" in 幣別 doesn't count as content. 幣別 is always
  written explicitly.
- Entries are appended, not date-sorted. *(My call: blocks are short and
  the 總和 doesn't care about order.)*
- 幣別 means **the currency of the account that paid**, because
  本月美金收支狀況 treats every USD entry as USD-account spending. A
  USD-priced expense paid from the NTD account (today's `currency: USD,
  paid_with: TWD`, e.g. Claude $200 on 國泰 CUBE) is written as 幣別 TWD
  with 金額 `=<usd>*$C$15` (the 本月匯率 cell, found by label). *(My
  call.)* TWD-priced + USD-paid stays rejected, as today.

**`delete_expense`.** Finds an entry by exact 項目 across all blocks'
entry rows. Gains an optional `tag` param to narrow it to one block; a
row number alone is ambiguous on a budget tab, because every block has
its own entries on the same sheet rows. Deletes with a `deleteRange`
scoped to that block's 4 columns (`shiftDimension: ROWS`), so the
entries below move up and no other block moves. Returns the deleted
cells, as today.

**`set_income`.** Upserts by 項目 inside the income window (rows between
the 項目/幣別/金額 header under 總預算 and the 本月美金收支狀況 row). It
fills an empty window row first. When the window is full, it inserts
inside the window with an A–F band-scoped `insertRange`, so the SUMIF
ranges in 本月美金收支狀況 / 本月新臺幣收支狀況 extend and no block moves.

**`add_transfer` (currency USD).** Finds the 乾坤大挪移 section by its
title, writes into the first empty entry row with today's per-row
formulas and entry-time rate pinning, and never rewrites the 總和 row
(it's open-ended). The 手續費 total already flows into 總支出 and
本月新臺幣收支狀況.

**`add_transfer` (currency jpy, trip tabs).** When the transfer's date
falls in a budget month, skip the month wiring (the old 銀行餘額 rows it
appends to don't exist) and say so in the result. *(My call; trip
transfers into budget months can be designed when a trip needs it.)*

**`month_summary`.** Returns `layout: "budget"` and, read by labels:
本月匯率; 上月美金透支 and 上月新臺幣透支; per block `{ category,
編列預算, 總和, 剩餘 }`; 預算總額; the income list `{ item, currency,
amount }`; 本月美金收支狀況; 本月新臺幣收支狀況; 本月超支; 本月超支（加上回補）;
總支出; and the 乾坤大挪移 totals. The old-layout shape is unchanged.

**`get_categories`.** On budget months, returns the block categories
(from the block titles, 午餐 reported as 中餐 to match the budget list)
instead of reading a 類別 dropdown, which budget tabs don't have.

## start_month on budget months

When the previous month is a budget month:

1. Duplicate it, as today. Refuse if the new tab already exists, as today.
2. Write the title `N 月花費`.
3. Point 上月美金透支 (D) and 上月新臺幣透支 (E) at the previous tab's
   本月美金收支狀況 / 本月新臺幣收支狀況 value cells, found by label, with
   the same `=IF(-(cell) > 0, -(cell), 0)` shape as today's carries.
4. Write the 本月匯率 formula (below) for the new month.
5. **Entries:**
   - In every block, keep the entries whose 項目 is in `RECURRING_ITEMS`
     and clear their 日期.
   - Delete every other entry, bottom-up, with block-scoped
     `deleteRange`s.
   - The 午餐 block is always emptied. Lunch entries reuse the names
     中餐 / 午餐, and `RECURRING_ITEMS` lists 中餐 for the old budget row.
6. **乾坤大挪移:** clear every entry row's cells; don't delete them.
7. **Income:** keep 薪水 and 沛還 (`RECURRING_INCOME`) and clear the
   other income rows' cells instead of deleting them, so the window keeps
   its size. *(My call.)*
8. Budgets, block formulas and everything else carry over through the
   duplication.

Return what was kept and what was cleared, per block, like today's
`kept` / `cleared`.

## Rate formula

`start_month` writes, for month `M` of year `Y`:

```
=IF(TODAY()<=DATE(Y,M,1),
    GOOGLEFINANCE("CURRENCY:USDTWD"),
    INDEX(GOOGLEFINANCE("CURRENCY:USDTWD","price",DATE(Y,M,1)),2,2))
```

- Up to and including the 1st it shows the live rate. From the 2nd on, it
  is locked to the 1st's close.
- Checked on the live sheet on 2026-10-19:
  - A future 1st (2026-11-01) showed the live rate (32.4795).
  - 2026-10-01 gave 31.9018.
  - Weekend 1sts (2026-08-01 Sat, 2026-02-01 Sun, 2026-03-01 Sun) all
    returned a rate.
- **Year:** the Taipei current year if `M` is the current Taipei month
  or later, otherwise the next year (months are created ahead of time,
  never after they end).
- **No IFERROR fallback.** If Google's historical lookup fails, the error
  should show rather than quietly fall back to a drifting live rate.
  *(My call.)*
- The "Budget Based" tab's C15 holds a typed placeholder (32.4607) today.

## Open question: the first budget month (Vincent's call)

The template is December (titled 12 月花費, carries wired to 11 月), but
an old-layout **"12 月"** tab already exists, and 11 月 is old layout, so
`start_month(12)` can't duplicate a budget month.

Proposal: Vincent renames the old "12 月" to "12 月 DEP" (the 6 月 DEP
precedent) and renames "Budget Based" to "12 月", by hand. The first
budget month is then created without any tool code, and from 1 月 on
`start_month` just duplicates the previous budget month.

For this one-off, 本月匯率 in 12 月 would be set to the formula by hand
(or by a one-line `update_range`).

`start_month` refuses with a clear message when the previous month is
old layout and the new month would be a budget month. (How it would know
to build a budget month without a template is exactly the problem the
manual rename avoids.)

## Left to the builder

- Finder structure (a `findBudgetBlocks` returning each block's columns,
  title, 總和 / header / first-entry rows; `findBudgetTransferSection`;
  label lookups for the left-side rows).
- Exact error wording, and the result shapes beyond the fields listed
  above.
- How the budget code paths are factored next to the old ones.

## Testing

- Build a fixture grid that mirrors the "Budget Based" tab (formulas
  included). Use the existing `fakeClient(grid)` pattern in
  `test/finance-ops.test.ts`.
- Cover:
  - detection
  - block discovery, including the 午餐/中餐 alias
  - first-empty-row choice, ignoring the pre-typed TWD
  - `add_expense`, including USD paid with TWD
  - the refused tools
  - `delete_expense`, including the `tag` disambiguation
  - `set_income` filling and band-scoped growth
  - `add_transfer` placement
  - `month_summary` fields
  - `get_categories`
  - every `start_month` step, checking that every insert/delete is
    band-scoped
- All existing old-layout tests keep passing unchanged.
- After deploy, a manual check on the real budget month:
  1. `month_summary`
  2. `add_expense` of a throwaway entry (TWD, and USD)
  3. `delete_expense` of that entry
  4. `month_summary` again shows the original numbers

## Docs

- `src/conventions.ts` (`get_sheet_conventions` text): a BUDGET MONTHS
  section describing the layout, the rate cell, both 收支狀況 lines, and
  which tools apply.
- `README.md` tool list: note which tools work on budget months and which
  refuse.
