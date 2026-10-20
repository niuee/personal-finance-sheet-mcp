# Per-Currency Budget Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Budget months carry a USD and an NTD budget, 總和 and 剩餘 for every category. A one-off `migrate_budget_split` tool moves the template, 11 月 and 12 月 to that layout in place, and every budget-month tool reads it.

**Architecture:** The split layout is anchored by labels, like today. `budget-layout.ts` learns the new block shape and rejects the old one with a pointer to the migration. A new `budget-migration.ts` splits into two parts. A pure planner turns one tab's FORMULA and UNFORMATTED grids into a single Sheets `batchUpdate`: unmerge, `cutPaste` of the rate row, value writes and number formats. A thin op around it reads, refuses, writes once and reads back. Tests prove the planner by replaying its requests on the old-shape fixture and comparing the result with the new-shape fixture.

**Tech Stack:** TypeScript on Cloudflare Workers, Google Sheets REST API v4 (`SheetsClient`), vitest via `bun run test`, `bun run type-check`.

**Spec:** `docs/superpowers/specs/2026-10-20-per-currency-budget-blocks-design.md` (read it first; this plan argues from it).

## Global Constraints

- Labels are exact strings:
  - budget list rows: `<類別>美金預算` and `<類別>新臺幣預算`;
  - block rows: `美金` and `新臺幣`;
  - block header row: `編列預算` / `總和` / `剩餘`;
  - summary rows: `本月美金超支`, `本月新臺幣超支`, `本月美金超支（加上回補）`, `本月新臺幣超支（加上回補）` (full-width parentheses).
