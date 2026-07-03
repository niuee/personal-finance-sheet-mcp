# Summary-block (G/H) deprecation

**Date:** 2026-07-03
**Status:** Implemented on `claude/add-expense-monthly-tabs-elb5b2`

## Background

Monthly tabs used to carry a summary block in columns G/H — labels
訂閱費 / 基本房租生活費 / 交通中餐等等雜支 / 本月額外雜支 in column G, with
hand-picked `=sum(E4,E5,…)` formulas in column H. `add_expense` maintained it
by splicing each new expense's E-cell into the matching category's sum.

Two problems surfaced:

- **It broke `add_expense` on tabs without the block.** 7 月 2026 (the current
  month) has no G/H block, so `add_expense` failed with
  `Could not find the category label "本月額外雜支" in column G`.
- **The block is redundant.** The per-row 類別 tag (column C, added 2026-07)
  is the categorization Vincent actually uses, and `month_summary` already
  reports per-類別 totals from it. There is no clean mapping between the tag
  and the summary block (see `2026-07-03-category-column-design.md`), so
  maintaining both is duplicate bookkeeping.

Vincent confirmed the G/H block is deprecated: it is being removed from 8 月
and 9 月, and future months will not have it.

## Change

The tailored tools no longer read or maintain the G/H block.

1. **`add_expense`** logs the expense into the 花費總額 SUM window only. The
   total picks it up automatically (an insert at the window's edge
   auto-extends the range). The `category` parameter is removed — the per-row
   `tag` (類別) is the surviving grouping.
2. **`month_summary`** drops the block-derived `categories` field. The
   per-類別 `tags` breakdown stays.
3. **`start_month`** no longer scrubs `#REF!` from category sums after
   deleting one-off rows (there are no category sums to scrub).
4. **`conventions.ts`** drops `CATEGORIES`, `DEFAULT_CATEGORY`, and
   `MONTH_COLS.categoryLabel` / `categoryFormula`; `CONVENTIONS_TEXT` now
   marks the block deprecated and tells callers to ignore any lingering one.
5. Removed the now-dead helpers `spliceIntoSum`, `adjustColumnRefsForInsert`,
   and `stripRefErrors` (each existed only to maintain the block) and their
   tests.

## Sheet cleanup (separate from code)

The G/H block still physically exists on 8 月 and 9 月. Removing it is a data
change, not a code change; once this code is deployed, `add_expense` ignores
the block, so a lingering one only goes stale (it will not auto-update). Clear
`G5:H10` on those two tabs to finish the deprecation.
