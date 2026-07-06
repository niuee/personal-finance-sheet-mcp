# add_lunch — 中餐預算 budget-section entry tool

**Date:** 2026-07-06
**Status:** Approved by Vincent

## Background

From 7月 2026 the 中餐 lunch spending is budget-based: the recurring 中餐
row in the expense list IS the budget (3,900 in 7月), and a new 中餐預算
section to the right of the grid logs the actual per-day lunch spending
against it. In 7月 the section sits at O34:Q40:

- O34: `中餐預算` title
- Row 35 labels: O=編列預算, Q=剩餘 (負數會加回去支出）
- Row 36 values: O=`=E15` (the 中餐 expense row — budget), Q=`=O36-Q40`
  (leftover)
- Row 37 headers: O=日期, P=項目, Q=金額
- Data rows from 38 down (日期 serial shown mm/dd, 項目, 金額 in NTD)
- 總和 row (40 in 7月): label in P, `=sum(Q38:Q39)` in Q

Wiring into the 銀行餘額 block: a new row 午餐超支或回補 (`=Q36`, the
leftover) sits between 新臺幣支出 and 上月新臺幣餘額, and the ledger
splits into 預計總新臺幣餘額 (`=上月+收入-支出-H總和`) and
總新臺幣餘額 (`=預計 + 午餐超支或回補`). An unspent budget flows back
to the bank balance (回補); an overdraft makes the leftover negative and
deducts more (超支). Mid-month the leftover is simply the budget not yet
eaten — only the month-end value is a true refund.

`start_month` duplicates the previous tab, so 8月 onward inherits the
section; the budget `=E15` and leftover formulas are same-tab relative
references and survive duplication as-is.

## Tool surface (`src/tools.ts`)

New tailored tool `add_lunch`:

| param | type | required | meaning |
|-------|------|----------|---------|
| `amount` | number | yes | 金額 in NTD (Q) |
| `item` | string | no | 項目 (P); **defaults to 中餐** so the common call is just the amount |
| `date` | string | no | Same M/D / MM/DD / YYYY-MM-DD parsing as add_transfer; **defaults to today in Taipei** |
| `month` | 1–12 | no | Target month tab; defaults to current month |

## Constants (`src/conventions.ts`)

- `LUNCH_SECTION_LABEL = "中餐預算"`, `LUNCH_TOTAL_LABEL = "總和"`,
  `LUNCH_DEFAULT_ITEM = "中餐"`, `LUNCH_ADJUST_LABEL = "午餐超支或回補"`.
- `LUNCH_COLS = { date: 14 /* O */, item: 15 /* P */, amount: 16 /* Q */ }`.
- CONVENTIONS_TEXT gains a monthly-tab bullet describing the section, its
  bank-block wiring (午餐超支或回補 = the section's 剩餘;
  總新臺幣餘額 = 預計總新臺幣餘額 + 午餐超支或回補), that the 中餐 row
  in the expense list is the budget — actual lunches do NOT go into the
  expense list — and that add_lunch is the way to log one. The closing
  "prefer the tailored tools" line adds add_lunch.

## Section location (`src/finance-ops.ts`)

New grid constant `LUNCH_GRID_READ = "A1:Q120"` (the section sits right
of the transfer block's M; the deeper window is needed because the lunch
section grows one row per entry and pushes the 銀行餘額 block below it
downward — a too-shallow read makes start_month's 上月…餘額 rewire
silently skip).

`findLunchSection(values, tab)` mirrors `findTransferSection`, but does
not assume a fixed offset from the anchor to the header: add_transfer's
full-section path inserts a whole sheet row directly above the transfer
總和 row, and on live geometry that insert can land between this
section's anchor and its header, opening a blank row that a fixed
anchor+3 offset would miss.

1. Anchor: `中餐預算` in column O.
2. Scan column O from anchor+1 through anchor+8 (inclusive) for `日期`
   → `headerRow`; descriptive error (naming the 8-row window) when not
   found.
3. `budgetRow` = `headerRow` − 1 — the 編列預算/剩餘 values row always
   sits directly above the header, because a whole-row insert above the
   transfer 總和 shifts the values row and the header down together, so
   this adjacency holds regardless of how many blank rows opened up
   between the anchor and the header.
4. Scan column P below the header for `總和` → `totalRow`; error when
   missing.

Returns `{ budgetRow, headerRow, totalRow }`. Missing anchor →
"no 中餐預算 section on this tab (exists from 7月 2026 on)".

Label matching works identically on FORMULA and UNFORMATTED renders
(labels are plain strings), so month_summary can reuse the finder.

## Placement logic

`addLunch(client, params)` mirrors `addTransfer` (minus rate pinning):

1. Parse the date before any read/write so a bad date fails closed.
2. FORMULA-read `LUNCH_GRID_READ`; fail closed on truncation;
   `findLunchSection`.
3. Target row = first fully-empty row across O–Q between the header and
   總和. If none, insert a sheet row directly above 總和
   (`inheritFromBefore: true`) — the 銀行餘額 block below shifts down
   and every reference (same-tab and next month's cross-tab
   上月…餘額) adjusts automatically, same argument as add_transfer.
4. Write O=date serial (mm/dd number format), P=item, Q=amount.
5. **Rewrite the 總和 formula** in Q to
   `=SUM(Q{firstData}:Q{lastData})` every time — the hand-written
   `=sum(Q38:Q39)` cannot auto-extend, so the tool owns the range.
6. Read the budget values row (O/Q at `budgetRow`, UNFORMATTED) after
   the write and echo the state.

### Return value

`{ tab, row, inserted, date, item, amount, budget (編列預算), spent
(總和), leftover (剩餘) }` — leftover < 0 means the budget is overdrawn
and the excess is counting against 總新臺幣餘額.

### Errors

- Section anchor / header / 總和 row not found → descriptive error.
- Grid read truncated → refuse (existing `assertNotTruncated`).

## start_month changes

Two changes, both in `startMonth`:

1. **Widen the read** from `GRID_READ` (A1:H60) to `LUNCH_GRID_READ`
   (A1:Q120) so the lunch section is visible.
2. **Clear the lunch data rows**: when `findLunchSection` succeeds on
   the duplicated tab, add a `repeatCell` clearing `userEnteredValue`
   over O–Q between the header and 總和 rows. Cells are cleared, not
   deleted, so nothing shifts; the 總和 `=SUM` over the now-empty window
   reads 0 and the leftover resets to the full budget. Tabs without the
   section (pre-7月) skip this silently.
3. **Scope the one-off row deletes to columns A–F**: replace the
   whole-row `deleteDimension` requests with `deleteRange`
   (`startColumnIndex: 0, endColumnIndex: 6, shiftDimension: "ROWS"`),
   still issued bottom-up. Today a whole-row delete of an ad-hoc income
   row can rip through the same sheet row in G–Q — in 7月's geometry,
   deleting the 多一個月薪水 row would destroy the 乾坤大挪移 header row
   AND the 中餐預算 title. With the scoped delete, A–F contracts while
   G–Q stays put; Sheets adjusts references across the boundary in both
   directions (the budget cell's `=E15` follows the 中餐 row when rows
   above it are removed; the bank block's `+J/−H/+M` and `=Q` references
   keep pointing at the unmoved section cells). The existing "writes
   before deletes shift in lockstep" argument still holds — every
   earlier `updateCells` in the batch targets columns A–F. The lunch
   `repeatCell` clear targets O–Q, which the scoped deletes never touch,
   so its pre-computed row indices stay valid regardless of ordering.

## month_summary changes

- Widen its read to `LUNCH_GRID_READ`.
- New fields, all `null` on tabs without the section:
  - `午餐超支或回補` — from the bank block row (by label in column B).
  - `中餐預算: { 編列預算, 總和, 剩餘 } | null` — from the section's
    values row and 總和 row via `findLunchSection` (wrapped so a missing
    section yields null instead of throwing).

## Testing

Unit tests in `test/finance-ops.test.ts` alongside the transfer tests,
same mocked `SheetsClient` style. The shared month-grid fixture gains
the O–Q section:

- `findLunchSection`: happy path, missing anchor, malformed header,
  missing 總和.
- `addLunch`: write into an empty row; full-section insert above 總和
  with the SUM rewrite spanning the grown window; default item/date;
  explicit date parsing; budget/spent/leftover echo; missing-section
  error.
- `startMonth`: lunch data rows cleared (repeatCell over the right O–Q
  window); one-off deletes are `deleteRange` scoped to A–F; tabs
  without the section unaffected.
- `monthSummary`: new fields populated on a section tab, null on a
  pre-section tab.

## Out of scope

- Clearing the 乾坤大挪移 data rows on start_month — transfers are rare
  and managed by hand; revisit if it bites.
- `set_income`'s full-window `insertDimension` (a whole-row insert) can
  still open a one-row gap through the G–Q sections. Formulas survive
  (references adjust); the drift is cosmetic. Known issue, not fixed
  here.
- Multiple budget sections / a generic `add_budget_entry` — YAGNI until
  a second budget-based category exists.
- Backfilling the section onto pre-7月 tabs.
