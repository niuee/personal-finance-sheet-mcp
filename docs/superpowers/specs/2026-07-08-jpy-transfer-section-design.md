# 乾坤大挪移（日幣）— NTD→JPY transfer section on the trip tab

**Date:** 2026-07-08
**Status:** Approved by Vincent

## Background

Monthly tabs carry a 乾坤大挪移 section (NTD→USD transfer log, columns
H–N) fed by the `add_transfer` tool. Vincent now also exchanges NTD for
JPY ahead of the 2026/07/25 京都東京 trip and wants the same treatment.

Decisions made during brainstorming:

- The JPY section lives **on the trip tab** (`2026/07/25 京都東京`),
  not on the monthly tabs.
- The JPY received gets **no bank ledger** — it is trip cash; its 總和
  stays inside the section.
- The NTD side **does** wire into the monthly 銀行餘額 block, with
  **per-entry cross-tab references** so month attribution follows each
  transfer's date exactly (an August exchange lands in 8月, not 7月).

## Sheet section (trip tab)

Placed **below all existing content** (title around row 69 today; found
by anchor, never by fixed row), columns **A–G**:

- A{title}: `乾坤大挪移` title
- Header row: A=日期, B=新臺幣, C=當下日幣, D=實際日幣, E=匯差,
  F=手續費, G=當筆總額外花費
- Data rows below, kept date-sorted like the USD section
- 總和 row: label in A, `=SUM(B{first}:B{last})`-style totals in B–G,
  rewritten by the tool on every entry

Number formats: NTD currency for B/E/F/G, `¥` for C/D, real date values
formatted M/D in A (NOT the trip-entry `mm/dd hh:mm` text format — a
transfer is a bank event, and real dates keep month attribution
computable).

Bottom placement matters: trip tabs are a mosaic of column bands, and
per `src/conventions.ts` **whole sheet-row inserts are forbidden on
trip tabs** (they cut across all bands). When the section is full, the
tool inserts **cells scoped to columns A–G** (`insertRange`, shift
down), exactly as `add_trip_entry` does for full category blocks.
Sitting below everything means nothing else shares its rows today, and
block-scoped inserts keep it safe even if that changes.

The section is created **once by hand** (dev copy during E2E, prod
after merge) — the tool finds it by anchor and errors clearly when it
is absent, same contract as the USD section.

## Row semantics

Vincent enters 日期, 新臺幣, 實際日幣, 手續費; the rest are formulas:

- C 當下日幣 = `=B{r}/{rate}` — NTD at the spot rate
- E 匯差 = `=(C{r}-D{r})*{rate}` — spread in NTD
- G 當筆總額外花費 = `=E{r}+F{r}`

`{rate}` is the **JPYTWD** spot rate (TWD per JPY, ~0.21) frozen at
entry time as a literal number, using the existing scratch-cell trick:
write `=GOOGLEFINANCE("CURRENCY:JPYTWD")` into the new row's C cell,
read the computed value back, rewrite C and E pinned to it. Non-numeric
read-back → clear the scratch, fail with a descriptive error.

## Tool surface (`src/tools.ts`)

`add_transfer` grows a branch instead of a new tool:

| param | type | required | meaning |
|-------|------|----------|---------|
| `currency` | `"usd" \| "jpy"` | no, default `"usd"` | which transfer log to write |
| `tab` | string | jpy only | trip tab name, exactly as it appears (same as add_trip_entry) |
| `ntd` | number | yes | NTD debited (新臺幣) |
| `usd` | number | usd only | 實際美金 received |
| `jpy` | number | jpy only | 實際日幣 received |
| `fee` | number | yes | 手續費 in NTD |
| `date` | string | no | same parsing as today; defaults to today in Taipei |
| `month` | 1–12 | usd only | target month tab |

Validation: `currency: "usd"` (or omitted) behaves byte-for-byte like
today — existing calls are untouched. `currency: "jpy"` requires `tab`
and `jpy`, rejects `usd`/`month` (the wiring month comes from `date`).
Exactly-one-of `usd`/`jpy` mirrors add_trip_entry's jpy/twd guard. The
tool description gains a sentence describing the JPY mode.

## Placement logic (`src/finance-ops.ts`)

Generalize the existing section finder: `findTransferSection` takes a
section config `{ cols, gridRead, sectionLabel, headerLabels }` instead
of hard-coding `TRANSFER_COLS`/H–N, with two configs:

- `TRANSFER_COLS` (existing, month tabs, H–N, 美金 headers)
- `TRANSFER_JPY_COLS` (trip tab, A–G, 日幣 headers)

The jpy branch of `addTransfer`:

1. Read the trip tab grid as FORMULA (`TRANSFER_JPY_GRID_READ =
   "A1:G200"` — generous headroom over today's ~row 72 bottom); fail
   closed on truncation.
2. Find anchor → header row → 總和 row; clear error when missing.
3. Target row = first fully-empty A–G row between header and 總和;
   when full, **insert cells scoped to A–G** above the 總和 row (never
   a whole sheet row — trip-tab rule).
4. Write the entry date-sorted (same date-aware placement contract as
   PR #22), pin the rate, stamp the section's canonical formats.
5. Rewrite the 總和 sums in B–G to cover every data row.

## Month wiring (per entry)

After the row is written, resolve the month tab from the transfer date
(e.g. `7 月`) and append two terms to its 銀行餘額 formulas:

- 本月底新臺幣餘額: `-'2026/07/25 京都東京'!B{row}`
- 本月新臺幣支出: `+'2026/07/25 京都東京'!G{row}`

The exact target set must **mirror whatever NTD-side formulas the USD
總和 feeds on the live sheet** — verified during implementation by
reading which cells reference the USD section (including whether
保守預計本月底新臺幣餘額 carries a term). Cross-sheet references
auto-adjust when rows shift on the trip tab, so per-entry refs stay
pinned.

Safety: the tool locates each formula row by its label anchor, verifies
the cell already contains a formula, and appends the term — it never
rewrites the rest of the formula. Missing label / non-formula cell /
missing month tab → descriptive error, and the error message states
that the trip-tab row was already written (so the entry is not lost;
the wiring can be re-run or fixed by hand).

## Errors

- Section anchor / header / 總和 row not found → "no 乾坤大挪移 section
  on this trip tab" with a pointer to create it.
- Grid read truncated → refuse (`assertNotTruncated`).
- GOOGLEFINANCE read-back non-numeric → error, scratch cleared.
- Month-tab wiring failures → error that names what was and wasn't
  written.

## Return value

`{ tab, row, date, ntd, jpy, rate, spread (匯差), fee, extraCost
(當筆總額外花費), wiredMonthTab }` — same shape as the USD branch plus
the month tab the entry was wired into.

## Conventions

Extend the 乾坤大挪移 paragraph in `src/conventions.ts`: the JPY
variant on trip tabs (A–G anatomy, JPYTWD pinning, no JPY ledger,
per-entry month wiring), and that `add_transfer currency:"jpy"` is the
preferred way to log one.

## Testing

Unit tests in `test/finance-ops.test.ts` beside the existing
`addTransfer` tests, mocked `SheetsClient` style: jpy happy path,
block-scoped cell insert when full (assert no whole-row insert), 總和
rewrite, JPYTWD rate pinning, month-wiring formula append (both
targets, correct month from date), wiring-failure error mentions the
written row, param validation (jpy requires tab+jpy, rejects
usd/month), usd branch regression untouched.

E2E on the dev copy sheet (create the section there first), then after
merge: create the section on the prod trip tab and deploy.