- Every row and column is located by label, never by a fixed number. The only fixed addresses are those the spec pins (rows 5–22 / 23 come from the list's own position and size).
- Formulas are verbatim from the spec's tables. The block formula for 中餐 is the pattern for every block, shifted to that block's columns.
- One `batchUpdate` per migrated tab. Every read happens before it, and a refusal writes nothing.
- The `finance-ops` ⇄ `budget-ops` ⇄ `budget-layout` import cycle (and the new `budget-migration`) passes only function declarations. Nothing reads an imported binding at module load.
- Commits end with the two trailer lines from the session's attribution reminder. No model identifiers go in commits, code or docs.
- Done means `bun run type-check` and `bun run test` both pass.

## Review Focus

1. **The live sheet differs from the fixture.** 11 月's `E4` is a hand-set `=0`, and `set_income` may have filled income rows 30–31. The plan must write nothing to rows 3–4 (columns A–F) or to the income rows. *Test: Task 2.*
2. **Entries and E3 still say `$C$15` after the move.** Only `cutPaste` fixes them, so it must come before every write that names `$C$23`, and the plan must not rewrite any block entry row (row ≥ 7). *Test: Task 2.*
3. **Tools used between deploy and migration.** add_expense, delete_expense and month_summary on an old-shape tab must fail with a message that names `migrate_budget_split`, not misread the sheet. *Test: Task 1.*
4. **A tab is migrated twice.** The second run must refuse and write nothing. *Test: Task 3.*
5. **A summary label row is missing.** month_summary on a budget month without, say, the 加上回補 rows returns `null` for those fields instead of throwing. *Test: Task 1.*

---

### Task 1: Read the split layout everywhere

Teach the block finder the new shape. Rebuild the template fixture in the new shape and keep the old one for later tasks. Move month_summary to the per-currency shape. Repoint every budget test at rate row 23.

**Files:**
- Modify: `src/conventions.ts` (new label constants next to `OVERSPEND_NET_LABEL`)
- Modify: `src/budget-layout.ts` (`BudgetBlock`, `findBudgetBlocks`, new `scanBudgetBlockHeaders`)
- Modify: `src/budget-ops.ts` (`BudgetMonthSummary`, `budgetMonthSummary`)
- Modify: `src/finance-ops.ts` (`NON_INCOME_LABELS` gains the two 加上回補 labels)
- Modify: `test/budget-fixtures.ts`
- Modify: `test/budget-layout.test.ts`
- Modify: `test/budget-ops.test.ts`

**Interfaces:**
- Produces, in `src/conventions.ts`:
  - `BUDGET_USD_LINE_SUFFIX = "美金預算"`
  - `BUDGET_NTD_LINE_SUFFIX = "新臺幣預算"`
  - `BLOCK_USD_ROW_LABEL = "美金"`
  - `BLOCK_NTD_ROW_LABEL = "新臺幣"`
  - `BLOCK_REMAINING_LABEL = "剩餘"`
  - `USD_OVERSPEND_NET_LABEL = "本月美金超支（加上回補）"`
  - `NTD_OVERSPEND_NET_LABEL = "本月新臺幣超支（加上回補）"`
  - `MIGRATE_BUDGET_SPLIT_TOOL = "migrate_budget_split"`
  - Keep `OVERSPEND_LABEL` / `OVERSPEND_NET_LABEL`; the migration finds the old rows by them.
- Produces, in `src/budget-layout.ts`:
  - `interface BudgetBlockHeader { category: string; title: string; startCol: number; titleRow: number; headerRow: number }`
  - `scanBudgetBlockHeaders(values: unknown[][], tab: string): BudgetBlockHeader[]` finds header + title + category in column order. Today's torn-block, missing-title and duplicate-category errors move here.
  - `interface BudgetBlock { category: string; title: string; startCol: number; usdRow: number; ntdRow: number; headerRow: number }`. Columns: 編列預算 at `startCol+1`, 總和 at `+2`, 剩餘 at `+3`.
  - `findBudgetBlocks(values, tab): BudgetBlock[]`. Between `titleRow` and `headerRow` it finds `美金` and `新臺幣` in `startCol`. If a block instead has `編列預算` in `startCol` (the old shape), it throws `` `${tab} still has the old single-currency budget blocks — run ${MIGRATE_BUDGET_SPLIT_TOOL} on it first.` ``. Any other missing row throws as today.
  - `firstEmptyEntryRow`, `blockEntries`, `resolveBudgetBlock` and `findRateRow` keep their signatures.
- Produces, in `src/budget-ops.ts`:
  - `BudgetMonthSummary.budgets`: `Array<{ category: string; 美金: Money; 新臺幣: Money }>`, where `type Money = { 編列預算: number | null; 總和: number | null; 剩餘: number | null }`.
  - Adds `本月美金超支（加上回補）` and `本月新臺幣超支（加上回補）`.
  - Drops `本月超支` and `"本月超支（加上回補）"`.
- Produces, in `test/budget-fixtures.ts`:
  - `legacyBudgetGrid()`: today's `budgetGrid()` body, renamed unchanged.
  - `budgetGrid()`: the split template (rows below).
  - `BLOCK_START` and `oldMonthGrid()` unchanged.

New `budgetGrid()` content (FORMULA render, 1-indexed rows; anything not listed matches today's fixture):

- **Row 3:** E is `=D3*$C$23`. Everything else as today.
- **Rows 5–22:** categories in this order: 生活用品, 吃喝, 購物, 訂閱, 交通, 娛樂, 學貸, 其他, 中餐. Each category's 美金 row comes first, then its 新臺幣 row.
  - 美金 row r: `["", "<cat>美金預算", cat, usd, "=D<r>*$C$23", "USD"]`
  - 新臺幣 row: `["", "<cat>新臺幣預算", cat, "", ntd, "TWD"]`
  - USD amounts: 0, 0, 0, 71.37, 0, 0, `"=281.43 + 148.5"`, 15, 0
  - NTD amounts: 31261, 0, 0, 10700, 1000, 0, 0, 0, 3900
- **Row 23:** `["", "本月匯率", 32.4607, "預算總額", "=SUM(E5:E22)"]`. Row 15 no longer holds the rate.
- **Rows 32–37 and 40, column D:** exactly the spec's summary table, with labels in B: 本月美金收支狀況, 本月新臺幣收支狀況, 本月美金超支, 本月新臺幣超支, 本月美金超支（加上回補）, 本月新臺幣超支（加上回補）, 總支出.
- **Each block at start column c:**
  - row 3: `["", "編列預算", "總和", "剩餘"]` at c…c+3;
  - row 4: `["美金", SUMIF(…"<cat>美金預算",$D$5:$D$22), SUMIF(<cur>7:<cur>,"USD",<amt>7:<amt>), ROUND(<I>4-<J>4,2)]`;
  - row 5: the 新臺幣 equivalents (`$E$5:$E$22`, `"<>USD"`, `=<I>5-<J>5`). The budget label uses the list category (中餐 for the 午餐支出 block).
- **Entries:** 訂閱's Claude entry is `"=200*$C$23"`. Everything else in the entries and in 乾坤大挪移 is unchanged.

- [ ] **Step 1: Write the fixtures.** Rename the current builder to `legacyBudgetGrid()` and write the new `budgetGrid()` as above. Replace the `chr`/`L` helpers with `colLetter` imported from `../src/finance-ops` if that reads cleaner.

- [ ] **Step 2: Write the failing layout tests** in `test/budget-layout.test.ts`. Update the tests that move:
  - `findBudgetBlocks(budgetGrid(), "11 月")[4]` equals `{ category: "訂閱", title: "訂閱支出", startCol: 27, usdRow: 4, ntdRow: 5, headerRow: 6 }`.
  - `findRateRow(budgetGrid(), "11 月")` is `23`.
  - The torn-block test now blanks the `美金` label (`g[3]![27] = ""`) and expects `/AB6.*美金|美金.*AB6/`.
  - New test `"findBudgetBlocks names the migration on an old-shape tab"`: `expect(() => findBudgetBlocks(legacyBudgetGrid(), "11 月")).toThrow(/old single-currency.*migrate_budget_split/)`.
  - Keep the rest (aliases, firstEmptyEntryRow, blockEntries, transfer section, income window 28–31) against the new fixture. They should pass unchanged.

- [ ] **Step 3: Write the failing ops tests** in `test/budget-ops.test.ts`:
  - The USD-paid-with-TWD add_expense test expects `"=99.99*$C$23"`.
  - The start_month tests expect the rate write at `write(22, 2, rateFormula(…))` instead of `write(14, …)`.
  - Rewrite the month_summary test against the new fixture:
    - set 訂閱's row 4 to 71.37 / 71.37 / 0 and row 5 to 10700 / 6508 / 4192 (I/J/K are columns 28/29/30);
    - set D34…D37 to −99.99, −25034.21, −99.99, −16942.21;
    - expect `s.budgets[4]` to equal `{ category: "訂閱", 美金: { 編列預算: 71.37, 總和: 71.37, 剩餘: 0 }, 新臺幣: { 編列預算: 10700, 總和: 6508, 剩餘: 4192 } }`;
    - expect the four 超支 fields;
    - expect `s` not to have the key `本月超支`.
  - New test `"month_summary returns null for summary rows the tab doesn't have"`: delete row 36 and 37 of the grid (`g[35] = []; g[36] = []`), then expect both 加上回補 fields to be `null`.
  - New test `"add_expense, delete_expense and month_summary on an old-shape tab point at the migration"`: for each of the three ops on `legacyBudgetGrid()`, expect `/migrate_budget_split/` and expect `batchUpdate` not to have been called.
  - New test in the set_income block: `it.each(["本月美金超支（加上回補）", "本月新臺幣超支（加上回補）"])` is refused with `/layout label/`.

- [ ] **Step 4: Run the tests and confirm they fail.**
  Run: `bun run test`
  Expected: the tests above FAIL (wrong block shape, rate row 15, summary keys). No TypeScript import errors.

- [ ] **Step 5: Implement.** Add the constants, `scanBudgetBlockHeaders`, the new `findBudgetBlocks` and the new summary shape. Add the two labels to `NON_INCOME_LABELS`. `budgetMonthSummary` reads each block's money from `(usdRow|ntdRow, startCol+1…+3)` and the four 超支 fields by label (`byLabel`). Nothing else in budget-ops changes: add_expense, delete_expense, the 幣別 dropdown copy and start_month already key on `headerRow`, `startCol` and labels.

- [ ] **Step 6: Run the tests and type-check.**
  Run: `bun run test && bun run type-check`
  Expected: all PASS.

- [ ] **Step 7: Commit.** `git add src/conventions.ts src/budget-layout.ts src/budget-ops.ts src/finance-ops.ts test/` with the message `Budget months: read per-currency budget blocks`.

---

### Task 2: Plan one tab's migration (pure)

**Files:**
- Create: `src/budget-migration.ts`
- Create: `test/sheet-sim.ts` (test-only request replayer)
- Create: `test/budget-migration.test.ts`

**Interfaces:**
- Consumes: `scanBudgetBlockHeaders`, `findRateRow`, `findBudgetTransferSection`, `isBudgetMonth` (budget-layout); `cellData`, `colLetter`, `findRowByValue`, `findRowByLabels` (finance-ops); the Task 1 constants plus `OVERSPEND_LABEL`, `OVERSPEND_NET_LABEL`, `NTD_OVERSPEND_LABEL`, `USD_OVERSPEND_LABEL`, `MONTH_USD_NET_LABELS`, `MONTH_NTD_NET_LABELS`, `TOTAL_SPENDING_LABEL` and `RATE_LABEL`.
- Produces, in `src/budget-migration.ts`:
  - `USD_DISPLAY_PATTERN = '"$"#,##0.00'` and `NTD_DISPLAY_PATTERN = '"NTD "#,##0'` (numberFormat `type: "CURRENCY"`).
  - `interface BudgetSplitPlan { requests: object[]; rateRow: number; categories: string[] }`.
  - `planBudgetSplit(formulas: unknown[][], tab: string, sheetId: number): BudgetSplitPlan`. It works from the FORMULA render alone and throws on every refusal below.
- Produces, in `test/sheet-sim.ts`:
  - `applyRequests(grid: unknown[][], requests: object[]): unknown[][]` returns a copy with:
    - `updateCells` applied (`formulaValue`/`numberValue`/`stringValue` set; `{}` clears);
    - `cutPaste` moving the source cells to the destination, clearing the source and replacing `$C$<srcRow>` with `$C$<dstRow>` in every formula on the grid;
    - `unmergeCells` and `repeatCell` ignored.
  - `normalize(grid)` maps `""`, `null` and `undefined` to `undefined` and trims trailing empties, for deep-equal comparisons.

**The planner's algorithm** (what the signature doesn't determine):
1. Refuse unless `isBudgetMonth(formulas)`.
2. Classify blocks with `scanBudgetBlockHeaders`.
   - A block is old-shape when `編列預算` is in `startCol` between its title and header.
   - If any block already has `美金` / `新臺幣` rows, refuse with "already uses per-currency budgets".
   - Each old block's rows `titleRow+1 … headerRow-1` (columns `startCol…startCol+3`) may be non-empty only at:
     - `(budget label row, startCol)`, `(label row, startCol+2)`;
     - `(value row, startCol)`, `(value row, startCol+2)`;
     - `(總和 row, startCol+1)`, `(總和 row, startCol+2)`.
   - Anything else refuses, naming the cell.
3. Find the old budget list. Its lines are the rows between the 上月新臺幣透支 row and the 本月匯率 row whose B ends with `預算`. Each line is `{ row, category: C, currency: F }`.
   - Categories keep their first-appearance order.
   - A category with two lines in one currency refuses.
   - The set of list categories must equal the set of block categories (after `BUDGET_CATEGORY_ALIASES`), or the planner refuses.
4. Set `listStart` to the first line row and `rateRow = listStart + 2 × categories`. Refuse if:
   - `rateRow ≤ old rate row`; or
   - any B–F cell in `old rate row + 1 … rateRow` is non-empty.
5. Amounts:
   - USD amount: the D cell of the category's USD line, as written in `formulas`, or `0`.
   - NTD amount: the E cell of its TWD line, as written, or `0`.
   - If that E formula contains `$C$<old rate row>` (a conversion), carry `0` when the line's D is blank, and refuse when D is filled.
6. Old summary rows, found by label in column B:
   - USD line, NTD line, `USD_OVERSPEND_LABEL`, `NTD_OVERSPEND_LABEL`, `OVERSPEND_LABEL`, `OVERSPEND_NET_LABEL`, `TOTAL_SPENDING_LABEL`. Refuse if one is missing.
   - The income window `a…b` comes from the USD line's `=SUMIF(C<a>:C<b>,` prefix, raw.
   - The fee cell is `colLetter(transfer.dateCol + 5) + transfer.totalRow`.
7. Requests, in this order:
   1. `unmergeCells` over rows `titleRow+1 … headerRow-1` × `firstBlock.startCol … lastBlock.startCol+4`.
   2. `cutPaste` of B–E on the old rate row to `{ rowIndex: rateRow-1, columnIndex: 1 }`, with `pasteType: "PASTE_NORMAL"`.
   3. `updateCells` writes:
      - the list rows (B–F);
      - `E<rateRow> = =SUM(E<listStart>:E<rateRow-1>)`;
      - every block's three rows (the label row's first cell cleared with `cellData(null)`);
      - the seven summary cells. The two old 本月超支 rows get the 加上回補 labels in B (美金 on `OVERSPEND_LABEL`'s row, 新臺幣 on `OVERSPEND_NET_LABEL`'s row).
   4. `repeatCell` number formats:
      - USD: list D, every block's 美金 row I–K, the USD line, 本月美金超支, 本月美金超支（加上回補）;
      - NTD: list E, every block's 新臺幣 row I–K, the NTD line, 本月新臺幣超支, 本月新臺幣超支（加上回補）, 總支出.

