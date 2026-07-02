# Safety Tools (v4) — Design

**Date:** 2026-07-02
**Status:** Approved (design discussed and approved in-session)
**Motivation:** A real incident: Claude web, after `add_trip_entry` refused (pre-v3
limitation), fell back to `update_range` with a hand-counted row number, was off
by one, and silently overwrote an existing row. The sheet owner's post-mortem
requested (1) mosaic support — shipped in v3 — plus (3 more) safety affordances
this design delivers.

## Changes

### 1. `update_range`: read-before-write seatbelt + undo data

New op `safeUpdateRange(client, range, values, expectEmpty)` in
`src/finance-ops.ts`:

- Reads the target range first (`FORMULA` render) — this read is the safety
  mechanism (two API calls, deliberately not atomic).
- **`expectEmpty === true`**: if ANY cell in the read result is non-empty,
  refuse with an error listing the non-empty cells as A1 addresses (e.g.
  `Q29, R29`) and their values — nothing is written.
- On write, the response includes **`previousValues`**: the pre-write contents
  (row-annotated, formulas included), so any overwrite can be reverted by
  copy-paste.
- Tool schema: `update_range` gains `expect_empty: z.boolean().optional()`
  (default **false** — editing existing cells is the tool's normal job). The
  description instructs Claude to pass `true` whenever it believes the target
  is empty (append-like writes), and warns that omitting it overwrites
  unconditionally.

### 2. `find_cells`: search instead of counting

New op `findCells(client, { query, tab?, match? })` in `src/finance-ops.ts`
and tool `find_cells`:

- `match`: `"contains"` (default, case-insensitive) or `"exact"` (trimmed,
  case-sensitive).
- Searches the given tab, or EVERY tab when `tab` is omitted (`listTabs` +
  one read per tab, formatted values).
- Returns `{ matches: [{ tab, cell: "Q29", row, column, value }...],
  truncated }` — capped at 50 matches (`truncated: true` when the cap or a
  truncated tab read may have hidden matches; per-tab read truncation is
  surfaced, never silent).
- Column letters via the existing `colLetter` helper.

### 3. `read_range`: explicit row numbers

- New pure helper `annotateRows(range, values)` in `src/finance-ops.ts`:
  parses the range's starting row (from the range string the API echoes,
  e.g. `'9 月'!A3:F60` → 3; a bare tab name or column-only range → 1) and
  returns `{ startRow, rows: [{ row, values }...] }` with **empty rows
  omitted** (their absence is unambiguous because every kept row carries its
  real sheet row number).
- The `read_range` TOOL response becomes
  `{ range, startRow, rows, truncated }` (transform applied in the tool
  handler). `update_range`'s `previousValues` uses the same annotated shape.
- `SheetsClient.readRange` and all internal ops (month/trip logic) are
  unchanged — this is a tool-layer presentation change only.

## Error handling

Same fail-closed doctrine: `expect_empty` violations name the offending
cells and write nothing; `find_cells` never silently drops matches (cap and
read-truncation are both reported); unknown tab in `find_cells` surfaces the
Sheets error for a bad range / lists tabs via the existing client error.

## Testing

- Unit: `annotateRows` (start-row parsing variants, empty-row omission),
  `safeUpdateRange` (previousValues content, expect_empty refusal with named
  cells + zero writes, pass-through on empty target), `findCells` (contains
  vs exact, multi-tab sweep, cap + truncation flags).
- Integration (scripted, against the copy sheet): find "Haruka"-style text →
  exact cell; `expect_empty: true` against an occupied row → refusal;
  against an empty row → write + previousValues shows prior emptiness;
  `read_range` row numbers match reality.
- Acceptance: in Claude web, "find the Haruka row" resolves to one call.

## Out of scope

- Making `expect_empty` default true (rejected: breaks the common
  edit-existing-cells case).
- Undo/history storage server-side; trash/restore tooling.
- Fuzzy matching in `find_cells`.
