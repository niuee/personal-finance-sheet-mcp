# Date-aware expense placement

2026-07-08. Keep the monthly expense list date-sorted as rows are added and
dated, so a hand sort in the UI survives tool writes.

## Ordering convention

Matches an ascending date sort in Google Sheets:

- Dated rows ascend by 日期 (column A serial).
- Ties keep insertion order: a new row lands AFTER existing rows with the
  same date.
- Dateless rows sort last, keeping their relative order. A dateless
  `add_expense` therefore lands at the very end of the window.
- The 上月透支 carry rows (上月美金透支 / 上月新臺幣透支 / legacy 上月透支)
  are pinned: no insert ever lands above them, even for a date earlier than
  theirs (a backdated entry from before month start).

The tools MAINTAIN order; they never sort. An unsorted list stays unsorted
until Vincent sorts it once by hand — the placement rule degrades gracefully
there (see below).

## add_expense placement

Replace the current "first fully-empty row, else insert at window end" with:

1. Locate the expense window from the 花費總額 `=SUM(Estart:Eend)` as today
   (`findExpenseWindow`); scan rows `start .. min(end, totalRow-1)`.
2. Compute `targetRow`:
   - Dated expense: one past the LAST scanned row whose 日期 is a number
     `<= ` the new serial. If none qualifies, the first row after the carry
     rows. Clamp to after the last carry row (identified by 項目 label).
   - Dateless expense: one past the last non-empty scanned row (end of list).
3. If the row at `targetRow` is fully empty, write in place (no structural
   change). Otherwise `insertDimension` at `targetRow` — strictly inside the
   SUM window, so the SUM, both 支出 SUMIFs, the 現金支出 SUMIFS, and the
   編列預算 INDEX/MATCH all auto-extend, exactly as the current window-end
   insert does.
4. Row write, 支付幣別/支付方式 validation, and the credit-bucket guard are
   unchanged — the guard keys on values, not positions.

On an unsorted list the rule places the row after the last not-later dated
row, which is "near the end" — no worse than today, and exact sorted-insert
once the list has been sorted once.

Empty rows that sit elsewhere in the window are no longer consumed
opportunistically; they persist until an insert happens to land on them.
Acceptable: live windows are full, and start_month's row deletes already
compact new tabs.

## set_expense_date relocation

After the existing date write (and bucket guard), when the row's sorted
position differs from where it sits, append a `moveDimension` request moving
the row to its computed position. `moveDimension` rewrites references like an
insert+delete pair: window ranges keep their size, `+D3`/`+E4` carry
add-backs follow their cells. Request order in the one `batchUpdate`: date
write first, bucket-guard inserts second (they touch rows below the window
only), `moveDimension` last, with source/destination computed from the
original grid (the guard's bucket-area inserts cannot shift window rows).
Mind the API semantics: `destinationIndex` is expressed in pre-move
coordinates.

The relocation target uses the same rule as add_expense (after the last row
dated `<=` the new date, ties-after, clamped below the carry rows), computed
as if the moving row were absent.

Return payload gains `movedToRow: number | null` (null when the row was
already in position).

## Error handling

Unchanged fail-closed style: bad date parses throw before any read; truncated
grid reads throw; a degenerate window (`end <= start`) refuses to insert. No
new failure modes.

## Testing

Unit tests for the shared position function: sorted list, unsorted list,
same-date ties, dateless-last, backdated-before-carry clamp, empty-row-at-
target reuse, dateless add at end. setExpenseDate: emits `moveDimension` with
correct pre-move indices; no move when already in position; move composes
with a bucket-guard insert in the same batch. Existing addExpense tests
updated where they assert the old placement.

## Out of scope

- Sorting the existing list (one-time hand sort in the UI).
- add_lunch / add_transfer / add_trip_entry — append-only logs, stay as is.
- insert_rows / append_rows / update_range remain position-dumb escape
  hatches.
