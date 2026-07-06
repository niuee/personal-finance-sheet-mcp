# Per-currency 透支 carry — 上月美金透支 / 上月新臺幣透支

**Date:** 2026-07-06
**Status:** Approved by Vincent — folded into PR #12 (feat/add-lunch-tool)

## Problem

The carried overdraft is a single TWD row. start_month anchors it at the
previous month's 月剩餘 — a combined number — so a USD shortfall rolls
forward converted to TWD and debits the NTD ledger next month, even
though the 月 view and the 透支沖銷 write-offs are already split per
currency. A lone USD deficit can also vanish entirely when the NTD
surplus covers it on paper (月剩餘 ≥ 0 → no carry).

Live state (prod): 7月 row 3 `上月透支` = `=-'6 月'!C40` (TWD, F=TWD);
8月/9月 row 3 = `=IF(-'7 月'!D39 > 0, -'7 月'!D39, 0)` anchored at 月剩餘.

## Decisions (validated with Vincent)

1. **Fully independent per-currency carry.** Each currency rolls its own
   UNSETTLED deficit: `月…餘額 + …透支沖銷` is negative exactly when the
   write-off could not fire, zero when it settled. A USD deficit carries
   even in a month whose 月剩餘 is positive — same independence
   philosophy as the per-currency 沖銷. 月剩餘 stays as the combined
   informational view; nothing anchors on it on the new layout.
2. **Backfill the live 7月/8月/9月 after merge** so the two-row layout is
   uniform from 7月 on; the code keeps a legacy fallback for 6月 and
   earlier (and for any un-backfilled sheet).

## Sheet layout

The single 上月透支 row becomes two rows at the top of the expense
window, named to match the 沖銷 rows:

```
row 3  上月美金透支    C=透支  D=<carried USD>  E==D3*GOOGLEFINANCE("CURRENCY:USDTWD")  F=USD
row 4  上月新臺幣透支  C=透支                   E=<carried TWD>                          F=TWD
```

- The USD row participates in the ledgers like any USD expense row: its
  D flows into 美金支出's SUMIF (F=USD), so the carried USD debt debits
  the USD bank and depresses next month's 月美金餘額 — where next
  month's 美金透支沖銷 can settle it. The NTD row likewise via
  新臺幣支出.
- Both rows are tagged 透支, so the per-類別 totals keep working (the
  USD row's E holds the converted TWD view inside the summed window).
- The carry chain stays self-terminating per currency: settled → the
  sum is 0 → nothing rolls; unsettled → the raw deficit rolls once and
  is counted as next month's outflow.

## Carry formulas (written by start_month)

Anchored by LABEL on the previous tab (never by fixed position). With
7月's post-backfill rows as the example (月美金餘額 D36, 美金透支沖銷
D37, 月新臺幣餘額 D38, 新臺幣透支沖銷 D39):

```
上月美金透支    D = =IF(-('7 月'!D36+'7 月'!D37) > 0, -('7 月'!D36+'7 月'!D37), 0)
上月新臺幣透支  E = =IF(-('7 月'!D38+'7 月'!D39) > 0, -('7 月'!D38+'7 月'!D39), 0)
```

The USD row's E conversion formula is row-relative and survives
duplication untouched — start_month rewrites only D (USD) and E (NTD).

## Changes

1. **`conventions.ts`** — `PREV_USD_OVERDRAFT_LABEL = "上月美金透支"`,
   `PREV_NTD_OVERDRAFT_LABEL = "上月新臺幣透支"`; `OVERDRAFT_LABEL`
   ("上月透支") stays for legacy tabs. Both new labels join
   `RECURRING_ITEMS` (the old one stays too). CONVENTIONS_TEXT's row-3
   bullet is rewritten: rows 3–4 carry last month's unsettled
   per-currency overdrafts via cross-tab formulas; tabs predating the
   split have the single TWD 上月透支 row.
2. **`startMonth`** — the carry rebuild becomes three-way:
   - **New layout** (duplicated tab has both new rows): locate
     月美金餘額 / 美金透支沖銷 / 月新臺幣餘額 / 新臺幣透支沖銷 by label
     in the duplicated grid (it mirrors prevTab's layout) and write the
     USD row's D and the NTD row's E with the formulas above.
   - **Degenerate** (new rows present but the previous month lacks the
     月 rows — un-migrated): USD D gets literal 0; NTD E gets the
     existing legacy formula (月剩餘/剩餘 anchor, or tab-name swap).
   - **Legacy** (only 上月透支 present): current behavior, unchanged.
3. **`monthSummary`** — new fields `上月美金透支` (the row's D) and
   `上月新臺幣透支` (the row's E), null on tabs without those rows; the
   existing `上月透支` field stays and reads null on the new layout.
4. **Tests** — a two-carry-row fixture variant of the migrated grid;
   startMonth: split rebuild formulas + write targets (D vs E), legacy
   fixture behavior unchanged, both carry rows survive the one-off
   delete pass (RECURRING_ITEMS); degenerate case; monthSummary fields
   on both layouts.

## Backfill of the live tabs (post-merge runbook, like the 沖銷 rollout)

Executed in order 7月 → 8月 → 9月 so each tab's anchors are read AFTER
the previous tab's row insert shifted them; every anchor located by
label at execution time (row numbers below are illustrative):

1. **7月**: insert one whole row above the 上月透支 row (row inserts are
   tolerated on monthly tabs; cross-tab references auto-adjust —
   verified live twice during the 沖銷 rollout; the lunch section and
   bank block shift down one). Fill the new row: B=上月美金透支,
   C=透支, D=0 (6月 predates the 月 view — nothing to anchor),
   E==D3*GOOGLEFINANCE("CURRENCY:USDTWD"), F=USD. Rename the old row's
   B to 上月新臺幣透支; its formula `=-'6 月'!C40` and F=TWD stay.
2. **8月**: same insert; USD D anchored at 7月's post-shift
   月美金餘額+美金透支沖銷 cells; rename the old row and REPLACE its
   formula with the NTD form anchored at 7月's
   月新臺幣餘額+新臺幣透支沖銷 (it currently reads 7月's 月剩餘).
3. **9月**: same as 8月, anchored at 8月's post-shift rows.
4. Verify per tab: the two carry values, 美金支出/新臺幣支出 picked the
   rows up per F, and the next tab's cross-tab formulas still point at
   the right (shifted) cells. Report every overwritten value.

**Caveat**: complete each tab's insert+rename atomically, and do not run
start_month until the whole backfill finishes. Half-converted states are
degraded, not safe: with the USD row inserted but the old row not yet
renamed, start_month carries the USD deficit correctly and re-anchors
the legacy TWD row, but an unsettled USD deficit can transiently
double-count (it also depresses the 月剩餘 the legacy row reads); in the
reverse state (renamed, USD row not yet inserted) a USD deficit is
silently dropped.

## Out of scope

- 6月 and earlier keep the single TWD row (legacy fallback covers them).
- `migrateIncomeLayout` is untouched — old-layout tabs keep their single
  carry row until backfilled or re-opened.
- 8月/9月 still lack the 中餐預算 section and the
  午餐超支或回補/預計總新臺幣餘額 bank rows (separate, user-driven sheet
  work; add_lunch errors clearly on them until then).
- No change to the 沖銷 formulas or 月剩餘.
