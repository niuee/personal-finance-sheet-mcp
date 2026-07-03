# get_categories Tool — Design

**Date:** 2026-07-03
**Status:** Approved

## Context

The 類別 column (C) on monthly tabs now carries a dropdown (data validation)
listing the canonical expense tags. The MCP server only knows a hardcoded
snapshot of those tags (`KNOWN_TAGS` in conventions.ts), so when Vincent edits
the dropdown in the sheet, the LLM's view goes stale. A new read-only tool,
`get_categories`, lets the LLM fetch the live list straight from the
validation rule.

Scope decision: read-only tool only. `add_expense` keeps accepting free-text
tags and does not validate against the fetched list (no extra API call per
expense, ad-hoc tags stay allowed).

## Approach

Probe a small window of the 類別 column (C3:C15 of the target month tab) with
a single field-limited `spreadsheets.get` request and take the first cell that
carries a validation rule. This is robust to the rule not starting exactly at
row 3 (row 3 is the recurring 上月透支 row) and costs one API call either way.

Alternatives rejected:
- Probe only C3 — brittle if the dropdown starts a row later or one cell's
  validation was cleared.
- Union rules across the whole column — pointless complexity; the column
  shares one rule in practice.

## Changes

### sheets-client.ts
- New method `getDataValidation(tab, startRow, endRow, col)`:
  `GET /spreadsheets/{id}?ranges='{tab}'!C{start}:C{end}&fields=sheets.data(startRow,rowData.values.dataValidation)`
  (range built from the col/row params; tab quoted with the existing
  `quoteTab`). Scans the returned grid data and returns the first non-empty
  rule as `{ type: string, values: string[] }` where:
  - `ONE_OF_LIST` → `values` = the rule's `userEnteredValue` entries.
  - `ONE_OF_RANGE` → `values` = one-element array holding the referenced
    range string (e.g. `=Settings!A1:A20`).
  Returns `null` if no cell in the window has a rule.

### finance-ops.ts
- New `getCategories(client, month?)`:
  - Resolves the tab via `monthTabName(month)` / `currentMonthTab()` (same
    pattern as `monthSummary`).
  - Calls `getDataValidation` over rows 3–15 of column C.
  - `ONE_OF_LIST` → dedup values, preserving order.
  - `ONE_OF_RANGE` → strip the leading `=` from the range string, read it with
    `client.readRange`, flatten non-empty string cells, dedup.
  - No rule found → throw
    `Error("No data validation found on the 類別 column of \"{tab}\" — the tab may predate the 類別 dropdown.")`
  - Returns `{ tab, categories, source }` with
    `source: "ONE_OF_LIST" | "ONE_OF_RANGE"`.

### tools.ts
- Register `get_categories` in `registerTailoredTools`, description:
  "List the canonical 類別 tags from the dropdown (data validation) on a
  monthly tab's 類別 column. Call this before add_expense when unsure which
  tag to use." Optional `month` 1-12 param (same `monthParam` schema as
  `month_summary`); errors flow through the existing `toError` wrapper.
- Update `add_expense`'s `tag` description to point at `get_categories` for
  the live list (keeping the `KNOWN_TAGS` examples as a hint).

### conventions.ts
- No behavior change. `KNOWN_TAGS` stays as documentation/fallback text.

## Testing

- `test/sheets-client.test.ts`: request shape (ranges + fields params),
  ONE_OF_LIST extraction, ONE_OF_RANGE extraction, first-rule-wins across the
  window, null when no rule.
- `test/finance-ops.test.ts`: ONE_OF_LIST happy path, ONE_OF_RANGE follows the
  referenced range and flattens/dedups, no-rule throws the tab-naming error,
  month defaulting to the current Taipei month.

## Out of scope
- Validating or warning on `add_expense` tags against the fetched list.
- Trip-tab category blocks (those are layout, not data validation).
- Caching the list between calls.
