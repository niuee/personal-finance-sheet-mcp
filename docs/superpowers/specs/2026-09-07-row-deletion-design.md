# Row Deletion (delete_expense / delete_rows) — Design

**Date:** 2026-09-07
**Status:** Implemented

## Context

Nothing in the toolset could remove a row. `update_range` can only blank
cells — writing `""` leaves the row itself in place, so a deleted expense
becomes a hole in the middle of the list, the 日期 sort has a gap, and the
list keeps growing. The complement of `insert_rows` was simply missing.

Deleting a row on this spreadsheet is not the trivial operation it looks
like, which is why it needs tools rather than raw advice:

- **Monthly and trip tabs are mosaics.** The expense list owns A–G, the
  乾坤大挪移 log and the 信用卡帳單對帳區 own H–N, the 午餐預算 log owns
  P–S; a trip tab stacks blocks in four bands. A whole-row
  `deleteDimension` inside one section rips through whatever block
  straddles the row in the other columns — the same hazard the band
  INSERTS (`bandInsert`, `startMonth`'s one-off clearing) already avoid.
- **Formulas react in two different ways.** A range spanning the deleted
  rows (花費總額's `=SUM(E3:E10)`, every 支出 SUMIF, the 對帳區 mirrors)
  shrinks and keeps working. A formula naming a single deleted cell turns
  into `#REF!` — the 午餐預算 block's 編列預算 `=E5` pointing at the 中餐
  expense row is exactly this, and it is invisible from the row being
  deleted.

## Approach

Two tools, matching the existing split between tailored ops and raw ops
with seatbelts:

- `delete_expense` — the common case, fully tailored: find the row by 項目
  inside the expense window, delete scoped to A–G, audit the 對帳區.
- `delete_rows` — the general escape hatch, mirroring `insert_rows`, with
  an optional `columns` band and a reference check before it commits.

Both refuse rather than guess, and both return what they removed so a
mistaken delete can be re-entered by hand.

### Why a reference scan

The 編列預算 `=E5` case makes silent `#REF!` damage a realistic outcome of
an otherwise reasonable delete. `findBrokenRefs` scans the tab's FORMULA
grid for SINGLE-cell references landing in the deleted band+rows:

- range references are ignored — they shrink, which is the whole reason
  the SUM windows survive an insert or delete inside them;
- cross-tab references are ignored — this scan sees one grid, and no
  cross-tab formula on this sheet points at an individual expense row
  (they point at 收支狀況 / 小計 / 餘額 anchors);
- formulas inside the deleted cells are skipped — they go away too;
- quoted strings are stripped first, and the column+row match carries the
  same lookbehind `adaptRowFormula` uses so `LOG10(...)` is not read as
  column OG row 10.

`delete_rows` turns a hit into a refusal listing the offending cells, with
`force: true` to override (it then reports what it broke). `delete_expense`
always refuses — its whole point is that the caller should not have to know
about the lunch block.

### Bucket audit on delete

Every monthly write audits the 信用卡帳單對帳區 so hand-entered rows that
overflowed a spill area get healed. `delete_expense` keeps that contract but
audits a copy of the grid with the deleted row's A–G cells blanked: the
charge that is going away must not be counted into its bucket's required
rows (that would grow the bucket by one for nothing), while every other
bucket still gets its chance to heal. The delete is band-scoped to A–G, so
the section's own rows (H–N) do not move — `rowOffset` stays 0.

## Changes

### sheets-client.ts
- `deleteRows(tab, row, count, band?)` — `deleteDimension` for whole rows,
  `deleteRange` + `shiftDimension: "ROWS"` when a band is given.

### finance-ops.ts
- `ColumnBand`, `EXPENSE_BAND`, `parseColumnBand("A:G" | "R")`.
- `findBrokenRefs(values, band, startRow, endRow)` → `BrokenRef[]`.
- `safeDeleteRows(client, {tab, row, count, columns?, force?})`: reads the
  tab (FORMULA), records the rows being removed, runs the reference scan,
  then deletes. A truncated tab read degrades to a narrow read of the
  target plus a `refWarning` saying the scan did not run.
- `deleteExpense(client, {item, month?, row?})`: expense-window lookup with
  no guessing between duplicates, refuses the 上月…透支 carry rows, refuses
  a single-row window, refuses on a broken reference, deletes A–G, audits
  the 對帳區 against the post-delete grid.

### tools.ts
- `delete_expense` (tailored) and `delete_rows` (raw), both routing errors
  through the existing `toError` wrapper.

### conventions.ts / README.md
- CONVENTIONS_TEXT: removing an expense means deleting the row; the trip-tab
  bullet now covers deletes; the closing advice names both tools and the
  section bands to scope them to.

## Testing

- `test/sheets-client.test.ts`: both request shapes (whole row / band).
- `test/finance-ops.test.ts`: `parseColumnBand`; `findBrokenRefs` (single
  ref, absolute ref, ranges, cross-tab, quoted strings, function-name
  digits, out-of-band, self-referential deleted cells); `safeDeleteRows`
  (whole row, band scoping and slicing, refusal + force, truncated
  fallback); `deleteExpense` (band-scoped request, carry rows, missing item,
  duplicate 項目, the 編列預算 `=E5` refusal, single-row window, the
  post-delete bucket audit both ways, truncated read).

## Out of scope

- Tailored deletes for the lunch / transfer / income / trip logs — those go
  through `delete_rows` with the section's band, which is what the
  conventions text now tells the caller to do.
- Undo: `deletedValues` is a record, not a restore path (re-entering a row
  is `insert_rows` + `update_range`, or just re-running the add tool).
- Cross-tab reference checking (another tab's formula pointing at a deleted
  cell); no such formula exists on this sheet today.