- [ ] **Step 1: Write the sim and the failing tests** in `test/budget-migration.test.ts`, with `legacyBudgetGrid()` as `formulas`. Tests:
  - `"replaying the plan on the old template yields the split template"`: `normalize(applyRequests(legacyBudgetGrid(), plan.requests))` deep-equals `normalize(budgetGrid())`.
  - `"the rate row moves before anything names it"`: the index of the `cutPaste` request is less than the index of the first request whose JSON contains `$C$23`. `plan.rateRow` is `23`.
  - `"never writes rows 3–4 of the left side, income rows, or block entries"`: no `updateCells` start has `rowIndex` 2 or 3 with `columnIndex` < 6, none falls in rows 27–30 (0-indexed, the income rows), and none has `rowIndex ≥ 6` with `columnIndex ≥ 7`.
  - `"formats USD and NTD cells"`: the requests contain a `repeatCell` for 訂閱's I4:K4 (`startRowIndex 3, endRowIndex 4, startColumnIndex 28, endColumnIndex 31`) with `USD_DISPLAY_PATTERN`, and one for D40 with `NTD_DISPLAY_PATTERN`.
  - Refusals, each with `expect(() => planBudgetSplit(…)).toThrow(/…/)`:
    - an already-split tab (`budgetGrid()`): `/already uses per-currency/`;
    - an old-layout month (`oldMonthGrid()`): `/not a budget month/`;
    - a second USD line for 訂閱 (an extra line at row 15, with the rate moved to row 16 in the copy): `/訂閱.*two USD/`;
    - 吃喝's TWD line with `D6 = 5`: `/吃喝.*converts/`;
    - something in `K3` of the 中餐 block: `/K3/`;
    - text in `B20`: `/B20/`.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `bun run test test/budget-migration.test.ts`
  Expected: FAIL (`planBudgetSplit` is not exported).

