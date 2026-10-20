# Budget-based month tabs — Design

**Date:** 2026-10-19 (updated 2026-10-20)
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
makes the monthly tools work on budget months. 11 月 2026 is the first
budget month: the existing old-layout 11 月 and 12 月 are rebuilt from the
template (see *Rollout*). 5 月–10 月 stay on the old layout and keep working
exactly as today.

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
11. `start_month` builds every budget month by **copying the "Budget
    Based" tab, which is the template**. It does not copy the previous
    month.
12. The template's block entries are the **starting entries** every month
    begins with. They were agreed item by item (see *Template contents*).
    Every budget covers its category's starting entries, so no category
    starts the month over budget.
13. Each budget line has its own currency (its 支付幣別). A USD budget line
    is entered in USD and converted at 本月匯率. Today 學貸 ($429.93) and
    其他 ($15) are USD; the rest are NTD.
14. 11 月 and 12 月 become budget months too. `start_month` rebuilds them
    from the template, the old versions are kept as **"11 月 DEP"** and
    **"12 月 DEP"**, and their planned one-off entries are re-added to the
    new tabs.

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
| B28:D31 | Income rows: 薪水 TWD 65,271 (row 28), 沛還 USD 700 (row 29). D32/D33 read C28:C31 / D28:D31 |
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

## Template contents

The "Budget Based" tab is the template. Its entries have no 日期, like
recurring rows today. Agreed with Vincent on 2026-10-20 and already
written into the tab:

| Block | Budget (支付幣別) | Starting entries |
|---|---|---|
| 生活用品 | 31,261 (TWD) | 基本生活費 30,000 TWD; 電話費 1,261 TWD |
| 訂閱 | 13,000 (TWD) | ElevenLabs 6.00, iCloud 9.99, Google One 7.99, Netflix 26.99, ChatGPT 20.40 (all USD); Claude `=200*$C$15` TWD (USD-priced, paid from the NTD account) |
| 學貸 | 429.93 (USD) | ECSI Loan 148.50 USD; Fed Loan 281.43 USD |
| 交通 | 1,000 (TWD) | 公車儲值 1,000 TWD |
| 其他 | 15 (USD) | 每月銀行管理 15.00 USD |
| 中餐 (午餐 block) | 3,900 (TWD) | none |
| 吃喝, 購物, 娛樂 | 0 (TWD) | none |

- **Income:** 薪水 TWD 65,271 and 沛還 USD 700.
- **Left out on purpose:**
  - Google Cloud, Cursor, GitHub Action Minutes, 荒野亂鬥月票: Vincent removed them.
  - 婚紗存錢, 額外支出, Cloudflare Domain: one-offs.
- **Starting position:** with the template as is, 本月超支 is 0 and
  本月美金收支狀況 is +$183.70.
- **Changing the starting entries:** Vincent edits the template tab by
  hand. Every month created afterwards picks the change up.

## Goals

- `start_month` creates budget months (see below).
- `add_expense`, `delete_expense`, `set_income`, `add_transfer`,
  `month_summary` and `get_categories` work on budget months.
- Old-layout months (5 月–10 月, plus the 11 月 DEP / 12 月 DEP copies)
  keep working exactly as today, with every existing test still passing.
- `get_sheet_conventions` and the README describe the budget layout.

## Non-goals

- Migrating 5 月–10 月 to the budget layout.
- Converting an old month's entries automatically. 11 月 and 12 月 are
  rebuilt from the template, and their few planned one-offs are re-added
  by hand with `add_expense` (see *Rollout*).
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
as they are. The template tab carries the same anchor, but tools only
ever open "N 月" tabs, so they never treat it as a month.

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

## start_month

`start_month(month, replace_old_layout?)` builds every budget month from
the template.

**Which path.** When a tab named "Budget Based" exists, `start_month`
always takes the template path below. When it doesn't, it runs today's
old-layout steps unchanged. That old path stays so the existing tests
(whose fixtures have no template tab) keep passing. *(My call. A date
cutoff can't work because tab names carry no year.)*

**When "N 月" already exists:**
- **Default:** refuse, as today.
- **With `replace_old_layout: true`** and an old-layout "N 月": first
  rename it to "N 月 DEP", then build. *(My call: an explicit flag, so a
  mistyped month can never move a month in use out of the way.)*
- **Always refuse** to replace a budget-layout tab.
- **Always refuse** when "N 月 DEP" already exists.
- **Renaming a tab:** Sheets rewrites every reference to the renamed tab.
  For example, references to '11 月' become '11 月 DEP', including the
  template's own placeholder carries. That's harmless, because step 3
  below rewires the new tab's carries.

**Steps:**
1. Duplicate the "Budget Based" tab as "N 月". Put it at the front, where
   new months go today.
2. Write the title `N 月花費`.
3. Point 上月美金透支 (D) and 上月新臺幣透支 (E) at the previous month's
   本月美金收支狀況 / 本月新臺幣收支狀況 value cells, found by label, with
   the same `=IF(-(cell) > 0, -(cell), 0)` shape as today's carries.
   - Both layouts use the same labels in column B with values in D, so
     this works whether the previous month is old layout (10 月) or a
     budget month.
   - If the previous month is missing, the carry is 0.
4. Write the 本月匯率 formula (below) for the new month.
5. Nothing to clear. The template holds only starting entries, the
   starting income rows and an empty 乾坤大挪移.

Return the new tab's name, the template it came from, the previous month
the carries point at, the DEP tab created (if any), and the starting
entries per block.

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
- **The template's own C15** holds a typed placeholder (32.4607). Every
  built month gets the formula instead.

## Rollout

After the tools are deployed:

1. **Build 11 月.** Run `start_month(11, replace_old_layout: true)`. The
   old tab becomes "11 月 DEP", and the new 11 月's carries point at 10 月
   (old layout).
2. **Re-add 11 月's planned one-offs** with `add_expense`, copied from
   11 月 DEP:
   - 燙頭髮: NTD 3,400, 生活用品, 11/09
   - GTA 6 Ultimate Edition 預購: USD 99.99, 娛樂, 11/18
   - Kato 10-1794, 10-1795 500系 全編成: NTD 8,940, 購物
   - Kato 10-2218 北越急行 683系8000番台 <スノーラビットエクスプレス> 9両セット: NTD 6,150, 購物
   - Tomix 98662 JR 500-7000系山陽新幹線（ハローキティ新幹線）セット: NTD 6,544, 購物
3. **Build 12 月.** Run `start_month(12, replace_old_layout: true)`. Its
   carries point at the new 11 月.
4. **Re-add 12 月's planned one-offs:**
   - Tomix 98359, 98360, 98361 JR EF81・24系トワイライトエクスプレス: NTD 5,110, 購物
   - Tomix 98744 小田急ロマンスカー70000形GSE(第2編成)セット: NTD 4,140, 購物
5. **Check both months** with `month_summary` against 11 月 DEP / 12 月 DEP.
   The expected differences are:
   - the new budget-based 收支狀況 logic
   - the dropped card and bank sections
   - the one-offs showing as overspend in 購物, 娛樂 and 生活用品, where
     the budgets cover only the starting entries

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
  - `start_month`'s template path:
    - it copies the template, not the previous month
    - carries against an old-layout previous month and a budget one
    - the rate formula and its year rule
    - `replace_old_layout`: renames to DEP, and refuses on a budget tab,
      on an existing DEP, and without the flag
    - the old path still runs when there's no "Budget Based" tab
  - checking that every insert/delete on a budget tab is band-scoped
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
