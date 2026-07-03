# Monthly-Tab Date Column — Design

**Date:** 2026-07-03
**Status:** Approved

## Context

Vincent inserted a date column as column A in the monthly spending tabs, shifting
every monthly-tab column one to the right. The tailored tools (`add_expense`,
`month_summary`, `start_month`) and `CONVENTIONS_TEXT` still describe the old
geometry and now mis-locate every anchor.

Verified layout on the live sheet (6–9月; 5月 predates the standardized layout
and was never tool-compatible, so it stays unsupported):

| Thing | Was | Now |
|---|---|---|
| Header row 2 | — | 日期, 項目, 美金, 新臺幣 |
| Expense row | A=item, B=USD, C=TWD | A=date, B=item, C=USD, D=TWD |
| USD conversion | `C=B*GOOGLEFINANCE` | `D=C*GOOGLEFINANCE` |
| 花費總額 | label col B, total col C `=SUM(C:C)` | label col C, total col D `=SUM(D:D)` |
| Category block | labels col E, formulas col F | labels col F, formulas col G |
| Budget block | labels col A, values col B | labels col B, values col C |

Dates are real date serials displayed as `MM/DD` (e.g. `07/01`). Recurring rows
carry blank dates; only dated one-off entries fill column A.

## Approach

Remap the layout constants (conventions.ts is the declared single source of
truth), replacing scattered magic column indices in finance-ops.ts with named
constants. Dynamic header detection was considered and rejected as YAGNI.

## Changes

### conventions.ts
- Add named 0-indexed column constants for the monthly layout: date=0 (A),
  item=1 (B), usd=2 (C), twd=3 (D), category label=5 (F), category
  formula=6 (G), budget label=1 (B), budget value=2 (C), total label=2 (C),
  total value=3 (D).
- Update `CONVENTIONS_TEXT`: expense list in A–D from row 3 (A=日期 shown
  `MM/DD`, B=item, C=美金, D=新臺幣), USD conversion `D = C*GOOGLEFINANCE`,
  花費總額 label in C / total in D with the SUM window over D, summary labels
  in F / formulas in G, budget block labels in B / values in C (now also
  includes 新臺幣支付).

### finance-ops.ts
- `GRID_READ` widens `A1:F60` → `A1:H60`.
- `addExpense`:
  - All anchor lookups and writes shift per the table above; USD rows write
    `=C{row}*GOOGLEFINANCE("CURRENCY:USDTWD")`; category sums get `D{row}`
    spliced in; post-insert ref adjustment targets column D.
  - New optional `date` string param. Accepted forms: `M/D`, `MM/DD`,
    `YYYY/M/D`, `YYYY-MM-DD`; a missing year defaults to the current year in
    Asia/Taipei. Invalid input throws.
  - When `date` is given it is parsed to a Sheets date serial (days since
    1899-12-30) and written to column A as `numberValue` with number format
    pattern `mm/dd` (own updateCells request so the format field mask doesn't
    touch the other cells). When omitted, column A is left untouched (blank).
  - Empty-row detection and the response payload include the date.
- `monthSummary`: pure column remap — 花費總額 label col C / value col D,
  上月透支 label now in column B, categories label F / value G, budget labels
  col B / values col C. Output shape unchanged.
- `startMonth`: column remap (item scan in B, overdraft label in B / formula
  in D, #REF-scrub of category formulas in G), plus one new request in the
  existing batch: clear `A3:A(花費總額row-1)` (fields=userEnteredValue) BEFORE
  the row deletions, so kept rows start the new month undated.

### tools.ts
- `add_expense` schema gains optional `date` with the accepted formats in its
  description. Other tool descriptions unchanged.

### Tests (test/finance-ops.test.ts, test/conventions.test.ts)
- Rewrite monthly-tab fixtures to the new grid.
- New cases: date parsing (`M/D`, explicit year, invalid → throw), date
  omitted leaves column A untouched, date given writes serial + format,
  start_month clears window dates before deletions.

## Out of scope
- Surfacing 追加日本預算 as a category or 多一個月薪水 / 新臺幣支付 in
  `month_summary` (easy follow-up).
- Any support for 5月's pre-standard layout.
- Trip tabs — unaffected.