- [ ] **Step 3: Implement `planBudgetSplit`** per the algorithm above, in `src/budget-migration.ts`.

- [ ] **Step 4: Run the tests and type-check.**
  Run: `bun run test && bun run type-check`
  Expected: all PASS.

- [ ] **Step 5: Commit.** `git add src/budget-migration.ts test/sheet-sim.ts test/budget-migration.test.ts` with the message `Plan the per-currency budget migration for one tab`.

---

### Task 3: Run the migration — op and MCP tool

**Files:**
- Modify: `src/budget-migration.ts` (the op)
- Modify: `src/tools.ts` (register `migrate_budget_split`)
- Test: `test/budget-migration.test.ts`

**Interfaces:**
- Consumes: `planBudgetSplit`; `SheetsClient.readRange`, `getSheetId` and `batchUpdate`; `quoteTab` and `assertNotTruncated` (finance-ops); `BUDGET_GRID_READ` (budget-layout).
- Produces:
  - `migrateBudgetSplit(client: SheetsClient, tab: string): Promise<{ tab: string; rateRow: number; categories: string[]; before: Report; after: Report }>`
  - `type Report = { 本月匯率: number | null; 本月美金收支狀況: number | null; 本月新臺幣收支狀況: number | null; 本月美金超支: number | null; 本月新臺幣超支: number | null; 總支出: number | null }`.
  - The op reads FORMULA and UNFORMATTED (`BUDGET_GRID_READ`), plans from FORMULA, sends one `batchUpdate`, then re-reads UNFORMATTED.
  - It fills `before` and `after` by label from the two UNFORMATTED grids. The 收支狀況, 本月美金超支, 本月新臺幣超支 and 總支出 labels exist on both sides, and 本月匯率 comes from `findRateRow`.
  - It wraps a `batchUpdate` failure as `` `Migrating ${tab} failed and nothing was written: ${message}` `` (Sheets rejects the whole batch, for example when a merge reaches outside rows 3–5).
