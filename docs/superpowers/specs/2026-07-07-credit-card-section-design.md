# 信用卡帳單對帳區 — credit-card statement reconciliation

**Date:** 2026-07-07
**Status:** Approved by Vincent

## Background

7月 2026 gained two hand-built things this design formalizes:

1. A **支付方式 column G** inserted into the expense list (header row 2:
   日期 項目 類別 美金 新臺幣 支付幣別 支付方式). The insert shifted every
   section right of F by one column: 乾坤大挪移 is now H–N, 午餐預算 is
   now P–R. No expense row has G filled yet.
2. A **信用卡帳單對帳區** headed at H50, with four card blocks in a 2×2
   grid (國泰 CUBE at H51, CHASE Amazon at L51, CHASE Freedom Unlimited
   at H64, Apple Card at L64). Each block spans three columns (H–J or
   L–N) and today holds 本月結帳日 / 本月繳款日 / 本月需繳 rows and two
   item buckets (本月結帳日前 / 本月結帳日後) with 日期/項目/金額
   headers and no data.

Goal: log each credit-card expense **once**, in the expense list, and
have it appear automatically under the right card and the right
statement bucket — "duplicate a row and stay in sync". Chosen mechanism:
**one FILTER formula per bucket** (sync of membership, not just values —
fill in G and the row appears; change a 日期 and it moves buckets).
Rejected alternatives: per-row `=ref` mirrors (placement frozen at entry
time, breaks on row deletes) and a tool that writes both places (drifts
on later edits).

## Sheet-side design

### Expense-list contract

- **G (支付方式)** holds the exact card name — `國泰 CUBE`,
  `CHASE Amazon`, `CHASE Freedom Unlimited`, `Apple Card` — or stays
  blank for cash/transfer rows. Exact match is what the FILTERs key on.
- A row appears in the 對帳區 only when G is filled **and A has a real
  date**. Dateless recurring rows (subscriptions) stay out until Vincent
  dates them — deliberate; the FILTER picks them up the moment a date
  lands.

### Card-block layout (each block, relative to its title row T)

