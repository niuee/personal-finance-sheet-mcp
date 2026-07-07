# Sync tools with the restructured sheet (2026-07-06)

Vincent rebuilt the monthly tabs by hand and declared the sheet the single
source of truth. This change re-derives the conventions and tool behavior
from the live 7月/8月/9月 tabs instead of the layouts the tools used to
write. 8月/9月 carry the settled convention; 7月 is a transitional variant
(it titles the 收支狀況 rows 本月美金餘額/本月新臺幣餘額 — the finders
accept both).

## What changed on the sheet

- **月 view renamed and simplified.** 月美金餘額/月新臺幣餘額 →
  本月美金收支狀況/本月新臺幣收支狀況. The 月剩餘 row and the per-currency
  美金透支沖銷/新臺幣透支沖銷 write-off rows are gone — there is no
  "settle from the bank" step anymore.
- **銀行餘額 block renamed.** 美金收入/美金支出/上月美金餘額/總美金餘額 →
  本月美金收入/本月美金支出/本月初美金餘額/本月底美金餘額 (NTD likewise),
  plus a new 保守預計本月底新臺幣餘額 row that counts the lunch leftover
  only when it is negative.
- **Per-currency chaining diverged.** 本月初新臺幣餘額 = previous month's
  本月底新臺幣餘額 (cross-tab reference). 本月初美金餘額 stays a literal 0 —
  the USD side carries only through the 上月美金透支 expense row.
- **Carry formulas simplified.** 上月…透支 anchors at the previous month's
  本月…收支狀況 cell: `=IF(-('prev'!D<row>) > 0, -(…), 0)` — no more
  net+write-off sum.
- **Income list grew a header row.** 總預算, then 項目/幣別/金額, then the
  income rows. The 本月…收入 SUMIFs cover the header row through the last
  income row; blank gap rows below the list sit OUTSIDE the SUMIFs.
- **New 類別 tag 學貸** (ECSI Loan / Fed Loan) in the dropdown.
- **中餐額外 recurring row dropped** (superseded by the 午餐預算 block).

## What changed in the tools

- `conventions.ts`: labels re-derived from the sheet; `KNOWN_TAGS` +學貸;
  `MONTH_USD_NET_LABELS`/`MONTH_NTD_NET_LABELS` carry the 7月 synonyms;
  write-off/月剩餘/總…餘額 constants removed; CONVENTIONS_TEXT rewritten.
- `month_summary`: keys renamed to the sheet's own labels (本月美金收支狀況,
  本月初/本月底 ledgers, 保守預計本月底新臺幣餘額); write-off/月剩餘 keys
  dropped; the income list skips the 項目 header row.
- `set_income`: writes are targeted at the rows the 本月美金收入 SUMIF
  actually covers (`findIncomeSumifWindow`), so a new income row can never
  land in the gap rows the SUMIFs don't see. The auto-migration to the old
  月剩餘 layout is deleted — old-layout tabs (6月 2026 and earlier) are
  frozen history and refused.
- `start_month`: carries rebuilt against the previous month's 收支狀況
  cells; 本月初新臺幣餘額 rewired to the previous 本月底新臺幣餘額;
  本月初美金餘額 left untouched; the income 項目 header row survives the
  ad-hoc income clear.

## Open question flagged to Vincent

With the 沖銷 rows gone, a negative month is counted twice in the NTD
ledger chain: it lowers 本月底新臺幣餘額 (which next month inherits via
本月初新臺幣餘額) AND rolls in as next month's 上月新臺幣透支 expense.
That is exactly what the hand-built 8月/9月 formulas do, so the tools
reproduce it — flagged in case it is unintentional.