- Tool `migrate_budget_split`, params `{ tab: z.string().min(1) }`. Description: "One-off: move a budget-month tab (the 'Budget Based' template, 11 月, 12 月) to per-currency budgets — 18 budget rows, a 美金 and a 新臺幣 row per block, split 超支 rows. One atomic write; refuses a tab already migrated or anything it doesn't recognise. Reports the 收支狀況 / 超支 / 總支出 figures before and after, which should match."

- [ ] **Step 1: Write the failing tests**:
  - `"migrates in one batch after reading, and reports before and after"`: use a fake client whose reads return:
    - `legacyBudgetGrid()` with `D34 = -99.99` for both pre-write reads;
    - `budgetGrid()` with `D34 = -99.99` and `C23 = 32.54` for the read after.

    Expect `batchUpdate` to be called once, both pre-write reads to happen before it (`mock.invocationCallOrder`), `r.before.本月美金超支` and `r.after.本月美金超支` to be `-99.99`, and `r.after.本月匯率` to be `32.54`.
  - `"a second run refuses and writes nothing"`: reads return `budgetGrid()`. Expect `/already uses per-currency/` and no `batchUpdate`.
  - `"a rejected batch reports that nothing was written"`: `batchUpdate` rejects with `Error("Sheets API error (400): You must select all cells in a merged range")`. Expect `/Migrating 11 月 failed and nothing was written: .*merged range/`.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `bun run test test/budget-migration.test.ts`
  Expected: the three new tests FAIL.

