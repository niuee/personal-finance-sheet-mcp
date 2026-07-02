# Trip Mosaic Blocks (v3) — Design

**Date:** 2026-07-02
**Status:** Approved
**Builds on:** v2 (`2026-07-02-tailored-finance-tools-design.md`); modifies `add_trip_entry` and the trip conventions only.

## Problem

`add_trip_entry` (v2) assumes all trip category blocks sit side-by-side with
their titles in row 2. The real `2026/07/25 京都東京` tab is a **mosaic**:
four column bands (A–G, I–O, Q–W, Z–AF) with blocks **stacked vertically**
inside each band. Only the top row of blocks is currently reachable; the tab
actually has 12 categories: 模型, 書, 餐(當下吃的), 機票住宿, 雜支,
衣服/鞋子, 吃的伴手禮, 紀念品小物, 交通, 送禮, 入場券, 電子產品.

## Observed block anatomy (ground truth, read 2026-07-02)

- A block starts with a **header row**: `日期` in the band's first column,
  `店鋪` in the next (remaining headers vary: `臺幣 0.22 匯率` vs `臺幣`).
- The **category label** is on the row directly below the header, in the
  band's first columns.
- Data rows follow; most blocks end with a row whose band cells contain
  `分類總花費` (sometimes prefixed, e.g. `機票住宿分類總花費`). At least one
  block (雜支) has **no** such terminator.
- Bands are 7 data columns wide (日期, 店鋪, 品項, 支付方式, 日幣原價,
  臺幣…, 臺幣進位). Band starts observed at 0-indexed columns 0, 8, 16, 25.
- Some blocks (機票住宿-style) contain **TWD-direct rows**: 日幣原價 empty,
  臺幣 holds an NTD number, 臺幣進位 the rounded number.
- A budget-vs-actual summary section occupies the bottom-right of the grid
  (rows ~46–66) and must never be treated as block data.

## Decisions made during brainstorming

- **Full block → band-scoped cell insert** (revised with user approval after
  discovering three real blocks — 送禮, 入場券, 電子產品 — are exactly full):
  use the Sheets `insertRange` request with `shiftDimension: ROWS` scoped to
  the block's 7 columns, which shifts only that band down and cannot damage
  neighboring bands. Never `insertDimension` (whole sheet rows) on a trip
  tab. When inserting, the block's `分類總花費` SUM formulas are rewritten to
  cover the new row — and this requires them to be plain `=SUM(range)`
  formulas; anything else fails closed with guidance to add a row manually.
  The same rewrite extends a total whose range doesn't cover the target row
  on the non-insert path.
- **Support direct-TWD entries** in addition to JPY.
- Discovery is dynamic (no hardcoded category list) so new blocks Vincent
  adds are picked up automatically.

## Changes

### 1. `src/conventions.ts`

- Remove `TRIP_CATEGORY_ROW` (and its test) — obsolete single-row model.
- Keep `TRIP_BLOCK_WIDTH = 8` (7 data columns + 1 spacer) — now actually
  consumed by discovery.
- Add:
  - `TRIP_HEADER_DATE = "日期"`, `TRIP_HEADER_SHOP = "店鋪"` — the two-cell
    signature that identifies a block header row.
  - `TRIP_TOTAL_LABEL = "分類總花費"` — block terminator (substring match).
  - `TRIP_MAX_BLOCK_ROWS = 30` — scan cap for blocks with no terminator.
- Update `CONVENTIONS_TEXT`'s trip section to describe the mosaic layout,
  the 12 known categories, and the JPY/TWD entry shapes.

### 2. `src/finance-ops.ts` — block discovery

New exported helper (pure, unit-testable):

```
findTripBlocks(values: unknown[][]): Array<{
  category: string;
  headerRow: number;   // 1-indexed
  startCol: number;    // 0-indexed band start
  firstDataRow: number; // headerRow + 2
  endRow: number;       // exclusive boundary: the block's 分類總花費 row,
                        // or the next header row in the same band,
                        // or firstDataRow + TRIP_MAX_BLOCK_ROWS — whichever comes first
}>
```

Detection: cell (r, c) trimmed equals `日期` AND cell (r, c+1) trimmed
equals `店鋪` → header at (r, c). Category = first non-empty cell in row
r+1 within columns c..c+6 (skip the header if that row has none — defensive
against stray header copies). Duplicate category names: first occurrence
wins; later duplicates are reported in errors but not addressable (not
expected in practice).

### 3. `src/finance-ops.ts` — `addTripEntry` rewrite

- Params: `{ tab, category, date, shop, item, paymentMethod, jpy?, twd? }` —
  **exactly one** of `jpy`/`twd` must be present (validated in the op;
  descriptive error otherwise).
- Read `A1:AL200` FORMULA mode + truncation guard (unchanged).
- `findTripBlocks`, match `category` exactly (trimmed); on miss, error
  listing every discovered category.
- Target row = first row in `firstDataRow..endRow-1` whose 7 band cells are
  all empty. None → **fail closed**: "block 「X」 is full — add rows inside
  the block manually (a sheet-wide insert would damage neighboring blocks)".
- Total-coverage handling: both total cells (band cols +4 ¥ and +6 NTD) are
  read. When one parses as a plain `=SUM(<col><a>:<col><b>)` and its range
  does not cover the target row, it is rewritten to
  `SUM(min(a,target)..max(b,target))` — on both the empty-row and the
  insert paths. Non-formula cells are left alone. A non-plain formula is
  tolerated on the empty-row path (write proceeds; totals heterogeneous)
  but fails closed on the insert path, where extension is mandatory.
- Write via `updateRange` (USER_ENTERED), one row, band columns only:
  - JPY entry: `[date, shop, item, paymentMethod, jpy, twdFormula, roundFormula]`
    where the two formulas adapt the previous data row's (via
    `adaptRowFormula`), falling back to `=<jpyCol><r>*0.22` and
    `=CEILING(<twdCol><r>)`.
  - TWD entry: `[date, shop, item, paymentMethod, "", twd, roundFormula]`
    with `roundFormula = =CEILING(<twdCol><r>)`.
- Return `{ tab, category, row, updatedRange, currency: "JPY" | "TWD" }`.

### 4. `src/tools.ts`

`add_trip_entry` schema: `jpy` becomes optional, add optional `twd`
(numbers); description states "provide exactly one of jpy or twd" and names
example categories from the real tab. Everything else unchanged.

## Error handling

Same fail-closed doctrine as v2: unknown category lists the real ones;
full block refuses with guidance; ambiguous jpy/twd input refuses; truncated
reads refuse; SUM cross-check (when parseable) refuses out-of-window writes.
All validation precedes the single `updateRange` write.

## Testing

- Unit (vitest): `findTripBlocks` against a fixture reproducing the real
  mosaic (4 bands, stacked blocks, prefixed 分類總花費, the terminator-less
  雜支 case, the bottom summary section that must NOT be detected as
  blocks); addTripEntry JPY + TWD paths, full-block refusal, jpy/twd
  exclusivity, SUM cross-check pass/fail, unknown-category error listing
  all 12.
- Integration: Inspector against the copy sheet's trip tab — one JPY entry
  into a stacked block (e.g. 電子產品), one TWD entry into 機票住宿, one
  full-block/unknown-category error.
- Acceptance: Claude web adds a real purchase to a previously unreachable
  category.

## Out of scope

- Creating new category blocks or trip tabs.
- Trip totals/summary tool.
- Batch entry.
- The bottom budget-vs-actual section.
