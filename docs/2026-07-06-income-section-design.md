# Income section: `set_income` tool, 幣別/支付幣別 columns, 月剩餘 — design

**Date:** 2026-07-06
**Status:** Approved, to be implemented on `feat/set-income`

## Problem

The monthly tabs track income as hand-edited cells: 沛還 and 薪水 are plain
values in the budget block, ad-hoc extras (e.g. 7 月's 多一個月薪水) are added
by hand, and the 銀行餘額 block's 美金收入/新臺幣收入 are typed in manually.
No tool writes any of this — filling in income means raw `update_range`
edits. Separately, the 美金支出/新臺幣支出 formulas infer payment currency
from "column D blank or not", which cannot express a USD-priced expense paid
from the NTD account, and the budget block's 美金支付/新臺幣支付 rows
duplicate the same idea with hand-picked `=SUM(D4:D12,…)` cell lists that go
stale as rows are added.

## Target sheet layout (monthly tab, after migration)

```
     A(日期) B(項目)      C(類別/幣別) D(美金)  E(新臺幣)   F(支付幣別)
 2   ── header: 日期 項目 類別 美金 新臺幣 支付幣別 ──
 3+  expense rows…                                        USD or TWD per row
31           花費總額(D)  =SUM(E window)(E)
33           總預算
34           沛還         TWD          20500
35           薪水         TWD          68587
36           (ad-hoc income rows…)
37           月美金餘額                =美金收入cell−美金支出cell
38           月新臺幣餘額              =新臺幣收入cell−新臺幣支出cell
39           月剩餘                    =月美金餘額×GOOGLEFINANCE("CURRENCY:USDTWD")+月新臺幣餘額
43           銀行餘額
44           美金收入                  =SUMIF(income C,"USD",income D)
45           美金支出                  =SUMIF(F window,"USD",D window)
46           上月美金餘額              ='前月'!總美金餘額 cell
47           總美金餘額                =上月美金餘額+美金收入−美金支出
48           新臺幣收入                =SUMIF(income C,"TWD",income D)
49           新臺幣支出                =SUMIF(F window,"TWD",E window)
50           上月新臺幣餘額            ='前月'!總新臺幣餘額 cell
51           總新臺幣餘額              =上月新臺幣餘額+新臺幣收入−新臺幣支出
```

(Row numbers illustrative — everything is located by label anchor, never by
fixed row.)

### Income list (budget block)

- The **income window** is the rows between 總預算 and 月美金餘額: label in
  B, 幣別 tag (`USD`/`TWD`) in C, amount in D. 沛還 and 薪水 are ordinary
  rows in this list (tagged TWD), unified with ad-hoc incomes.
- **月美金餘額 / 月新臺幣餘額** — this month's net per currency
  (收入 − 支出 from the 銀行餘額 block), no carry-over.
- **月剩餘** — the month's combined remainder in TWD:
  月美金餘額 converted at GOOGLEFINANCE USDTWD, plus 月新臺幣餘額.
- **Removed:** the old 剩餘 (`=SUM(D…)−花費總額` — would silently mix
  currencies once USD income exists), and 美金支付/新臺幣支付 (superseded by
  the SUMIF-based 美金支出/新臺幣支出). Same deprecation treatment as the
  old G/H summary block.

### Expense list

- New **column F: 支付幣別** (`USD`/`TWD`) — which real account paid the row.
  Header 支付幣別 in F2. Pricing stays in D/E as today (USD-priced rows keep
  the D value + E conversion formula).
- 美金支出 sums **D** of USD-paid rows; 新臺幣支出 sums **E** (native or
  converted amount) of TWD-paid rows. A USD-priced expense paid with a TWD
  card therefore hits the NTD ledger at its converted TWD amount — the old
  blank-column heuristic could not express this.

### 銀行餘額 block

- 美金收入/新臺幣收入 switch from hand-entered values to SUMIFs over the
  income window's 幣別 column.
- The running balances are renamed **總美金餘額 / 總新臺幣餘額** (formulas
  unchanged: 上月 + 收入 − 支出). 上月美金餘額/上月新臺幣餘額 keep their
  names and keep pointing at the previous month's 總…餘額 cell.

Naming scheme: **月**…餘額 = this month's net, **總**…餘額 = running bank
total, **上月**…餘額 = carry-in.

## Tool changes

1. **New tool `set_income({ item, amount, currency, month? })`** — upsert:
   - Item already in the income window → overwrite its amount and 幣別.
   - New item → insert a whole sheet row *inside* the window (so the two
     income SUMIFs and the 月-row anchors auto-extend), write B/C/D.
   - Old-layout tab → run the migration (below) first, then apply the write.
   - Result reports the cell written, whether it was an update or insert,
     any previous value, and what migration did (if it ran).
2. **`add_expense`** — new optional `paid_with` (`USD`/`TWD`), default = the
   pricing `currency`; written to the row's F cell.
3. **`month_summary`** — adds 月剩餘, 月美金餘額, 月新臺幣餘額, and an
   `incomes` array (`{item, currency, amount}` per income row); balance keys
   become 總美金餘額/總新臺幣餘額; drops 美金支付/新臺幣支付; 剩餘 reads
   null on migrated tabs.
4. **`start_month`** — keeps 沛還/薪水 (recurring, values carry over),
   deletes ad-hoc income rows from the new month (same philosophy as one-off
   expenses); carry-over rewiring targets 總…餘額.
5. **Label fallbacks** — every lookup of 總美金餘額/總新臺幣餘額 falls back
   to the old 美金餘額/新臺幣餘額 labels so unmigrated months still read
   correctly (reported under the new keys).

## Migration (auto, on first `set_income` against an old-layout tab)

Detection: tab has a 剩餘 label but no 月剩餘. Steps, all label-anchored:

1. Write 支付幣別 header in F2; back-tag every expense row: D non-blank →
   `USD`, else `TWD` (preserves today's numbers exactly).
2. Tag existing income rows (rows with a label in B and value in D between
   總預算 and 剩餘) with 幣別 `TWD` in C.
3. Replace 剩餘 with the three rows 月美金餘額 / 月新臺幣餘額 / 月剩餘
   (inserting two rows).
4. Delete the 美金支付 and 新臺幣支付 rows.
5. Rewrite 美金收入/新臺幣收入 as income-window SUMIFs and
   美金支出/新臺幣支出 as 支付幣別-keyed SUMIFs.
6. Rename 美金餘額 → 總美金餘額, 新臺幣餘額 → 總新臺幣餘額.

The migration result lists every cell changed with its previous value or
formula, so any step can be reverted by hand. Cells it overwrites
(美金收入 etc.) are hand-entered values — currently 0 in 7 月.

## conventions.ts / docs

- New label constants (總預算, 月剩餘, 月美金餘額, 月新臺幣餘額,
  總美金餘額, 總新臺幣餘額), income-window column map, `paidWith: 5` in
  `MONTH_COLS`, old-label fallback pairs.
- `CONVENTIONS_TEXT` rewritten for the new income section, F column, and the
  月/總/上月 naming scheme; notes 剩餘 and 美金支付/新臺幣支付 as removed.
- Short deprecation note in `docs/` (this file serves as it).

## Testing

Mocked-`SheetsClient` unit tests in the existing `finance-ops.test.ts`
style:

- `set_income` upsert-update (薪水 exists) and upsert-insert (new item —
  window extension, SUMIF coverage).
- Full migration of an old-layout fixture: back-tagging, row swaps,
  formula rewrites, renames, previous-value reporting.
- `add_expense` `paid_with` default and explicit write.
- `month_summary` new fields, incomes array, old-label fallback.
- `start_month` keeps 沛還/薪水, clears ad-hoc income rows.

Then end-to-end against the dev copy sheet before merging.

## Out of scope

- Converting 6 月 and earlier (pre-類別 layout) — migration targets the
  current A–E layout only; older tabs stay read-only curiosities.
- Trip tabs — untouched.