- [ ] **Step 3: Implement `migrateBudgetSplit`** and register the tool in `src/tools.ts`, next to `start_month`, using the same `ok` / `toError` pattern.

- [ ] **Step 4: Run the tests and type-check.**
  Run: `bun run test && bun run type-check`
  Expected: all PASS.

- [ ] **Step 5: Commit.** `git add src/budget-migration.ts src/tools.ts test/budget-migration.test.ts` with the message `Add the migrate_budget_split tool`.

---

### Task 4: Guide text, tool descriptions and docs

**Files:**
- Modify: `src/conventions.ts` (`CONVENTIONS_TEXT`, BUDGET MONTHS section)
- Modify: `src/tools.ts` (`month_summary` description)
- Modify: `test/conventions.test.ts`
- Modify: `README.md` (budget-month paragraph)
- Modify: `docs/superpowers/specs/2026-10-19-budget-month-layout-design.md` (one line at the top pointing to the 2026-10-20 design)

- [ ] **Step 1: Write the failing test.** Replace the PR #43 needles about the old lines with one test, `"describes per-currency budget months"`. Each of these must appear in `CONVENTIONS_TEXT`:
  - `"<類別>美金預算"`
  - `"<類別>新臺幣預算"`
  - `"a 美金 row and a 新臺幣 row"`
  - `"本月美金超支（加上回補）"`
  - `"本月新臺幣超支（加上回補）"`
  - `"migrate_budget_split"`
  - `"本月美金收支狀況 (USD income − 上月美金透支 − the USD budget lines + 本月美金超支)"`

