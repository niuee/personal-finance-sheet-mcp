# 透支沖銷 — automatic overdraft write-off against the bank balance

**Date:** 2026-07-06
**Status:** Approved, to be implemented on `feat/overdraft-writeoff`

## Problem

A carried 上月透支 sits in the expense window, so it drags 月剩餘 down;
if 月剩餘 ends negative, start_month rolls a fresh 上月透支 into the next
month. The debt keeps rolling through the budget view even when the bank
account has more than enough savings to absorb it — July 2026 carries
June's 15,843.21 and ends at 月剩餘 −968.57, so August inherits 968.57
despite a healthy balance.

Vincent wants: **if the bank can cover the overdraft, settle (沖銷) it
this month** — the debt is paid out of accumulated savings (總…餘額),
月剩餘 shows the month's OWN performance, and nothing rolls forward
unless the month itself overspends.

## Decisions (validated with Vincent)

1. **Settle outside the month**: 花費總額 and 新臺幣支出 keep including
   the carry row (the bank pays, per the include-上月透支 semantics);
   only 月剩餘 adds the settled amount back.
2. **Automatic, all-or-nothing**: a formula settles the FULL deficit iff
   總新臺幣餘額 ≥ 0; otherwise 0 and the debt rolls exactly as
   today. No monthly action needed. (The check only fires meaningfully
   once 上月…餘額 is seeded with real balances.)
   Clarified 2026-07-06: because 支出 already includes the carry, "the
   bank can cover it" means the post-payment 總新臺幣餘額 is ≥ 0 — NOT ≥
   the debt again (which would demand a 2× buffer).
   Corrected 2026-07-06 (v2, after live rollout): the write-off targets the
   MONTH'S OWN end-of-month deficit (月美×rate+月新 < 0), not specifically
   the carried 上月透支 row — 沖銷 = -(月美×rate+月新) when it fires, so a
   settled month's 月剩餘 closes at exactly 0. A carried 上月透支 is part of
   the deficit (it sits in the expense window), so it is settled with
   everything else.
3. **Visible row**: the write-off is a labeled row, not an invisible
   term inside 月剩餘's formula — auditable at a glance, reportable by
   month_summary.

## Sheet layout

A new row **透支沖銷** between 月新臺幣餘額 and 月剩餘 (labels in B,
values in D, like the rest of the block). Using 7月's current rows as the
example:

```
37  月美金餘額    =D46-D47
38  月新臺幣餘額  =D50-D51
39  透支沖銷      =IF(AND(D37*GF+D38<0, D53>=0), -(D37*GF+D38), 0)  ← new row
40  月剩餘        =D37*GOOGLEFINANCE("CURRENCY:USDTWD")+D38+D39
     …
53  總新臺幣餘額  (bank block shifted +1 by the insert)
```

- `D53` = the tab's own 總新臺幣餘額 cell, `E3` = the tab's own 上月透支
  cell — both located by label when the formula is written, never by
  fixed position.
- No circular reference: 總新臺幣餘額 = 上月 + 收入 − 支出, none of which
  read 月剩餘 or 透支沖銷.
- Self-terminating chain: with the carry added back, 月剩餘 = the month's
  own performance, so the next month's rebuilt 上月透支 picks up only
  fresh overspending.
- Tabs with no 上月透支 row get a literal 0 in the 沖銷 cell (label kept
  so the row is uniform); tabs where E3 computes 0 settle nothing — inert
  either way.

## Changes

1. **`conventions.ts`** — `WRITEOFF_LABEL = "透支沖銷"`; CONVENTIONS_TEXT
   gains a bullet in the income-section paragraph describing the row and
   its all-or-nothing rule.
2. **`migrateIncomeLayout`** — writes FOUR 月-view rows instead of three
   (`insertDimension` grows from 2 to 3 rows after the old 剩餘 row):
   月美金餘額 / 月新臺幣餘額 / 透支沖銷 / 月剩餘, with the 沖銷 formula
   anchored to the tab's own 上月透支 and (post-rename) 總新臺幣餘額
   rows, and 月剩餘 = 月美金餘額×GOOGLEFINANCE + 月新臺幣餘額 + 透支沖銷.
   All `finalRow` bookkeeping shifts from +2 to +3.
3. **`month_summary`** — new `透支沖銷` field (number | null on
   pre-mechanism tabs).
4. **`start_month`** — no changes: the row duplicates with the tab, its
   references are same-tab, and the 上月透支 rebuild already targets
   月剩餘 by label.
5. **`findIncomeWindow` / `setIncome`** — no changes: the income window
   still ends at 月美金餘額.
6. **Tests** — `migratedMonthGrid()` gains the row (bank rows shift by
   one); migration expectations move to the 3-row insert and the extra
   月 row; a month_summary case covers the new field.

## Backfill of already-migrated tabs

The real sheet's 7月/8月/9月 (and the dev copy's 7月) already carry the
three-row 月 view, so migration will not touch them again. After the code
lands, a one-time label-anchored script inserts the 透支沖銷 row above
each tab's 月剩餘 (whole-sheet row insert — monthly tabs tolerate this),
writes its formula, and replaces 月剩餘 with the three-term version. Each
change is reported with previous values.

## Out of scope

- Partial write-offs (settle what the bank can afford when it cannot
  cover everything) — all-or-nothing was chosen; revisit if a real month
  needs it.
- USD overdrafts — 上月透支 is TWD-only today; the check reads
  總新臺幣餘額 only.
- A manual override to suppress an automatic write-off.
