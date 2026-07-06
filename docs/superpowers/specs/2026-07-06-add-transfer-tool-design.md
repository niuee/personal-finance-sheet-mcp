# add_transfer — 乾坤大挪移 NTD→USD transfer entry tool

**Date:** 2026-07-06
**Status:** Approved by Vincent

## Background

Monthly tabs from 7月 2026 carry a 乾坤大挪移 section — a log of NTD→USD
currency transfers — at G33:M36 in 7月:

- G33: `乾坤大挪移` title
- Row 34 headers: G=日期, H=新臺幣, I=當下美金, J=實際美金, K=匯差,
  L=手續費, M=當筆總額外花費
- Data rows from 35 down
- 總和 row (36 in 7月): label in G, `=sum(H35)`-style totals in H–M

The section is wired into the 銀行餘額 block: 總美金餘額 adds `+J36`
(actual USD received), 總新臺幣餘額 subtracts `-H36` (NTD sent), and
新臺幣支出 adds `+M36` so the combined 匯差+手續費 counts as NTD monthly
spending. The transfer principal deliberately bypasses 月美金餘額 /
月新臺幣餘額 — a transfer is not income or spending; only the fees hit
the month.

`start_month` duplicates the previous tab, so 8月 onward inherits the
section. Vincent logs transfers by hand today; he wants a one-call MCP
tool.

## Tool surface (`src/tools.ts`)

New tailored tool `add_transfer`:

| param | type | required | meaning |
|-------|------|----------|---------|
| `ntd` | number | yes | NTD debited from the bank (新臺幣, H) |
| `usd` | number | yes | 實際美金 — USD that actually arrived (J) |
| `fee` | number | yes | 手續費 in NTD (L) |
| `date` | string | no | Same M/D / MM/DD / YYYY-MM-DD parsing as add_expense; **defaults to today in Taipei** (a transfer always happens on a real day) |
| `month` | 1–12 | no | Target month tab; defaults to current month |

## Row semantics

Vincent enters 日期, 新臺幣, 實際美金, 手續費; the rest are formulas:

- I 當下美金 = `=H{r}/{rate}` — NTD at the spot rate
- K 匯差 = `=(I{r}-J{r})*{rate}` — spread in NTD
- M 當筆總額外花費 = `=K{r}+L{r}`

`{rate}` is the USDTWD spot rate **frozen at entry time** (a literal
number like `29.85`), so 匯差 stays what it was on transfer day instead
of drifting with the live market.

### Rate freezing mechanism

No external FX API. The tool writes
`=GOOGLEFINANCE("CURRENCY:USDTWD")` into the new row's I cell, reads
the computed value back, then rewrites I and K pinned to that number.
The row itself is the scratch cell; nothing else is touched. If the
read-back is non-numeric (GOOGLEFINANCE hiccup), fail with a clear
error and clear the scratch formula.

## Placement logic (`src/finance-ops.ts`)

`addTransfer(client, params)` mirrors `addExpense`:

1. Read the tab grid as FORMULA; fail closed on truncation.
2. Find the `乾坤大挪移` anchor cell → header row below it → the 總和
   row below that (label in the anchor's column). Clear error if the
   section is missing (pre-7月 tabs): "no 乾坤大挪移 section on this
   tab".
3. Target row = first fully-empty row (across G–M) between the header
   and 總和 rows. If none, insert a sheet row directly above the 總和
   row (`inheritFromBefore`); cross-references like the ledger's
   `+J36` / `-H36` / `+M36` shift automatically.
4. Write the entry (values for G/H/J/L, formulas for I/K/M; 日期
   formatted mm/dd like expense dates).
5. **Rewrite the 總和 formulas** in H–M to
   `=SUM(H{firstData}:H{lastData})` (per column) every time — the
   current single-cell `=sum(H35)` cannot auto-extend, so the tool
   owns the sum range.

## Errors

- Section anchor / header / 總和 row not found → descriptive error.
- Grid read truncated → refuse (existing `assertNotTruncated`).
- GOOGLEFINANCE read-back non-numeric → error, scratch cleared.

## Return value

`{ tab, row, date, ntd, usd, rate, spread (匯差), fee, extraCost
(當筆總額外花費) }` — computed numbers echoed so the caller sees the
spread immediately.

## Conventions

Add a paragraph to `src/conventions.ts` documenting the 乾坤大挪移
section layout, its ledger wiring, and that `add_transfer` is the
preferred way to log a transfer.

## Testing

Unit tests in `test/finance-ops.test.ts` alongside the existing
`addExpense` tests, using the same mocked `SheetsClient` style:
happy path into an empty row, full-section row insert, sum rewrite,
missing-section error, rate pinning (formulas contain the literal
rate), non-numeric rate failure.