- [ ] **Step 2: Run the test and confirm it fails.**
  Run: `bun run test test/conventions.test.ts`
  Expected: FAIL on the new needles.

- [ ] **Step 3: Rewrite the BUDGET MONTHS bullets** to describe the spec's layout:
  - the 18-row list and the rate at row 23 below it;
  - each block's 3-row 美金 / 新臺幣 table and what each cell holds;
  - the summary rows, and that each 超支 row is the sum of the negative 剩餘 in its currency;
  - `migrate_budget_split` for tabs still in the old shape.

  Keep the existing 幣別 dropdown sentence. Update the month_summary tool description to the new per-currency fields. Update the README paragraph and add the pointer line to the old spec.

- [ ] **Step 4: Run the tests and type-check.**
  Run: `bun run test && bun run type-check`
  Expected: all PASS.

- [ ] **Step 5: Commit.** `git add src/conventions.ts src/tools.ts test/conventions.test.ts README.md docs/` with the message `Describe per-currency budget months in the guide and docs`.

---

### Task 5: Ship and migrate the live sheet

This task runs after the code is reviewed, pushed and merged to main. Workers Builds deploys main automatically.

- [ ] **Step 1: Push** to `claude/relaxed-sagan-etg02z` and update PR #43's description. If #43 has been merged, restart the branch from `origin/main` (keeping these commits) and open a new PR. Ask the user to merge.
- [ ] **Step 2: Confirm the tool is visible.** After the deploy, check that `migrate_budget_split` is in this session's tool list. If the list is stale, ask the user to reconnect the Personal Finance Sheet connector, or start a new session.
- [ ] **Step 3: Record the pre-migration figures.** Read the D32–D40 values of 11 月 and 12 月 so they can be compared.
- [ ] **Step 4: Migrate the template first and check the move.** Run `migrate_budget_split` on `Budget Based`. Read its E3 and its 訂閱 Claude entry (`AD12`) in `formulas` mode. Both must now say `$C$23`. If either still says `$C$15`, stop and tell the user: `cutPaste` did not carry the references, and 11 月 / 12 月 must not be migrated.
- [ ] **Step 4b: Migrate the live months.** Run it on `11 月`, then `12 月`. After each, check that `before` and `after` match. The 本月匯率 may tick between the two reads; compare at the reported rate.
- [ ] **Step 5: Verify.**
  - 12 月's 上月…透支 carries still read 11 月's D32 / D33.
  - month_summary works on both months.
  - An add_expense followed by delete_expense of a throwaway TWD entry in 12 月 works.
- [ ] **Step 6: Report.** Tell the user the before and after figures, and offer a follow-up that removes the migration tool.
