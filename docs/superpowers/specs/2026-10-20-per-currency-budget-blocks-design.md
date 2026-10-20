# Per-currency budgets in budget months — design

Status: approved layout (mockup https://claude.ai/artifact/9mwrZvaoGi61jtm3UVTqEM,
"lgtm"), 2026-10-20. Builds on
`2026-10-19-budget-month-layout-design.md` (the budget-month layout) and on
PR #43 (per-currency 收支狀況 lines and 超支 rows).

## Why

A budget-month block today shows one 編列預算, one 總和 and one 剩餘, all
converted to NTD. USD and NTD money sit in two different bank accounts, so a
single mixed figure hides which account is short. Two examples from 11 月:

- 訂閱 shows 剩餘 4,192, but the USD side is exactly on budget (71.37 of
  71.37) and all 4,192 is NTD left over.
- 娛樂 shows 剩餘 −3,254 (NTD), but the overspend is a USD purchase
  (GTA 6, $99.99) paid from the USD account.

The two 收支狀況 lines (PR #43) already treat each account separately; the
blocks and the budget list should do the same.

## Goals

1. Every category has a **USD budget and an NTD budget**, a **USD 總和 and an
   NTD 總和**, and a **USD 剩餘 and an NTD 剩餘**.
2. The budget list has **two rows per category**, with the currency in the
   label: `<類別>美金預算` and `<類別>新臺幣預算`, 18 rows for the nine
   categories.
3. Overspend is per currency and read straight off the blocks.
4. The template ("Budget Based") and the two existing budget months (11 月,
   12 月) all move to the new layout; new months get it from the template
   through start_month as today.
5. The tools (add_expense, delete_expense, month_summary, get_categories,
   start_month, set_income, add_transfer) keep working on the new layout,
   and the sheet guide (get_sheet_conventions) describes it.

## Non-goals

- No change to old-layout months (5 月–10 月), the "N 月 DEP" copies, the
  income list, the 上月…透支 carries, or the 乾坤大挪移 log.
- 預算總額 stays one combined NTD figure (agreed in the mockup).
- 總支出 stays one combined NTD figure (agreed).

## Anti-goals (a failure even if it "works")

- Any existing number changing during the migration, other than the rows
  this design adds or splits. 本月美金收支狀況, 本月新臺幣收支狀況,
  本月美金超支, 本月新臺幣超支 and 總支出 must read the same before and
  after on 11 月 and 12 月, at the same 本月匯率.
- A lost or moved entry in any block.
- A half-migrated tab. Each tab's migration is one atomic write.
- Breaking 12 月's carries, which point at `'11 月'!D32` / `'11 月'!D33`.

## The layout (as agreed)

Row numbers are for the template and both live months, which share them.

### Left side, columns A–F

| Row | B | C | D | E | F |
|---|---|---|---|---|---|
| 2 | header 項目 | 類別 | 美金 | 新臺幣 | 支付幣別 |
| 3 | 上月美金透支 | 透支 | carry (USD) | `=D3*$C$23` | USD |
| 4 | 上月新臺幣透支 | 透支 | | carry (NTD) | TWD |
| 5–22 | `<類別>美金預算` / `<類別>新臺幣預算`, alternating, 美金 first | 類別 | USD amount (美金 rows only) | 美金 rows: `=D<r>*$C$23`; 新臺幣 rows: the NTD amount | USD / TWD |
| 23 | 本月匯率 | rate formula | 預算總額 | `=SUM(E5:E22)` | |

- Category order down the list, as today: 生活用品, 吃喝, 購物, 訂閱, 交通,
  娛樂, 學貸, 其他, 中餐.
- 本月匯率 / 預算總額 move from row 15 to row 23 (decided in the mockup).
  Every reference to the rate cell (E-column conversions, E3, entries such
  as `=200*$C$15`, anything else) must follow it. *(My call: move the
  B15:E15 cells with the Sheets API's `cutPaste`, which rewrites every
  reference to them, on this tab and on other tabs, instead of finding and
  rewriting formulas.)*
- The income list (總預算 at 26, 項目/幣別/金額 at 27, rows 28–31) and the
  summary rows stay at their current addresses.

### Category blocks, columns H…AY

Each block keeps its four columns (日期 項目 金額 幣別) and spacer, its title
on row 2, its 日期/項目/金額/幣別 header on row 6 and its open-ended entries
from row 7. Rows 3–5 become one small table. For the 中餐 block (H–K,
entries' 金額 in J, 幣別 in K):

| Row | H | I | J | K |
|---|---|---|---|---|
| 3 | | 編列預算 | 總和 | 剩餘 |
| 4 | 美金 | `=SUMIF($B$5:$B$22,"中餐美金預算",$D$5:$D$22)` | `=SUMIF(K7:K,"USD",J7:J)` | `=ROUND(I4-J4,2)` |
| 5 | 新臺幣 | `=SUMIF($B$5:$B$22,"中餐新臺幣預算",$E$5:$E$22)` | `=SUMIF(K7:K,"<>USD",J7:J)` | `=I5-J5` |

- The 美金 row is entirely in USD and the 新臺幣 row entirely in NTD. No
  conversion happens inside a block any more.
- A blank 幣別 counts as TWD (`"<>USD"`), as today.
- An entry that is USD-priced but paid from the NTD account is still
  written by add_expense as 幣別 TWD with `=<usd>*$C$<rate row>`, so it
  counts on the 新臺幣 row.
- The 剩餘 header loses today's "(負數會加回去支出）" note. *(My call:
  the 超支 rows now say what a negative 剩餘 does.)*
- Today rows 3–4 hold merged cells (at least H3:I3 and H4:I4 in every
  block; writes to I3/I4 were silently dropped earlier). They must be
  unmerged as part of the migration.
- The ROUND on the USD 剩餘 keeps float noise like 71.37 − 71.37000000001
  from showing as −0.00 and from counting as overspend.

### Summary rows, column D

| Row | B | D |
|---|---|---|
| 32 | 本月美金收支狀況 | `=SUMIF(C28:C31,"USD",D28:D31)-D3-SUMIF(F5:F22,"USD",D5:D22)+D34` |
| 33 | 本月新臺幣收支狀況 | `=SUMIF(C28:C31,"TWD",D28:D31)-E4-SUMIF(F5:F22,"TWD",E5:E22)+D35-BF5` |
| 34 | 本月美金超支 | `=MIN(0,K4)+MIN(0,P4)+…+MIN(0,AY4)` (every block's 美金 剩餘) |
| 35 | 本月新臺幣超支 | `=MIN(0,K5)+MIN(0,P5)+…+MIN(0,AY5)` |
| 36 | 本月美金超支（加上回補） | `=K4+P4+…+AY4` |
| 37 | 本月新臺幣超支（加上回補） | `=K5+P5+…+AY5` |
| 40 | 總支出 | `=SUM(J4,O4,…,AX4)*$C$23+SUM(J5,O5,…,AX5)+BF5` |

- The combined 本月超支 row and the combined 本月超支（加上回補） row go
  away; the four split rows replace them (agreed in the mockup).
- D32 must keep starting with `=SUMIF(C28:C31,`, because
  `findBudgetIncomeSumifWindow` reads the income window from it.

### Display formats

USD cells display like `$71.37` and NTD cells like the
本月新臺幣收支狀況 cell does today (`NTD 10,700`, `-NTD 6,624`). This covers
the budget list's D and E, each block's rows 4 (USD) and 5 (NTD), and
D32–D37 and D40. *(My call: 總支出 currently displays with a `$`, although
it is an NTD figure; the migration gives it the NTD format.)*

## Migrating the three tabs

The template, 11 月 and 12 月 are migrated in place. None is rebuilt, so the
entries, 11 月's hand-set `E4 = 0` and 12 月's carries stay as they are.

*(My call:)* a one-off server operation does the migration, exposed as an
MCP tool (working name `migrate_budget_split`, taking a tab name). The
existing tools can't unmerge cells, move cells with their references, or
set number formats, and doing it by hand across three tabs invites the
half-migrated state this design forbids. For each tab, the tool:

1. Reads everything first (formulas and values), then sends **one**
   batchUpdate, so a failure writes nothing.
2. Refuses a tab that isn't a budget month, a tab already in the new
   layout (its blocks have the 美金 / 新臺幣 rows), and a tab whose left
   side has anything in B–F between the current 本月匯率 row and row 23,
   the space the 18 rows and the moved rate row need.
3. Unmerges rows 3–5 of the block columns.
4. Moves B15:E15 to B23:E23 with `cutPaste`, before anything else that
   references the new rate address.
5. Writes the 18 budget rows, carrying each category's current amounts:
   - USD amount: the D cell of the old line whose 支付幣別 is USD, as
     typed (formulas such as `=281.43 + 148.5` stay formulas).
   - NTD amount: the E cell of the old line whose 支付幣別 is TWD, as
     typed. One exception: the template's 吃喝 line is `E6 = D6*$C$15`
     with 支付幣別 TWD and a **blank** D6, so it evaluates to 0; a TWD line
     whose E converts a blank D carries 0. A TWD line whose E converts a
     **filled** D isn't covered, so the tool refuses the tab.
   - A currency a category doesn't have yet becomes 0.
6. Rewrites rows 3–5 of every block, D32–D37 and D40 as above, and clears
   anything left over from the old rows.
7. Applies the display formats.

Anything else these rules don't cover makes the tool refuse the tab
instead of guessing. That includes a category with two budget lines in the
same currency, a merge on rows 3–5 that reaches outside them (into the
title row, say), or a block whose rows 3–5 hold something other than
today's labels and formulas. *(My call: refusing keeps the "no number
changes" anti-goal safe; a refused tab gets fixed by hand and rerun.)*

`cutPaste` only has to carry references to the rate cell and 預算總額,
which live on the same tab (entries like `=200*$C$15`, the E-column
conversions, E3). No other tab refers to them; 12 月's carries point at
11 月's D32 / D33, which don't move.

Afterwards the tool reports the before/after values of D32, D33, D34, D35
and D40 so the run can be checked against the anti-goal.

Rollout order, after the code is merged and deployed:

1. migrate "Budget Based";
2. migrate 11 月;
3. migrate 12 月;
4. check that 11 月 and 12 月 still show the same 收支狀況, 超支 and 總支出
   figures, and that 12 月's carries still read 11 月's D32 / D33.

Once all three are done, the tool can be removed in a later change.

## Tool behaviour on the new layout

- **Block finder (`findBudgetBlocks`)**: a block is still anchored on its
  日期/項目/金額/幣別 header and its "…支出" title. Between them it finds
  the 美金 row and the 新臺幣 row (labels in the block's first column) and
  the 編列預算 / 總和 / 剩餘 header (columns +1…+3). A block still in the old
  shape (編列預算 label in the first column, no 美金 / 新臺幣 rows) throws an
  error that names the migration tool, so the brief window between deploy
  and migration fails loudly instead of misreading.
- **add_expense / delete_expense**: entries are unchanged, so writing and
  deleting entries works as today. The 幣別 dropdown copy from PR #43 keeps
  working (it starts at the header row).
- **month_summary** on a budget month returns, per block,
  `{ category, 美金: { 編列預算, 總和, 剩餘 }, 新臺幣: { 編列預算, 總和, 剩餘 } }`,
  plus 本月美金超支, 本月新臺幣超支, 本月美金超支（加上回補）,
  本月新臺幣超支（加上回補）, the two 收支狀況 lines, 預算總額, 本月匯率,
  總支出 and the 乾坤大挪移 totals. The combined 本月超支 /
  本月超支（加上回補） fields go away.
- **start_month** copies the template as today. Carries, the rate formula
  and the title are all found by label, so it needs no change beyond tests
  on the new template shape.
- **set_income** treats the new summary labels as layout labels and
  refuses them as income items.
- **get_sheet_conventions**: the BUDGET MONTHS section describes the 18-row
  list, the per-currency block table, the split 超支 rows, and the
  migration tool for as long as it exists.

## Shipping

*(My call:)* this work goes on the same branch as PR #43
(`claude/relaxed-sagan-etg02z`). If #43 has been merged by then, the branch
restarts from main and this becomes a new PR.

Tests follow the repo's habits: vitest with fixtures that mirror the
template. `test/budget-fixtures.ts` gets the new template shape, and keeps
an old-shape grid for the migration tests. The docs follow too: the
README's budget-month paragraph, and a pointer from the 2026-10-19 layout
design to this one.

## Left to the builder

- Exact label constants and where they live (`src/conventions.ts`).
- The migration tool's name and parameter shape.
- How the migration finds the old lines and the 18 new rows' cells,
  provided every row is located by label, never by a fixed row number,
  except where this document fixes an address.
- The exact number-format patterns, provided they read as described above.