| row | content |
|-----|---------|
| T | card name |
| T+1 | 本月結帳日 (date value in the block's 3rd column) |
| T+2 | 本月繳款日 (date value) |
| T+3 | 本期帳單總額 — the statement that **closed this month** |
| T+4 | 本月需繳 — what is actually due this month |
| T+5 | 結帳日前 label + 小計 (3rd column) |
| T+6 | 日期 項目 金額 header |
| T+7 … T+18 | FILTER spill cushion (12 empty rows) |
| T+19 | 結帳日後 label + 小計 |
| T+20 | 日期 項目 金額 header |
| T+21 … T+32 | FILTER spill cushion (12 empty rows) |

2×2 grid preserved; blocks grow to ~33 rows each. If a bucket ever
outgrows its cushion the FILTER shows #REF! and the fix is inserting
rows (a whole-row insert widens the horizontally-adjacent block's
cushion too, which is harmless).

### Formulas (國泰 CUBE example — block at H51, 結帳日 in J52)

- **結帳日前 FILTER** (first cushion row, block's 1st column):
  `=IFERROR(FILTER({A3:A, B3:B, E3:E}, G3:G="國泰 CUBE", A3:A<>"", A3:A<=J52), )`
- **結帳日後 FILTER**: same with `A3:A>J52`.
- **小計** (spill-proof, never depends on the FILTER):
  `=SUMIFS(E3:E, G3:G, "國泰 CUBE", A3:A, "<="&J52, A3:A, ">0")`
  (the `">0"` condition excludes blank dates, which would otherwise
  coerce to 0 and pass `<=`).
- **金額/小計 column** is the card's **billing currency**: D (美金) for
  the three US cards, E (新臺幣) for 國泰 CUBE.
- **本期帳單總額** = previous tab's 結帳日後小計 + this tab's
  結帳日前小計 (cross-tab reference on the first term).
- **本月需繳** wires by the card's **statement lag** — which month's
  close this month's 繳款日 pays:
  - lag 0 (CHASE Amazon: 7/28 pays the 7/3 close) → `=` this tab's
    本期帳單總額.
  - lag 1 (國泰 CUBE: 7/6 pays the 6/19 close; CHASE Freedom Unlimited:
    7/13 pays the 6/10 close; Apple Card: 7/31 pays 六月帳單) → `=`
    the **previous tab's** 本期帳單總額.

Whole-column ranges (`A3:A`, `G3:G`, …) mean the expense window can grow
or shrink freely — no window tracking. Safe because nothing else on a
monthly tab writes into columns A–G below the expense list (the income
and 銀行餘額 blocks use B–D; everything east lives in H+).

### July bootstrap

6月 has no 對帳區, so on 7月 the prev-tab terms have nothing to point
at. On 7月 only: the previous-month half of each 本期帳單總額 and the
本月需繳 of the three lag-1 cards are **hand-entered numbers** (from the
actual bills). 8月 onward is fully wired by start_month.

### One-time setup

The 7月 blocks are rebuilt in place to the layout above (update_range
against the dev copy first, verified, then prod). The 結帳日/繳款日
dates already on the sheet are kept.

## Tool-side design

### `src/conventions.ts` — column-shift sync

- `MONTH_COLS` gains `paidMethod: 6` (G).
- `TRANSFER_COLS` shifts +1 → H–N (date 7 … extra 13).
- `LUNCH_COLS` shifts +1 → P–R (date 15, item 16, amount 17).
- Grid-read constants widen to cover the moved/southern sections
  (lunch column now R; the 對帳區 runs to ~row 116): the A1:Q120-style
  reads become A1:R160.
- **Verify 8月/9月 during implementation**: a column insert applies only
  to the tab it was made on. If the pre-created 8月/9月 tabs are still
  on the old geometry, fix them on the sheet (insert the same G column)
  rather than making the code bilingual.

### `src/conventions.ts` — credit-card section constants

- `CREDIT_SECTION_LABEL = "信用卡帳單對帳區"` plus row labels:
  本月結帳日, 本月繳款日, 本期帳單總額, 本月需繳, 結帳日前, 結帳日後,
  小計.
- `CREDIT_CARDS` registry — the single source of truth the formulas,
  add_expense validation, and start_month all read:

  | name | billingCurrency | statementLag |
  |------|-----------------|--------------|
  | 國泰 CUBE | TWD | 1 |
  | CHASE Amazon | USD | 0 |
  | CHASE Freedom Unlimited | USD | 1 |
  | Apple Card | USD | 1 |

### `add_expense`

Optional `paidWith` param, validated against `CREDIT_CARDS` names (exact
string; error lists the valid names), written to G. No new tool for the
對帳區 itself — FILTER does the mirroring.

### `start_month`

Tab duplication already copies the section; the FILTERs are same-tab
whole-column references and recompute against the new tab's expense list
untouched. New work, per card block:

1. **Bump 本月結帳日 / 本月繳款日 one month** (serial date +1 month,
   day clamped to the target month's length: 7/31 → 8/31 → 9/30).
2. **Rebuild 本期帳單總額 and 本月需繳 from the registry** — written
   fresh every month (prev-tab term pointed at the new previous tab,
   lag applied), which also erases 7月's hand-entered bootstrap literals
   when 8月 is created. Same rewiring pattern as the 上月…透支 /
   上月…餘額 anchors.
3. **Widen the one-off row deletes to A–G** (`deleteRange`
   `endColumnIndex: 7`): the expense row now includes G, and the
   existing A–F scope would orphan the deleted rows' 支付方式 cells and
   shift them onto the wrong rows.

Recurring rows keep their G value across months (Netflix stays on its
card) — harmless while they're dateless, correct once dated.

### CONVENTIONS_TEXT

New monthly-tab bullet: the 對帳區's location and block layout, exact
card names in G, the dated-rows-only rule, per-card billing currency,
the 本期帳單總額 / 本月需繳 lag wiring, that the FILTER outputs and
小計s are formula-owned (never hand-edit; log expenses with add_expense
and a `paidWith`), and 7月's hand-entered bootstrap cells. The 支付方式
column joins the header-row description; the transfer/lunch bullets get
their new column letters.

## Testing

Vitest, same mocked-`SheetsClient` style; the shared month-grid fixture
gains column G and a 對帳區 block pair.

- conventions: `CREDIT_CARDS` shape; shifted `TRANSFER_COLS` /
  `LUNCH_COLS` (existing transfer/lunch tests updated for the new
  columns — they double as the shift's regression suite).
- add_expense: `paidWith` writes G; unknown card name errors and names
  the valid cards; omitted `paidWith` leaves G untouched.
- start_month: date bumps incl. end-of-month clamp; 本期帳單總額 /
  本月需繳 rebuilt against the right tabs for lag 0 and lag 1; one-off
  deletes scoped A–G; tabs without the section skip silently.

## Out of scope

- `month_summary` per-card dues — add later if wanted.
- Card tracking in the lunch log (no 支付方式 column there).
- Two-way sync (editing a 對帳區 row back into the expense list) —
  impossible with formulas; the 對帳區 is read-only by design.
- Backfilling the section onto pre-7月 tabs.
- Auto-detecting 結帳日 changes the bank makes (dates are bumped
  mechanically; Vincent corrects odd months by hand).
