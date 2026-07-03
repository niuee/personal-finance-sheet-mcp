# Monthly-tab 類別 (category) column — design

**Date:** 2026-07-03
**Status:** Implemented on `feat/category`

## What changed in the sheet

Vincent inserted a 類別 column as column C in the monthly tabs (7 月, 8 月, 9 月;
6 月 and earlier keep the old layout). Every expense row now carries a
free-text tag: 訂閱, 吃喝, 交通, 生活用品, 娛樂, 購物, 其他, 透支. Everything
right of column B shifted one column:

| | old | new |
|---|---|---|
| 日期 | A | A |
| 項目 | B | B |
| 類別 | — | **C (new)** |
| 美金 | C | D |
| 新臺幣 / 花費總額 window | D | E |
| summary block labels/formulas | F/G | G/H |
| budget values (沛還/薪水/剩餘/美金支付) | C | D |

The row 類別 tag is a *different, finer* grouping than the summary block
(訂閱費 / 基本房租生活費 / 交通中餐等等雜支 / 本月額外雜支), which still uses
hand-picked `=sum(E4,E5,…)` formulas. There is no clean mapping between the
two (verified against 7 月), so they stay independent in the tools.

## Approach

Same as the 日期-column change: remap `MONTH_COLS` (the single source of truth
for monthly-tab geometry) and let every op follow, then add first-class 類別
support where it earns its keep. Alternatives considered and rejected:

- **Derive the summary-block splice from the 類別 tag** — no 1:1 mapping
  exists in the real sheet (e.g. 生活用品 rows land in three different
  summary sums).
- **Move the summary block to SUMIF over column C** — changes the sheet
  itself, which is Vincent's call, not the tools'.

## Changes

1. **`conventions.ts`**
   - `MONTH_COLS`: add `tag: 2`; shift `usd`→3, `twd`→4, `totalLabel`→3,
     `totalValue`→4, `categoryLabel`→6, `categoryFormula`→7, `budgetValue`→3.
   - New `KNOWN_TAGS` list (documented values for tool descriptions; the cell
     stays free text so new tags never hard-fail).
   - `CONVENTIONS_TEXT` rewritten for the A–E layout.
2. **`finance-ops.ts`**
   - `addExpense`: new optional `tag` — written into the C cell of the new
     row (cell left untouched when omitted). Included in the result.
   - `monthSummary`: new `tags` field — per-類別 TWD totals computed by
     scanning the expense window (rows 3 to 花費總額−1), summing column E by
     the column-C tag. Read-only; this is what the column is for.
3. **`tools.ts`**: `add_expense` gains the `tag` param (free text, known
   values listed in the description); descriptions updated.
4. **Tests**: `monthGrid` fixture and expectations moved to the new layout;
   new cases for the tag write and the tags breakdown.

## Out of scope / known pre-existing wart

`start_month` rewires 上月透支 by swapping the tab name only, keeping the cell
ref (e.g. `D30`) from the duplicated formula. The 剩餘 row drifts between
months as the expense list grows/shrinks (7 月: D30, 8 月: D32), so the ref can
point one row off until fixed by hand. Pre-existing behavior, unchanged here.

Old-layout tabs (6 月 and earlier) are no longer addressable by the tailored
tools — same trade already made for the 日期 column.
