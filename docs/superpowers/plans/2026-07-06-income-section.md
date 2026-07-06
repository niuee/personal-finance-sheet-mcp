# Income Section (`set_income`, 幣別/支付幣別, 月剩餘) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `set_income` MCP tool that upserts income rows (with a 幣別 column) into monthly tabs, plus the 支付幣別 expense column, the 月剩餘/月美金餘額/月新臺幣餘額 rows, and auto-migration of old-layout tabs — per `docs/2026-07-06-income-section-design.md`.

**Architecture:** All sheet geometry lives in `src/conventions.ts`; all client-calling ops in `src/finance-ops.ts`; tool registration in `src/tools.ts`. Rows are located by label anchors (never fixed positions). New helpers `findExpenseWindow`/`findIncomeWindow` centralize window discovery; `migrateIncomeLayout` upgrades an old-layout tab in one batchUpdate; `setIncome` upserts and triggers migration.

**Tech Stack:** TypeScript on Cloudflare Workers, Google Sheets API via the existing `SheetsClient`, vitest with mocked clients, zod for tool schemas.

## Global Constraints

- Use **bun**: `bun run test`, `bun run type-check`, `bunx vitest run …`. Never npm.
- Match existing style: **tab indentation**, double quotes, JSDoc one-liners on exports.
- Currency literals written into cells are exactly `"USD"` and `"TWD"`.
- Sheet rows are 1-indexed in variables; Sheets API `rowIndex`/`startIndex` are 0-indexed.
- Work on branch `feat/set-income` (already created).
- Design/spec: `docs/2026-07-06-income-section-design.md` — the layout diagram there is authoritative.

**Fixture row map used throughout tests** (1-indexed sheet rows; `g[i]` is row `i+1`):

- `monthGrid()` (existing, old layout, NO 總預算): 花費總額 row 11 (`=SUM(E3:E10)`), 沛還 13, 薪水 14, 剩餘 15, 美金支付 16, 美金收入 19, 美金支出 20, 上月美金餘額 21, 美金餘額 22, 新臺幣收入 23, 新臺幣支出 24, 上月新臺幣餘額 25, 新臺幣餘額 26.
- `oldLayoutGrid()` (new fixture, Task 2 — real 7 月 2026 shape): expense rows 3-5, window `=SUM(E3:E10)`, 花費總額 11, 總預算 13, 沛還 14, 薪水 15, 剩餘 16, 美金支付 18, 新臺幣支付 19, 銀行餘額 21, 美金收入 22, 美金支出 23, 上月美金餘額 24, 美金餘額 25, 新臺幣收入 26, 新臺幣支出 27, 上月新臺幣餘額 28, 新臺幣餘額 29.
- `migratedMonthGrid()` (new fixture, Task 2 — post-migration): header row 2 incl. F=支付幣別, expense rows 3-5 tagged in F, window `=SUM(E3:E10)`, 花費總額 11, 總預算 13, income rows 14-16 (沛還/薪水/多一個月薪水, C=TWD), 月美金餘額 17, 月新臺幣餘額 18, 月剩餘 19, 銀行餘額 21, 美金收入 22, 美金支出 23, 上月美金餘額 24, 總美金餘額 25, 新臺幣收入 26, 新臺幣支出 27, 上月新臺幣餘額 28, 總新臺幣餘額 29.

---

### Task 1: Conventions — new labels, `paidWith` column, `RECURRING_INCOME`

**Files:**
- Modify: `src/conventions.ts`
- Test: `test/conventions.test.ts`

**Interfaces:**
- Consumes: existing label constants in `src/conventions.ts`.
- Produces (all exported from `src/conventions.ts`, used by every later task):
  - `BUDGET_HEADER_LABEL = "總預算"`, `NTD_PAYMENT_LABEL = "新臺幣支付"`
  - `MONTH_USD_NET_LABEL = "月美金餘額"`, `MONTH_NTD_NET_LABEL = "月新臺幣餘額"`, `MONTH_REMAINDER_LABEL = "月剩餘"`
  - `TOTAL_USD_BALANCE_LABEL = "總美金餘額"`, `TOTAL_NTD_BALANCE_LABEL = "總新臺幣餘額"`
  - `RECURRING_INCOME: Set<string>` containing 沛還 and 薪水
  - `MONTH_COLS.paidWith === 5`

- [ ] **Step 1: Write the failing tests**

In `test/conventions.test.ts`, extend the import from `../src/conventions` with `BUDGET_HEADER_LABEL, MONTH_NTD_NET_LABEL, MONTH_REMAINDER_LABEL, MONTH_USD_NET_LABEL, NTD_PAYMENT_LABEL, RECURRING_INCOME, TOTAL_NTD_BALANCE_LABEL, TOTAL_USD_BALANCE_LABEL`, then update/add:

Replace the body of the `"maps the monthly-tab columns (類別-column layout)"` test's expectation with:

```ts
		expect(MONTH_COLS).toEqual({
			date: 0,
			item: 1,
			tag: 2,
			usd: 3,
			twd: 4,
			paidWith: 5,
			totalLabel: 3,
			totalValue: 4,
			budgetLabel: 1,
			budgetValue: 3,
		});
```

Add after the `"exports the summary row labels"` test:

```ts
	it("exports the income-section labels", () => {
		expect(BUDGET_HEADER_LABEL).toBe("總預算");
		expect(NTD_PAYMENT_LABEL).toBe("新臺幣支付");
		expect(MONTH_USD_NET_LABEL).toBe("月美金餘額");
		expect(MONTH_NTD_NET_LABEL).toBe("月新臺幣餘額");
		expect(MONTH_REMAINDER_LABEL).toBe("月剩餘");
		expect(TOTAL_USD_BALANCE_LABEL).toBe("總美金餘額");
		expect(TOTAL_NTD_BALANCE_LABEL).toBe("總新臺幣餘額");
	});

	it("keeps 沛還 and 薪水 as recurring income, ad-hoc rows are not", () => {
		expect(RECURRING_INCOME.has("沛還")).toBe(true);
		expect(RECURRING_INCOME.has("薪水")).toBe(true);
		expect(RECURRING_INCOME.has("多一個月薪水")).toBe(false);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/conventions.test.ts`
Expected: FAIL — missing exports / `MONTH_COLS` mismatch.

- [ ] **Step 3: Implement in `src/conventions.ts`**

After the `USD_PAYMENT_LABEL` line (line 18), add:

```ts
export const NTD_PAYMENT_LABEL = "新臺幣支付";
export const BUDGET_HEADER_LABEL = "總預算";

/**
 * Post-migration budget-block rows (labels in column B, values in column D).
 * 月美金餘額/月新臺幣餘額 are THIS month's 收入−支出 per currency (no
 * carry-over); 月剩餘 converts the USD net at GOOGLEFINANCE USDTWD and adds
 * the NTD net. They replace the old 剩餘 / 美金支付 / 新臺幣支付 rows.
 */
export const MONTH_USD_NET_LABEL = "月美金餘額";
export const MONTH_NTD_NET_LABEL = "月新臺幣餘額";
export const MONTH_REMAINDER_LABEL = "月剩餘";
```

After the `NTD_BALANCE_LABEL` line, add:

```ts
/** Post-migration names of the running bank balances (old tabs keep 美金餘額/新臺幣餘額 — look up with fallback). */
export const TOTAL_USD_BALANCE_LABEL = "總美金餘額";
export const TOTAL_NTD_BALANCE_LABEL = "總新臺幣餘額";
```

After the `RECURRING_ITEMS` set, add:

```ts
/** Income rows start_month keeps; every other income row is ad-hoc and cleared. */
export const RECURRING_INCOME = new Set<string>([REPAYMENT_LABEL, SALARY_LABEL]);
```

In `MONTH_COLS`, after the `twd: 4,` entry add:

```ts
	/** F — 支付幣別, which real account paid the row (USD/TWD). */
	paidWith: 5,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/conventions.test.ts`
Expected: PASS (the CONVENTIONS_TEXT needle test still passes — text unchanged so far).

- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts test/conventions.test.ts
git commit -m "feat: income-section labels, paidWith column, RECURRING_INCOME"
```

---

### Task 2: Window helpers — `findRowByLabels`, `findExpenseWindow`, `findIncomeWindow` (+ fixtures)

**Files:**
- Modify: `src/finance-ops.ts`
- Test: `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: Task 1 constants; existing `findRowByValue`, `MONTH_COLS`, `GRID_READ`, `EXPENSE_WINDOW_RE`, `colLetter`.
- Produces (exported from `src/finance-ops.ts`):
  - `findRowByLabels(values: unknown[][], colIndex: number, labels: readonly string[]): number | null`
  - `interface ExpenseWindow { totalRow: number; start: number; end: number }` and `findExpenseWindow(values: unknown[][], tab: string): ExpenseWindow` (throws on missing/odd 花費總額)
  - `interface IncomeWindow { start: number; end: number; migrated: boolean }` and `findIncomeWindow(values: unknown[][]): IncomeWindow | null`
  - Test fixtures `oldLayoutGrid()` and `migratedMonthGrid()` in `test/finance-ops.test.ts` (see Global Constraints row map).

- [ ] **Step 1: Add the two fixtures to `test/finance-ops.test.ts`**

Directly below the existing `monthGrid()` function, add:

```ts
/** Old-layout grid mirroring real 7 月 2026 before migration: 總預算 header, plain 收入 cells, 剩餘 + 美金支付/新臺幣支付. Row = index+1. */
function oldLayoutGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["9 月花費"];
	g[1] = ["日期", "項目", "類別", "美金", "新臺幣"];
	g[2] = [46266, "上月透支", "透支", "", "=IF(-'8 月'!D32 > 0, -'8 月'!D32, 0)"];
	g[3] = ["", "Google Cloud", "訂閱", 11.53, '=D4*GOOGLEFINANCE("CURRENCY:USDTWD")'];
	g[4] = ["", "電話費", "生活用品", "", 1261];
	// rows 6-10 empty inside the window
	g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)"];
	g[12] = ["", "總預算"];
	g[13] = ["", "沛還", "", 20500];
	g[14] = ["", "薪水", "", 63913];
	g[15] = ["", "剩餘", "", "=sum(D14:D15)-E11"];
	g[17] = ["", "美金支付", "", "=SUM(D4:D6)"];
	g[18] = ["", "新臺幣支付", "", "=E5"];
	g[20] = ["", "銀行餘額"];
	g[21] = ["", "美金收入", "", 0];
	g[22] = ["", "美金支出", "", "=SUM(D3:D10)"];
	g[23] = ["", "上月美金餘額", "", "='8 月'!D25"];
	g[24] = ["", "美金餘額", "", "=D24+D22-D23"];
	g[25] = ["", "新臺幣收入", "", 0];
	g[26] = ["", "新臺幣支出", "", '=SUMIF(D3:D10,"",E3:E10)'];
	g[27] = ["", "上月新臺幣餘額", "", "='8 月'!D29"];
	g[28] = ["", "新臺幣餘額", "", "=D28+D26-D27"];
	return g;
}

/** Post-migration grid: 支付幣別 in F, income 幣別 in C, 月 rows, SUMIF 收入/支出, 總…餘額 names. Row = index+1. */
function migratedMonthGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["9 月花費"];
	g[1] = ["日期", "項目", "類別", "美金", "新臺幣", "支付幣別"];
	g[2] = [46266, "上月透支", "透支", "", "=IF(-'8 月'!D32 > 0, -'8 月'!D32, 0)", "TWD"];
	g[3] = ["", "Google Cloud", "訂閱", 11.53, '=D4*GOOGLEFINANCE("CURRENCY:USDTWD")', "USD"];
	g[4] = ["", "電話費", "生活用品", "", 1261, "TWD"];
	// rows 6-10 empty inside the window
	g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)"];
	g[12] = ["", "總預算"];
	g[13] = ["", "沛還", "TWD", 20500];
	g[14] = ["", "薪水", "TWD", 63913];
	g[15] = ["", "多一個月薪水", "TWD", 63913];
	g[16] = ["", "月美金餘額", "", "=D22-D23"];
	g[17] = ["", "月新臺幣餘額", "", "=D26-D27"];
	g[18] = ["", "月剩餘", "", '=D17*GOOGLEFINANCE("CURRENCY:USDTWD")+D18'];
	g[20] = ["", "銀行餘額"];
	g[21] = ["", "美金收入", "", '=SUMIF(C14:C16,"USD",D14:D16)'];
	g[22] = ["", "美金支出", "", '=SUMIF(F3:F10,"USD",D3:D10)'];
	g[23] = ["", "上月美金餘額", "", "='8 月'!D25"];
	g[24] = ["", "總美金餘額", "", "=D24+D22-D23"];
	g[25] = ["", "新臺幣收入", "", '=SUMIF(C14:C16,"TWD",D14:D16)'];
	g[26] = ["", "新臺幣支出", "", '=SUMIF(F3:F10,"TWD",E3:E10)'];
	g[27] = ["", "上月新臺幣餘額", "", "='8 月'!D29"];
	g[28] = ["", "總新臺幣餘額", "", "=D28+D26-D27"];
	return g;
}
```

- [ ] **Step 2: Write the failing tests**

Add to `test/finance-ops.test.ts` (extend the import from `../src/finance-ops` with `findExpenseWindow, findIncomeWindow, findRowByLabels`):

```ts
describe("window helpers", () => {
	it("findRowByLabels prefers earlier labels and falls back", () => {
		const values = [["", "新臺幣餘額"], ["", "總美金餘額"]];
		expect(findRowByLabels(values, 1, ["總美金餘額", "美金餘額"])).toBe(2);
		expect(findRowByLabels(values, 1, ["總新臺幣餘額", "新臺幣餘額"])).toBe(1);
		expect(findRowByLabels(values, 1, ["missing", "also missing"])).toBeNull();
	});

	it("findExpenseWindow reads the window from the 花費總額 SUM formula", () => {
		expect(findExpenseWindow(monthGrid(), "9 月")).toEqual({ totalRow: 11, start: 3, end: 10 });
	});

	it("findExpenseWindow fails closed on a missing anchor or a non-SUM total", () => {
		expect(() => findExpenseWindow([["nothing"]], "9 月")).toThrow("花費總額");
		const g = monthGrid();
		g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)+E2"];
		expect(() => findExpenseWindow(g, "9 月")).toThrow("expense window");
	});

	it("findIncomeWindow detects migrated and old layouts, null without anchors", () => {
		expect(findIncomeWindow(migratedMonthGrid())).toEqual({ start: 14, end: 16, migrated: true });
		expect(findIncomeWindow(oldLayoutGrid())).toEqual({ start: 14, end: 15, migrated: false });
		expect(findIncomeWindow(monthGrid())).toBeNull(); // no 總預算 header
		expect(findIncomeWindow([["x"]])).toBeNull();
	});
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts -t "window helpers"`
Expected: FAIL — `findRowByLabels` etc. not exported.

- [ ] **Step 4: Implement in `src/finance-ops.ts`**

Extend the conventions import with `BUDGET_HEADER_LABEL, MONTH_USD_NET_LABEL` (keep alphabetical order). Below `findRowByValue`, add:

```ts
/** findRowByValue over several candidate labels, first hit wins — for renamed anchors with legacy fallbacks. */
export function findRowByLabels(values: unknown[][], colIndex: number, labels: readonly string[]): number | null {
	for (const label of labels) {
		const row = findRowByValue(values, colIndex, label);
		if (row !== null) return row;
	}
	return null;
}
```

Below the `EXPENSE_WINDOW_RE` definition, add:

```ts
export interface ExpenseWindow {
	totalRow: number;
	start: number;
	end: number;
}

/** Locate the expense window from the 花費總額 =SUM(Estart:Eend) formula (FORMULA-render grid). Throws when it cannot be trusted. */
export function findExpenseWindow(values: unknown[][], tab: string): ExpenseWindow {
	const totalRow = findRowByValue(values, MONTH_COLS.totalLabel, TOTAL_ROW_LABEL);
	if (totalRow === null) {
		throw new Error(
			`Could not find the "${TOTAL_ROW_LABEL}" row in ${tab} (searched column ${colLetter(MONTH_COLS.totalLabel)} of ${GRID_READ}).`,
		);
	}
	const totalFormula = String(values[totalRow - 1]?.[MONTH_COLS.totalValue] ?? "");
	const m = totalFormula.match(EXPENSE_WINDOW_RE);
	if (!m) {
		throw new Error(
			`The "${TOTAL_ROW_LABEL}" cell ${TWD_COL}${totalRow} in ${tab} is not a plain =SUM(${TWD_COL}start:${TWD_COL}end) formula (got "${totalFormula}") — cannot locate the expense window safely.`,
		);
	}
	return { totalRow, start: Number(m[1]), end: Number(m[2]) };
}

export interface IncomeWindow {
	/** First/last row (1-indexed, inclusive) of the income list. */
	start: number;
	end: number;
	/** True on the 月剩餘 layout; false when the list still ends at the old 剩餘 row. */
	migrated: boolean;
}

/** The income list sits between 總預算 and 月美金餘額 (migrated) or 剩餘 (old layout). Null when the tab has neither boundary. */
export function findIncomeWindow(values: unknown[][]): IncomeWindow | null {
	const budgetRow = findRowByValue(values, MONTH_COLS.budgetLabel, BUDGET_HEADER_LABEL);
	if (budgetRow === null) return null;
	const monthUsdRow = findRowByValue(values, MONTH_COLS.budgetLabel, MONTH_USD_NET_LABEL);
	if (monthUsdRow !== null) return { start: budgetRow + 1, end: monthUsdRow - 1, migrated: true };
	const remainderRow = findRowByValue(values, MONTH_COLS.budgetLabel, REMAINDER_LABEL);
	if (remainderRow !== null) return { start: budgetRow + 1, end: remainderRow - 1, migrated: false };
	return null;
}
```

In `addExpense`, replace the anchor-finding block (the `totalRow` lookup, its error, the `totalFormula`/`windowMatch` lines and their error, and the `windowStart`/`windowEnd` assignments) with:

```ts
	const { totalRow, start: windowStart, end: windowEnd } = findExpenseWindow(values, tab);
```

Also delete the now-unused local error text (`findExpenseWindow` carries it) and the unused `totalFormula` variable — but note the "too small to insert" error below still references `totalFormula`; change that line to:

```ts
			throw new Error(`The expense window =SUM(${TWD_COL}${windowStart}:${TWD_COL}${windowEnd}) in ${tab} is too small to insert into safely.`);
```

- [ ] **Step 5: Run the full finance-ops suite**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: PASS — new helper tests green, all existing `addExpense` tests still green (error messages preserved; the refactored "too small" message still contains "expense window").

- [ ] **Step 6: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: findRowByLabels + expense/income window helpers, layout fixtures"
```

---

### Task 3: `addExpense` — `paidWith` (支付幣別, column F)

**Files:**
- Modify: `src/finance-ops.ts` (addExpense), `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: `MONTH_COLS.paidWith` (Task 1).
- Produces: `AddExpenseParams.paidWith?: "TWD" | "USD"`; addExpense writes the F cell (default = `currency`) and returns `paidWith` in its result. Task 8 wires the `paid_with` tool param to this.

- [ ] **Step 1: Update existing expectations + add new tests**

Every existing `addExpense` test asserts the exact `rows[0].values` array; each gains a 5th cell. Update:

- `"writes a TWD expense into the first empty window row"`: append `{ userEnteredValue: { stringValue: "TWD" } }` to the expected values array; extend the result assertion to `expect(result).toMatchObject({ tab: "9 月", row: 9, inserted: false, tag: null, paidWith: "TWD" });`
- `"writes the 類別 tag into the row when given"`: append `{ userEnteredValue: { stringValue: "TWD" } }`.
- `"writes a USD expense with the GOOGLEFINANCE conversion formula"`: append `{ userEnteredValue: { stringValue: "USD" } }`.
- `"inserts a row inside the SUM window when no empty row exists"`: append `{ userEnteredValue: { stringValue: "TWD" } }`.

Add a new test:

```ts
	it("writes an explicit paid_with that differs from the pricing currency", async () => {
		const client = fakeClient(monthGrid());

		const result = await addExpense(client, { item: "AWS", amount: 20, currency: "USD", month: 9, paidWith: "TWD" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { stringValue: "AWS" } },
			{},
			{ userEnteredValue: { numberValue: 20 } },
			{ userEnteredValue: { formulaValue: '=D9*GOOGLEFINANCE("CURRENCY:USDTWD")' } },
			{ userEnteredValue: { stringValue: "TWD" } },
		]);
		expect(result).toMatchObject({ paidWith: "TWD", currency: "USD" });
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts -t "addExpense"`
Expected: FAIL — expected 5 cells, got 4.

- [ ] **Step 3: Implement**

In `AddExpenseParams`, after `tag?: string;` add:

```ts
	/** Which real account paid the row (支付幣別, column F); defaults to `currency`. */
	paidWith?: "TWD" | "USD";
```

In `addExpense`, replace the `rowCells` assignment with:

```ts
	const paidWith = p.paidWith ?? p.currency;
	const tagCell = cellData(p.tag ?? null);
	const rowCells =
		p.currency === "USD"
			? [cellData(p.item), tagCell, cellData(p.amount), cellData(`=${USD_COL}${targetRow}*GOOGLEFINANCE("CURRENCY:USDTWD")`), cellData(paidWith)]
			: [cellData(p.item), tagCell, cellData(null), cellData(p.amount), cellData(paidWith)];
```

(the `tagCell` line moves into this block; delete the old standalone one). Add `paidWith,` to the returned object (after `currency`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: add_expense writes 支付幣別 (paid_with, column F)"
```

---

### Task 4: `migrateIncomeLayout`

**Files:**
- Modify: `src/finance-ops.ts`, `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: Task 1 labels, Task 2 helpers, existing `cellData`, `colLetter`, `quoteTab`.
- Produces (exported):
  - `interface MigrationChange { cell: string; before: string; after: string }`
  - `interface MigrationResult { changes: MigrationChange[]; deletedRows: Array<{ row: number; item: string; values: unknown[] }> }`
  - `migrateIncomeLayout(client: SheetsClient, tab: string, values: unknown[][], sheetId: number): Promise<MigrationResult>` — `values` must be a FORMULA render of `GRID_READ`; issues ONE `client.batchUpdate`.

- [ ] **Step 1: Write the failing tests**

Add to `test/finance-ops.test.ts` (extend the finance-ops import with `migrateIncomeLayout`):

```ts
describe("migrateIncomeLayout", () => {
	it("migrates an old-layout tab in one batch: structure ops first, then label-anchored writes", async () => {
		const client = fakeClient(oldLayoutGrid());

		const result = await migrateIncomeLayout(client, "9 月", oldLayoutGrid(), 111);

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// 1) insert two rows after 剩餘 (row 16) for the extra 月 rows
		expect(requests[0]).toEqual({
			insertDimension: {
				range: { sheetId: 111, dimension: "ROWS", startIndex: 16, endIndex: 18 },
				inheritFromBefore: true,
			},
		});
		// 2) delete 新臺幣支付 (19→21) then 美金支付 (18→20), bottom-up at post-insert positions
		expect(requests[1]).toEqual({
			deleteDimension: { range: { sheetId: 111, dimension: "ROWS", startIndex: 20, endIndex: 21 } },
		});
		expect(requests[2]).toEqual({
			deleteDimension: { range: { sheetId: 111, dimension: "ROWS", startIndex: 19, endIndex: 20 } },
		});
		// 3) F2 支付幣別 header
		expect(requests[3]).toEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 1, columnIndex: 5 },
				rows: [{ values: [{ userEnteredValue: { stringValue: "支付幣別" } }] }],
				fields: "userEnteredValue",
			},
		});
		// 4) back-tag expense rows 3-10: D non-blank → USD, else TWD; empty rows untouched
		expect(requests[4]).toEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 2, columnIndex: 5 },
				rows: [
					{ values: [{ userEnteredValue: { stringValue: "TWD" } }] },
					{ values: [{ userEnteredValue: { stringValue: "USD" } }] },
					{ values: [{ userEnteredValue: { stringValue: "TWD" } }] },
					{ values: [{}] },
					{ values: [{}] },
					{ values: [{}] },
					{ values: [{}] },
					{ values: [{}] },
				],
				fields: "userEnteredValue",
			},
		});
		// 5) income rows 14-15 tagged TWD in C
		expect(requests[5]).toEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 13, columnIndex: 2 },
				rows: [
					{ values: [{ userEnteredValue: { stringValue: "TWD" } }] },
					{ values: [{ userEnteredValue: { stringValue: "TWD" } }] },
				],
				fields: "userEnteredValue",
			},
		});
		// 6) 剩餘 row becomes 月美金餘額 and the two inserted rows get 月新臺幣餘額 / 月剩餘
		expect(requests[6]).toEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 15, columnIndex: 1 },
				rows: [
					{ values: [{ userEnteredValue: { stringValue: "月美金餘額" } }, {}, { userEnteredValue: { formulaValue: "=D22-D23" } }] },
					{ values: [{ userEnteredValue: { stringValue: "月新臺幣餘額" } }, {}, { userEnteredValue: { formulaValue: "=D26-D27" } }] },
					{ values: [{ userEnteredValue: { stringValue: "月剩餘" } }, {}, { userEnteredValue: { formulaValue: '=D17*GOOGLEFINANCE("CURRENCY:USDTWD")+D18' } }] },
				],
				fields: "userEnteredValue",
			},
		});
		// 7) 收入 cells become income-window SUMIFs; 支出 cells become 支付幣別 SUMIFs
		expect(requests[7].updateCells).toMatchObject({
			start: { sheetId: 111, rowIndex: 21, columnIndex: 3 },
			rows: [{ values: [{ userEnteredValue: { formulaValue: '=SUMIF(C14:C15,"USD",D14:D15)' } }] }],
		});
		expect(requests[8].updateCells).toMatchObject({
			start: { sheetId: 111, rowIndex: 22, columnIndex: 3 },
			rows: [{ values: [{ userEnteredValue: { formulaValue: '=SUMIF(F3:F10,"USD",D3:D10)' } }] }],
		});
		expect(requests[9].updateCells).toMatchObject({
			start: { sheetId: 111, rowIndex: 25, columnIndex: 3 },
			rows: [{ values: [{ userEnteredValue: { formulaValue: '=SUMIF(C14:C15,"TWD",D14:D15)' } }] }],
		});
		expect(requests[10].updateCells).toMatchObject({
			start: { sheetId: 111, rowIndex: 26, columnIndex: 3 },
			rows: [{ values: [{ userEnteredValue: { formulaValue: '=SUMIF(F3:F10,"TWD",E3:E10)' } }] }],
		});
		// 8) running balances renamed
		expect(requests[11].updateCells).toMatchObject({
			start: { sheetId: 111, rowIndex: 24, columnIndex: 1 },
			rows: [{ values: [{ userEnteredValue: { stringValue: "總美金餘額" } }] }],
		});
		expect(requests[12].updateCells).toMatchObject({
			start: { sheetId: 111, rowIndex: 28, columnIndex: 1 },
			rows: [{ values: [{ userEnteredValue: { stringValue: "總新臺幣餘額" } }] }],
		});
		expect(requests).toHaveLength(13);
		expect((client.batchUpdate as any).mock.calls).toHaveLength(1);

		// the report names what changed and what was deleted, with previous contents
		expect(result.deletedRows).toEqual([
			{ row: 19, item: "新臺幣支付", values: ["", "新臺幣支付", "", "=E5"] },
			{ row: 18, item: "美金支付", values: ["", "美金支付", "", "=SUM(D4:D6)"] },
		]);
		expect(result.changes).toContainEqual({ cell: "D22", before: "0", after: '=SUMIF(C14:C15,"USD",D14:D15)' });
		expect(result.changes).toContainEqual({ cell: "B25", before: "美金餘額", after: "總美金餘額" });
		expect(result.changes).toContainEqual({ cell: "D16", before: "=sum(D14:D15)-E11", after: "=D22-D23" });
	});

	it("preserves an existing 支付幣別 cell instead of re-deriving it", async () => {
		const g = oldLayoutGrid();
		g[3] = ["", "Google Cloud", "訂閱", 11.53, '=D4*GOOGLEFINANCE("CURRENCY:USDTWD")', "TWD"];
		const client = fakeClient(g);

		await migrateIncomeLayout(client, "9 月", g, 111);

		const backTag = (client.batchUpdate as any).mock.calls[0][0][4];
		// row 4 already says TWD (explicit paid_with) — left untouched, not overwritten with USD
		expect(backTag.updateCells.rows[1]).toEqual({ values: [{}] });
	});

	it("refuses when the 銀行餘額 block is missing", async () => {
		const g = oldLayoutGrid();
		g.length = 20; // cut the bank block off
		const client = fakeClient(g);

		await expect(migrateIncomeLayout(client, "9 月", g, 111)).rejects.toThrow("銀行餘額");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("handles a tab that has only 美金支付 (no 新臺幣支付 row)", async () => {
		const g = oldLayoutGrid();
		g[18] = undefined as unknown as unknown[]; // drop 新臺幣支付
		const client = fakeClient(g);

		const result = await migrateIncomeLayout(client, "9 月", g, 111);

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// one delete (美金支付 at 18→20); bank rows land one lower than the 2-pay case
		expect(requests[1]).toEqual({
			deleteDimension: { range: { sheetId: 111, dimension: "ROWS", startIndex: 19, endIndex: 20 } },
		});
		// 美金收入 was row 22, final = 22 + 2 - 1 = 23
		expect(result.changes).toContainEqual({ cell: "D23", before: "0", after: '=SUMIF(C14:C15,"USD",D14:D15)' });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts -t "migrateIncomeLayout"`
Expected: FAIL — `migrateIncomeLayout` not exported.

- [ ] **Step 3: Implement in `src/finance-ops.ts`**

Extend the conventions import with `MONTH_NTD_NET_LABEL, MONTH_REMAINDER_LABEL, NTD_PAYMENT_LABEL, TOTAL_NTD_BALANCE_LABEL, TOTAL_USD_BALANCE_LABEL`. Add after `findIncomeWindow`:

```ts
export interface MigrationChange {
	cell: string;
	before: string;
	after: string;
}

export interface MigrationResult {
	changes: MigrationChange[];
	deletedRows: Array<{ row: number; item: string; values: unknown[] }>;
}

/**
 * Upgrade an old-layout monthly tab to the 月剩餘 income layout in one batch:
 * 支付幣別 column F (back-tagged from the USD column), income 幣別 tags,
 * 剩餘 → 月美金餘額/月新臺幣餘額/月剩餘, 美金支付/新臺幣支付 deleted,
 * 收入/支出 rewritten as SUMIFs, running balances renamed 總…餘額.
 * `values` must be a FORMULA render of GRID_READ. Every overwrite/delete is
 * reported with its previous contents so it can be reverted by hand.
 */
export async function migrateIncomeLayout(
	client: SheetsClient,
	tab: string,
	values: unknown[][],
	sheetId: number,
): Promise<MigrationResult> {
	const win = findIncomeWindow(values);
	if (win === null || win.migrated) {
		throw new Error(`migrateIncomeLayout called on ${tab} but its layout is not the expected old one.`);
	}
	const expense = findExpenseWindow(values, tab);
	const remRow = win.end + 1; // the old 剩餘 row
	const cellStr = (r: number, c: number) => String(values[r - 1]?.[c] ?? "");
	const labelRow = (l: string) => findRowByValue(values, MONTH_COLS.budgetLabel, l);

	const usdIncRow = labelRow(USD_INCOME_LABEL);
	const usdSpRow = labelRow(USD_SPENDING_LABEL);
	const usdBalRow = labelRow(USD_BALANCE_LABEL);
	const ntdIncRow = labelRow(NTD_INCOME_LABEL);
	const ntdSpRow = labelRow(NTD_SPENDING_LABEL);
	const ntdBalRow = labelRow(NTD_BALANCE_LABEL);
	if (!usdIncRow || !usdSpRow || !usdBalRow || !ntdIncRow || !ntdSpRow || !ntdBalRow) {
		throw new Error(`Cannot migrate ${tab}: its 銀行餘額 block is missing or incomplete — set it up by hand first.`);
	}
	const bankTop = Math.min(usdIncRow, usdSpRow, usdBalRow, ntdIncRow, ntdSpRow, ntdBalRow);
	if (bankTop <= remRow) {
		throw new Error(`Cannot migrate ${tab}: the 銀行餘額 block sits above the ${REMAINDER_LABEL} row — unexpected layout.`);
	}
	const payRows: Array<{ label: string; row: number }> = [];
	for (const l of [USD_PAYMENT_LABEL, NTD_PAYMENT_LABEL]) {
		const row = labelRow(l);
		if (row === null) continue;
		if (row <= remRow || row >= bankTop) {
			throw new Error(`Cannot migrate ${tab}: "${l}" is not between ${REMAINDER_LABEL} and the 銀行餘額 block — unexpected layout.`);
		}
		payRows.push({ label: l, row });
	}
	// Rows ≤ remRow keep their position; below it: +2 for the insert, −1 per deleted pay row above.
	const finalRow = (r: number) => (r <= remRow ? r : r + 2 - payRows.filter((p) => p.row < r).length);

	const C = colLetter(MONTH_COLS.tag);
	const D = colLetter(MONTH_COLS.budgetValue);
	const F = colLetter(MONTH_COLS.paidWith);
	const changes: MigrationChange[] = [];
	const deletedRows: MigrationResult["deletedRows"] = [];
	const requests: object[] = [];

	// Structural ops first, so every write below can use final row positions.
	requests.push({
		insertDimension: {
			range: { sheetId, dimension: "ROWS", startIndex: remRow, endIndex: remRow + 2 },
			inheritFromBefore: true,
		},
	});
	for (const p of [...payRows].sort((a, b) => b.row - a.row)) {
		requests.push({
			deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: p.row + 2 - 1, endIndex: p.row + 2 } },
		});
		deletedRows.push({ row: p.row, item: p.label, values: values[p.row - 1] ?? [] });
	}

	const write = (row: number, col: number, value: string, before: string) => {
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: row - 1, columnIndex: col },
				rows: [{ values: [cellData(value)] }],
				fields: "userEnteredValue",
			},
		});
		changes.push({ cell: `${colLetter(col)}${row}`, before, after: value });
	};

	write(2, MONTH_COLS.paidWith, "支付幣別", cellStr(2, MONTH_COLS.paidWith));

	// Back-tag 支付幣別 across the expense window: USD-priced → USD, else TWD;
	// existing F values (explicit paid_with) and empty rows are left untouched.
	const expEnd = Math.min(expense.end, expense.totalRow - 1);
	const backTags: object[] = [];
	for (let r = expense.start; r <= expEnd; r++) {
		const hasItem = cellStr(r, MONTH_COLS.item).trim() !== "";
		const existing = cellStr(r, MONTH_COLS.paidWith).trim();
		const tag = !hasItem || existing !== "" ? null : cellStr(r, MONTH_COLS.usd).trim() !== "" ? "USD" : "TWD";
		backTags.push({ values: [cellData(tag)] });
		if (tag !== null) changes.push({ cell: `${F}${r}`, before: existing, after: tag });
	}
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: expense.start - 1, columnIndex: MONTH_COLS.paidWith },
			rows: backTags,
			fields: "userEnteredValue",
		},
	});

	// Existing income rows are TWD (USD income did not exist before this layout).
	const incomeTags: object[] = [];
	for (let r = win.start; r <= win.end; r++) {
		const hasItem = cellStr(r, MONTH_COLS.item).trim() !== "";
		incomeTags.push({ values: [cellData(hasItem ? "TWD" : null)] });
		if (hasItem) changes.push({ cell: `${C}${r}`, before: cellStr(r, MONTH_COLS.tag), after: "TWD" });
	}
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: win.start - 1, columnIndex: MONTH_COLS.tag },
			rows: incomeTags,
			fields: "userEnteredValue",
		},
	});

	// 剩餘 row + the two inserted rows become the 月 view.
	const usdNet = `=${D}${finalRow(usdIncRow)}-${D}${finalRow(usdSpRow)}`;
	const ntdNet = `=${D}${finalRow(ntdIncRow)}-${D}${finalRow(ntdSpRow)}`;
	const monthRemainder = `=${D}${remRow}*GOOGLEFINANCE("CURRENCY:USDTWD")+${D}${remRow + 1}`;
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: remRow - 1, columnIndex: MONTH_COLS.item },
			rows: [
				{ values: [cellData(MONTH_USD_NET_LABEL), cellData(null), cellData(usdNet)] },
				{ values: [cellData(MONTH_NTD_NET_LABEL), cellData(null), cellData(ntdNet)] },
				{ values: [cellData(MONTH_REMAINDER_LABEL), cellData(null), cellData(monthRemainder)] },
			],
			fields: "userEnteredValue",
		},
	});
	changes.push({ cell: `${colLetter(MONTH_COLS.item)}${remRow}`, before: REMAINDER_LABEL, after: MONTH_USD_NET_LABEL });
	changes.push({ cell: `${D}${remRow}`, before: cellStr(remRow, MONTH_COLS.budgetValue), after: usdNet });

	const usd = colLetter(MONTH_COLS.usd);
	const twd = colLetter(MONTH_COLS.twd);
	const incRange = (col: string) => `${col}${win.start}:${col}${win.end}`;
	const expRange = (col: string) => `${col}${expense.start}:${col}${expense.end}`;
	write(finalRow(usdIncRow), MONTH_COLS.budgetValue, `=SUMIF(${incRange(C)},"USD",${incRange(D)})`, cellStr(usdIncRow, MONTH_COLS.budgetValue));
	write(finalRow(usdSpRow), MONTH_COLS.budgetValue, `=SUMIF(${expRange(F)},"USD",${expRange(usd)})`, cellStr(usdSpRow, MONTH_COLS.budgetValue));
	write(finalRow(ntdIncRow), MONTH_COLS.budgetValue, `=SUMIF(${incRange(C)},"TWD",${incRange(D)})`, cellStr(ntdIncRow, MONTH_COLS.budgetValue));
	write(finalRow(ntdSpRow), MONTH_COLS.budgetValue, `=SUMIF(${expRange(F)},"TWD",${expRange(twd)})`, cellStr(ntdSpRow, MONTH_COLS.budgetValue));
	write(finalRow(usdBalRow), MONTH_COLS.item, TOTAL_USD_BALANCE_LABEL, USD_BALANCE_LABEL);
	write(finalRow(ntdBalRow), MONTH_COLS.item, TOTAL_NTD_BALANCE_LABEL, NTD_BALANCE_LABEL);

	await client.batchUpdate(requests);
	return { changes, deletedRows };
}
```

Note the request-order invariant this relies on: the insert/deletes run first inside the one batchUpdate, and Sheets auto-shifts the untouched 餘額 formulas (+2 for the insert, −1 per delete) so they still point at their 收入/支出/上月 rows; every `updateCells` uses post-shift (final) positions.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/finance-ops.test.ts -t "migrateIncomeLayout"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: migrateIncomeLayout — one-batch upgrade to the 月剩餘 income layout"
```

---

### Task 5: `setIncome`

**Files:**
- Modify: `src/finance-ops.ts`, `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: `findIncomeWindow`, `migrateIncomeLayout` (Tasks 2/4), Task 1 labels.
- Produces (exported):
  - `interface SetIncomeParams { item: string; amount: number; currency: "TWD" | "USD"; month?: number }`
  - `setIncome(client: SheetsClient, p: SetIncomeParams): Promise<{ tab, row, action: "updated" | "inserted", item, amount, currency, previous, migration }>` — Task 8 registers the `set_income` tool over this.

- [ ] **Step 1: Write the failing tests**

Add to `test/finance-ops.test.ts` (extend the import with `setIncome`):

```ts
describe("setIncome", () => {
	it("updates an existing income row's 幣別 and amount in place", async () => {
		const client = fakeClient(migratedMonthGrid());

		const result = await setIncome(client, { item: "薪水", amount: 68587, currency: "TWD", month: 9 });

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:H60", "FORMULA"]);
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toEqual([
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 14, columnIndex: 2 },
					rows: [{ values: [{ userEnteredValue: { stringValue: "TWD" } }, { userEnteredValue: { numberValue: 68587 } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(result).toEqual({
			tab: "9 月",
			row: 15,
			action: "updated",
			item: "薪水",
			amount: 68587,
			currency: "TWD",
			previous: { currency: "TWD", amount: "63913" },
			migration: null,
		});
	});

	it("inserts a new ad-hoc income row inside the window so the SUMIFs auto-extend", async () => {
		const client = fakeClient(migratedMonthGrid());

		const result = await setIncome(client, { item: "股息", amount: 120, currency: "USD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// window rows 14-16 are all occupied → insert at the window's LAST row
		// (16), strictly inside C14:C16 / D14:D16, so every SUMIF extends.
		expect(requests).toEqual([
			{
				insertDimension: {
					range: { sheetId: 111, dimension: "ROWS", startIndex: 15, endIndex: 16 },
					inheritFromBefore: true,
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 15, columnIndex: 1 },
					rows: [{ values: [
						{ userEnteredValue: { stringValue: "股息" } },
						{ userEnteredValue: { stringValue: "USD" } },
						{ userEnteredValue: { numberValue: 120 } },
					] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(result).toMatchObject({ row: 16, action: "inserted", previous: null, migration: null });
	});

	it("reuses an empty row inside the income window before inserting", async () => {
		const g = migratedMonthGrid();
		g[15] = ["", "", "", ""]; // row 16 empty (多一個月薪水 removed)
		const client = fakeClient(g);

		const result = await setIncome(client, { item: "獎金", amount: 5000, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toHaveLength(1);
		expect(requests[0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 15, columnIndex: 1 });
		expect(result).toMatchObject({ row: 16, action: "inserted" });
	});

	it("migrates an old-layout tab first, then applies the upsert to the re-read grid", async () => {
		const client = fakeClient(oldLayoutGrid());
		(client.readRange as any)
			.mockResolvedValueOnce({ range: "x", values: oldLayoutGrid(), truncated: false })
			.mockResolvedValueOnce({ range: "x", values: migratedMonthGrid(), truncated: false });

		const result = await setIncome(client, { item: "薪水", amount: 70000, currency: "TWD", month: 9 });

		// batch 1 = migration, batch 2 = the income write
		expect((client.batchUpdate as any).mock.calls).toHaveLength(2);
		expect((client.batchUpdate as any).mock.calls[0][0][0]).toHaveProperty("insertDimension");
		expect((client.batchUpdate as any).mock.calls[1][0][0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 14, columnIndex: 2 });
		expect(result.action).toBe("updated");
		expect(result.migration).not.toBeNull();
		expect(result.migration!.changes.length).toBeGreaterThan(0);
	});

	it("rejects layout labels as income items before touching the sheet", async () => {
		const client = fakeClient(migratedMonthGrid());
		await expect(setIncome(client, { item: "月剩餘", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		await expect(setIncome(client, { item: "花費總額", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		expect((client.readRange as any).mock.calls).toHaveLength(0);
	});

	it("fails with a clear message when the tab has no income list anchors", async () => {
		const client = fakeClient(monthGrid()); // no 總預算 row
		await expect(setIncome(client, { item: "薪水", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("income list");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("refuses to operate on a truncated read", async () => {
		const client = fakeClient(migratedMonthGrid());
		(client.readRange as any).mockResolvedValue({ range: "x", values: migratedMonthGrid(), truncated: true });
		await expect(setIncome(client, { item: "薪水", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("truncated");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts -t "setIncome"`
Expected: FAIL — `setIncome` not exported.

- [ ] **Step 3: Implement in `src/finance-ops.ts`**

Extend the conventions import with `PREV_NTD_BALANCE_LABEL, PREV_USD_BALANCE_LABEL` if not present (they are) and add `OVERDRAFT_LABEL` (present). Add after `migrateIncomeLayout`:

```ts
export interface SetIncomeParams {
	item: string;
	amount: number;
	currency: "TWD" | "USD";
	month?: number;
}

/** Labels that name layout rows, not income items — set_income must never write them into the income list. */
const NON_INCOME_LABELS = new Set<string>([
	BUDGET_HEADER_LABEL,
	REMAINDER_LABEL,
	MONTH_USD_NET_LABEL,
	MONTH_NTD_NET_LABEL,
	MONTH_REMAINDER_LABEL,
	USD_PAYMENT_LABEL,
	NTD_PAYMENT_LABEL,
	TOTAL_ROW_LABEL,
	OVERDRAFT_LABEL,
	USD_INCOME_LABEL,
	USD_SPENDING_LABEL,
	PREV_USD_BALANCE_LABEL,
	USD_BALANCE_LABEL,
	TOTAL_USD_BALANCE_LABEL,
	NTD_INCOME_LABEL,
	NTD_SPENDING_LABEL,
	PREV_NTD_BALANCE_LABEL,
	NTD_BALANCE_LABEL,
	TOTAL_NTD_BALANCE_LABEL,
]);

/**
 * Upsert an income row on a monthly tab: update the row whose 項目 matches,
 * or insert a new ad-hoc row inside the income window (so the 美金收入 /
 * 新臺幣收入 SUMIFs auto-extend). Auto-migrates old-layout tabs first.
 */
export async function setIncome(client: SheetsClient, p: SetIncomeParams) {
	const item = p.item.trim();
	if (NON_INCOME_LABELS.has(item)) {
		throw new Error(`"${item}" is a layout label, not an income item — refusing to write it into the income list.`);
	}
	const tab = p.month !== undefined ? monthTabName(p.month) : currentMonthTab();

	const first = await client.readRange(`${quoteTab(tab)}!${GRID_READ}`, "FORMULA");
	assertNotTruncated(first.truncated, tab, GRID_READ);
	let values = first.values;
	const sheetId = await client.getSheetId(tab);

	let win = findIncomeWindow(values);
	if (win === null) {
		throw new Error(
			`Could not locate the income list in ${tab} (no "${BUDGET_HEADER_LABEL}" + "${MONTH_USD_NET_LABEL}"/"${REMAINDER_LABEL}" anchors in column ${colLetter(MONTH_COLS.budgetLabel)}) — the tab may predate the budget block.`,
		);
	}
	let migration: MigrationResult | null = null;
	if (!win.migrated) {
		migration = await migrateIncomeLayout(client, tab, values, sheetId);
		const reread = await client.readRange(`${quoteTab(tab)}!${GRID_READ}`, "FORMULA");
		assertNotTruncated(reread.truncated, tab, GRID_READ);
		values = reread.values;
		win = findIncomeWindow(values);
		if (win === null || !win.migrated) {
			throw new Error(`Migration of ${tab} did not produce the expected ${MONTH_REMAINDER_LABEL} layout — inspect the tab before retrying.`);
		}
	}

	const cellStr = (r: number, c: number) => String(values[r - 1]?.[c] ?? "");
	let targetRow: number | null = null;
	for (let r = win.start; r <= win.end; r++) {
		if (cellStr(r, MONTH_COLS.item).trim() === item) {
			targetRow = r;
			break;
		}
	}

	const requests: object[] = [];
	let action: "updated" | "inserted";
	let previous: { currency: string | null; amount: string } | null = null;
	if (targetRow !== null) {
		action = "updated";
		previous = {
			currency: cellStr(targetRow, MONTH_COLS.tag).trim() || null,
			amount: cellStr(targetRow, MONTH_COLS.budgetValue),
		};
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: targetRow - 1, columnIndex: MONTH_COLS.tag },
				rows: [{ values: [cellData(p.currency), cellData(p.amount)] }],
				fields: "userEnteredValue",
			},
		});
	} else {
		action = "inserted";
		// First fully-empty row inside the window; else insert at the window's
		// LAST row — strictly inside every range spanning the window, so the
		// income SUMIFs (and the 月-row anchors below) auto-extend.
		for (let r = win.start; r <= win.end; r++) {
			const row = values[r - 1] ?? [];
			if (!row.some((c) => c !== "" && c != null)) {
				targetRow = r;
				break;
			}
		}
		if (targetRow === null) {
			if (win.end <= win.start) {
				throw new Error(`The income list in ${tab} (rows ${win.start}-${win.end}) is too small to insert into safely.`);
			}
			targetRow = win.end;
			requests.push({
				insertDimension: {
					range: { sheetId, dimension: "ROWS", startIndex: targetRow - 1, endIndex: targetRow },
					inheritFromBefore: true,
				},
			});
		}
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: targetRow - 1, columnIndex: MONTH_COLS.item },
				rows: [{ values: [cellData(item), cellData(p.currency), cellData(p.amount)] }],
				fields: "userEnteredValue",
			},
		});
	}

	await client.batchUpdate(requests);
	return { tab, row: targetRow, action, item, amount: p.amount, currency: p.currency, previous, migration };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: setIncome — upsert income rows with 幣別, auto-migrating old tabs"
```

---

### Task 6: `monthSummary` — incomes array, 月 fields, 總…餘額 keys

**Files:**
- Modify: `src/finance-ops.ts` (monthSummary), `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: `findIncomeWindow`, `findRowByLabels`, Task 1 labels.
- Produces: monthSummary result gains `incomes: Array<{ item: string; currency: string | null; amount: number | null }>`, `月美金餘額`, `月新臺幣餘額`, `月剩餘`, and renames `美金餘額`→`總美金餘額`, `新臺幣餘額`→`總新臺幣餘額` (old-label fallback); drops `美金支付`. Task 8 updates the tool description to match.

- [ ] **Step 1: Update the existing test and add the migrated-layout test**

In the existing `"returns unformatted numbers keyed to the sheet's own labels"` test, update the expected object: remove `美金支付: 640.42`, rename `美金餘額` → `總美金餘額` and `新臺幣餘額` → `總新臺幣餘額` (same numbers — the fixture's old labels are read via fallback), and add `incomes: [], 月美金餘額: null, 月新臺幣餘額: null, 月剩餘: null` (the old fixture has no 總預算 header, so the income list is not found).

Then add:

```ts
	it("reports the migrated layout: incomes list, 月 fields, 總…餘額 keys", async () => {
		const grid = migratedMonthGrid();
		// UNFORMATTED render: formulas come back as computed numbers
		grid[2] = [46266, "上月透支", "透支", "", 13603.67, "TWD"];
		grid[3] = ["", "Google Cloud", "訂閱", 11.53, 368.44, "USD"];
		grid[4] = ["", "電話費", "生活用品", "", 1261, "TWD"];
		grid[10] = ["", "", "", "花費總額", 15233.11];
		grid[16] = ["", "月美金餘額", "", -11.53];
		grid[17] = ["", "月新臺幣餘額", "", 133296.33];
		grid[18] = ["", "月剩餘", "", 132927.44];
		grid[21] = ["", "美金收入", "", 0];
		grid[22] = ["", "美金支出", "", 11.53];
		grid[23] = ["", "上月美金餘額", "", 1000];
		grid[24] = ["", "總美金餘額", "", 988.47];
		grid[25] = ["", "新臺幣收入", "", 148326];
		grid[26] = ["", "新臺幣支出", "", 15029.67];
		grid[27] = ["", "上月新臺幣餘額", "", 5000];
		grid[28] = ["", "總新臺幣餘額", "", 138296.33];
		const client = fakeClient(grid);

		const result = await monthSummary(client, 9);

		expect(result).toEqual({
			tab: "9 月",
			花費總額: 15233.11,
			上月透支: 13603.67,
			tags: { 透支: 13603.67, 訂閱: 368.44, 生活用品: 1261 },
			incomes: [
				{ item: "沛還", currency: "TWD", amount: 20500 },
				{ item: "薪水", currency: "TWD", amount: 63913 },
				{ item: "多一個月薪水", currency: "TWD", amount: 63913 },
			],
			薪水: 63913,
			沛還: 20500,
			剩餘: null,
			月美金餘額: -11.53,
			月新臺幣餘額: 133296.33,
			月剩餘: 132927.44,
			美金收入: 0,
			美金支出: 11.53,
			上月美金餘額: 1000,
			總美金餘額: 988.47,
			新臺幣收入: 148326,
			新臺幣支出: 15029.67,
			上月新臺幣餘額: 5000,
			總新臺幣餘額: 138296.33,
		});
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts -t "monthSummary"`
Expected: FAIL — result shape mismatch.

- [ ] **Step 3: Implement**

In `monthSummary`, after the `tags` computation add:

```ts
	// Income list (post- or pre-migration window); empty when the tab has no 總預算 anchor.
	const win = findIncomeWindow(values);
	const incomes: Array<{ item: string; currency: string | null; amount: number | null }> = [];
	if (win !== null) {
		for (let r = win.start; r <= win.end; r++) {
			const incomeItem = String(values[r - 1]?.[MONTH_COLS.item] ?? "").trim();
			if (incomeItem === "") continue;
			incomes.push({
				item: incomeItem,
				currency: String(values[r - 1]?.[MONTH_COLS.tag] ?? "").trim() || null,
				amount: num(values[r - 1]?.[MONTH_COLS.budgetValue]),
			});
		}
	}
```

Replace the returned object with:

```ts
	return {
		tab,
		花費總額: cellAt(totalRow, MONTH_COLS.totalValue),
		上月透支: cellAt(rowByItem(OVERDRAFT_LABEL), MONTH_COLS.twd),
		tags,
		incomes,
		薪水: cellAt(rowByItem(SALARY_LABEL), MONTH_COLS.budgetValue),
		沛還: cellAt(rowByItem(REPAYMENT_LABEL), MONTH_COLS.budgetValue),
		// Old-layout only; null once migration replaces it with the 月 rows.
		剩餘: cellAt(rowByItem(REMAINDER_LABEL), MONTH_COLS.budgetValue),
		月美金餘額: cellAt(rowByItem(MONTH_USD_NET_LABEL), MONTH_COLS.budgetValue),
		月新臺幣餘額: cellAt(rowByItem(MONTH_NTD_NET_LABEL), MONTH_COLS.budgetValue),
		月剩餘: cellAt(rowByItem(MONTH_REMAINDER_LABEL), MONTH_COLS.budgetValue),
		// 銀行餘額 block — per-currency running balance (null on tabs that predate it).
		美金收入: cellAt(rowByItem(USD_INCOME_LABEL), MONTH_COLS.budgetValue),
		美金支出: cellAt(rowByItem(USD_SPENDING_LABEL), MONTH_COLS.budgetValue),
		上月美金餘額: cellAt(rowByItem(PREV_USD_BALANCE_LABEL), MONTH_COLS.budgetValue),
		總美金餘額: cellAt(findRowByLabels(values, MONTH_COLS.item, [TOTAL_USD_BALANCE_LABEL, USD_BALANCE_LABEL]), MONTH_COLS.budgetValue),
		新臺幣收入: cellAt(rowByItem(NTD_INCOME_LABEL), MONTH_COLS.budgetValue),
		新臺幣支出: cellAt(rowByItem(NTD_SPENDING_LABEL), MONTH_COLS.budgetValue),
		上月新臺幣餘額: cellAt(rowByItem(PREV_NTD_BALANCE_LABEL), MONTH_COLS.budgetValue),
		總新臺幣餘額: cellAt(findRowByLabels(values, MONTH_COLS.item, [TOTAL_NTD_BALANCE_LABEL, NTD_BALANCE_LABEL]), MONTH_COLS.budgetValue),
	};
```

(`USD_PAYMENT_LABEL` may become unused in this file if nothing else references it — it is still used by `NON_INCOME_LABELS` and migration, so the import stays.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: month_summary reports incomes, 月 fields, and 總…餘額 balances"
```

---

### Task 7: `startMonth` — ad-hoc income clearing + 總…餘額 fallback rewiring

**Files:**
- Modify: `src/finance-ops.ts` (startMonth), `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: `findIncomeWindow`, `findRowByLabels`, `RECURRING_INCOME` (Task 1).
- Produces: startMonth result gains `clearedIncomes: string[]`; carry-over rewiring accepts both 總美金餘額/美金餘額 and 總新臺幣餘額/新臺幣餘額.

- [ ] **Step 1: Update existing expectations + add the migrated-layout test**

- In `"duplicates the previous month, rewires 上月透支, and deletes one-off rows bottom-up"`: change the final `expect(result).toEqual({...})` to include `clearedIncomes: []` (the old fixture has no 總預算, so no income window is found and nothing income-related is deleted).
- `"deletes multiple one-off rows bottom-up"` uses `result.cleared` only — unchanged.

Add:

```ts
	it("clears ad-hoc income rows but keeps 沛還/薪水, rewiring 上月餘額 to the 總…餘額 rows", async () => {
		const client = startMonthClient(migratedMonthGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		// carry-over: 上月美金餘額 (row 24) ← 9 月's 總美金餘額 (row 25); NTD likewise (28 ← 29)
		const carryWrites = requests.filter(
			(r: any) => r.updateCells && r.updateCells.start.columnIndex === MONTH_COLS.budgetValue,
		);
		expect(carryWrites).toEqual([
			{
				updateCells: {
					start: { sheetId: 555, rowIndex: 23, columnIndex: 3 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "='9 月'!D25" } }] }],
					fields: "userEnteredValue",
				},
			},
			{
				updateCells: {
					start: { sheetId: 555, rowIndex: 27, columnIndex: 3 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "='9 月'!D29" } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
		// 多一個月薪水 (row 16) is the only ad-hoc income; expense rows are all recurring
		const deletes = requests.filter((r: any) => r.deleteDimension);
		expect(deletes).toEqual([
			{ deleteDimension: { range: { sheetId: 555, dimension: "ROWS", startIndex: 15, endIndex: 16 } } },
		]);
		expect(result.cleared).toEqual([]);
		expect(result.clearedIncomes).toEqual(["多一個月薪水"]);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts -t "startMonth"`
Expected: FAIL — `clearedIncomes` missing / carry-over rows not found on the migrated grid.

- [ ] **Step 3: Implement**

Extend the conventions import with `RECURRING_INCOME`. In `startMonth`:

1. Replace the carry-over loop's tuple list and lookup:

```ts
	for (const [prevLabel, balanceLabels] of [
		[PREV_USD_BALANCE_LABEL, [TOTAL_USD_BALANCE_LABEL, USD_BALANCE_LABEL]],
		[PREV_NTD_BALANCE_LABEL, [TOTAL_NTD_BALANCE_LABEL, NTD_BALANCE_LABEL]],
	] as const) {
		const prevBalanceRow = findRowByValue(values, MONTH_COLS.budgetLabel, prevLabel);
		const balanceRow = findRowByLabels(values, MONTH_COLS.budgetLabel, balanceLabels);
		if (prevBalanceRow === null || balanceRow === null) continue;
```

(the rest of the loop body is unchanged).

2. After the expense-window loop that fills `kept`/`cleared`/`rowsToDelete` and BEFORE the bottom-up delete loop, add:

```ts
	// Ad-hoc income rows are one-offs too: keep 沛還/薪水, delete the rest.
	// Same lockstep argument as the carry-over writes above: these deletes run
	// after the updateCells requests, so earlier writes shift with their rows.
	const clearedIncomes: string[] = [];
	const incomeWin = findIncomeWindow(values);
	if (incomeWin !== null) {
		for (let r = incomeWin.start; r <= incomeWin.end; r++) {
			const incomeItem = String(values[r - 1]?.[MONTH_COLS.item] ?? "").trim();
			if (incomeItem === "" || RECURRING_INCOME.has(incomeItem)) continue;
			clearedIncomes.push(incomeItem);
			rowsToDelete.push(r);
		}
	}
```

3. Change the return to `return { tab: newTab, duplicatedFrom: prevTab, kept, cleared, clearedIncomes };`

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: start_month clears ad-hoc income rows, rewires 總…餘額 carry-over"
```

---

### Task 8: Tools + conventions text — `set_income`, `paid_with`, rewritten CONVENTIONS_TEXT

**Files:**
- Modify: `src/tools.ts`, `src/conventions.ts` (CONVENTIONS_TEXT), `test/conventions.test.ts`

**Interfaces:**
- Consumes: `setIncome` (Task 5), `addExpense.paidWith` (Task 3).
- Produces: MCP tools `set_income` and `add_expense(paid_with)`; CONVENTIONS_TEXT describing the new layout.

- [ ] **Step 1: Update the CONVENTIONS_TEXT needle test**

In `test/conventions.test.ts`, extend the needle list in `"conventions text mentions the anchors Claude needs"` with:

```ts
				"支付幣別",
				"月剩餘",
				"月美金餘額",
				"總美金餘額",
				"set_income",
				"幣別",
```

(keep the existing `"新臺幣支付"` needle — the rewritten text still names it as deprecated).

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run test/conventions.test.ts`
Expected: FAIL — CONVENTIONS_TEXT lacks 月剩餘 etc.

- [ ] **Step 3: Rewrite the monthly-tab section of CONVENTIONS_TEXT**

In `src/conventions.ts`, replace the MONTHLY TABS block of `CONVENTIONS_TEXT` (everything from `MONTHLY TABS` up to but not including `TRIP TABS`) with:

```
MONTHLY TABS — named "N 月" (e.g. "9 月", with a space). Layout below applies from 7 月 2026 on; 6 月 and earlier lack the 類別 column. Tabs are migrated to the income layout described here the first time set_income touches them; an unmigrated tab still has the old 剩餘 / 美金支付 / 新臺幣支付 rows and hand-entered 收入 cells.
- Header row 2: 日期 項目 類別 美金 新臺幣 支付幣別. Expense list in columns A-F from row 3 down: A=日期 (a real date shown mm/dd; blank on recurring rows), B=item, C=類別 (per-row tag: 訂閱, 吃喝, 交通, 生活用品, 娛樂, 購物, 其他, 透支), D=美金 (USD), E=新臺幣 (TWD), F=支付幣別 (USD or TWD — which real account PAID the row; a USD-priced expense paid with a TWD card has D filled but F=TWD).
- USD rows convert with E = D*GOOGLEFINANCE("CURRENCY:USDTWD").
- The list ends at the "花費總額" row (label in column D, total in E, formula SUM over the window). New expenses must land INSIDE that window — write into an empty row above 花費總額, or insert a row inside the window so the SUM extends. Never append below 花費總額.
- Row 3 "上月透支" carries last month's overdraft via a cross-tab formula.
- Categorization is the per-row 類別 tag in column C (see month_summary's per-類別 totals). The old G/H summary block is DEPRECATED — ignore any remnants.
- Below the list, the income section: a 總預算 header row, then the income list (labels in B, 幣別 USD/TWD in C, amounts in D): 沛還, 薪水, plus ad-hoc income rows (e.g. 多一個月薪水) — manage these with set_income, which upserts by 項目 and keeps the SUMIFs covering every row. The list ends at 月美金餘額 / 月新臺幣餘額 (THIS month's 收入−支出 per currency, from the 銀行餘額 block) and 月剩餘 (= 月美金餘額*GOOGLEFINANCE USDTWD + 月新臺幣餘額 — the month's combined remainder in TWD). The old 剩餘, 美金支付 and 新臺幣支付 rows are DEPRECATED and removed by migration.
- Further down, a 銀行餘額 block reconciles the real USD and NTD bank accounts as two INDEPENDENT running ledgers (labels in column B, values in column D): 美金收入 / 美金支出 / 上月美金餘額 / 總美金餘額, then 新臺幣收入 / 新臺幣支出 / 上月新臺幣餘額 / 總新臺幣餘額 (renamed by migration from 美金餘額/新臺幣餘額 — unmigrated tabs still use the short names). 收入 cells = SUMIF over the income list's 幣別 column; 美金支出 = SUMIF of the expense 支付幣別 for USD summing column D; 新臺幣支出 = SUMIF for TWD summing column E. Each 總…餘額 = 上月…餘額 + 收入 − 支出 (surplus AND overdraft carry). 上月…餘額 point at the previous month's 總…餘額 cell (start_month rewires them); in the earliest month they are seeded by hand.
```

Also update the closing "Prefer the tailored tools" paragraph's tool list from `(add_expense, month_summary, start_month, add_trip_entry)` to `(add_expense, set_income, month_summary, start_month, add_trip_entry)`.

- [ ] **Step 4: Register the tools in `src/tools.ts`**

Extend the finance-ops import with `setIncome`. In `add_expense`'s schema, after `currency:` add:

```ts
			paid_with: z
				.enum(["TWD", "USD"])
				.optional()
				.describe(
					"Which real account paid the row — written to the 支付幣別 column (F); defaults to currency. Use currency USD + paid_with TWD for a USD-priced expense paid from the NTD account.",
				),
```

and change the handler to map the snake_case param:

```ts
		async ({ paid_with, ...p }) => {
			try {
				return ok(await addExpense(client, { ...p, paidWith: paid_with }));
			} catch (e) {
				return toError(e);
			}
		},
```

After the `add_expense` registration, add:

```ts
	server.tool(
		"set_income",
		"Fill in an income row on a monthly tab (defaults to the current month): updates the row if the 項目 already exists (薪水, 沛還, …), otherwise inserts a new ad-hoc income row with its 幣別 — the 美金收入/新臺幣收入 SUMIFs keep covering every row. On an old-layout tab it first migrates the income section (支付幣別 column, 月剩餘 rows, SUMIF rewrites, 總…餘額 renames); the response details every migration change with previous values.",
		{
			item: z.string().min(1).describe("Income name, e.g. 薪水, 沛還, 股息"),
			amount: z.number().describe("The amount, in the given currency"),
			currency: z.enum(["TWD", "USD"]).describe("The income's 幣別 — routes it into 新臺幣收入 or 美金收入"),
			month: monthParam.optional().describe("Target month 1-12 (default: current month)"),
		},
		async (p) => {
			try {
				return ok(await setIncome(client, p));
			} catch (e) {
				return toError(e);
			}
		},
	);
```

Update `month_summary`'s description to:

```
"Get a month's numbers as clean JSON (unformatted): 花費總額, 上月透支, per-類別 tag totals, the income list (item/幣別/amount), 薪水, 沛還, 月美金餘額/月新臺幣餘額/月剩餘, plus the 銀行餘額 running-balance block (美金收入/美金支出/上月美金餘額/總美金餘額 and the NTD counterparts; old unmigrated tabs report 剩餘 and the un-renamed balances too). Defaults to the current month. Fields the sheet doesn't have yet come back null."
```

- [ ] **Step 5: Run the full suite and typecheck**

Run: `bun run test && bun run type-check`
Expected: all tests PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/tools.ts src/conventions.ts test/conventions.test.ts
git commit -m "feat: register set_income + paid_with, rewrite monthly-tab conventions"
```

---

### Task 9: Full verification + dev-sheet end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck from a clean tree**

Run: `bun run test && bun run type-check`
Expected: every test file PASS, no type errors, `git status` clean.

- [ ] **Step 2: End-to-end against the dev copy sheet**

`bun run dev` starts the worker locally on port 8788 with `.dev.vars` (which points SPREADSHEET_ID at the copy sheet). Exercise via the MCP endpoint (or the connected claude.ai dev MCP):

1. `set_income` `{ item: "薪水", amount: 68587, currency: "TWD", month: 7 }` on the copy sheet's old-layout 7 月 → expect `action: "updated"` and a populated `migration.changes`; eyeball the tab: F column 支付幣別 back-tagged, 剩餘/美金支付/新臺幣支付 gone, 月美金餘額/月新臺幣餘額/月剩餘 present, balances renamed 總美金餘額/總新臺幣餘額.
2. `set_income` `{ item: "股息", amount: 120, currency: "USD", month: 7 }` → new row inside the income list; 美金收入 SUMIF now covers it (check the formula range grew).
3. `add_expense` `{ item: "測試", amount: 100, currency: "USD", paid_with: "TWD", tag: "其他", month: 7 }` → F cell says TWD; 新臺幣支出 includes its E amount, 美金支出 does not include its D amount.
4. `month_summary` `{ month: 7 }` → incomes lists 沛還/薪水/多一個月薪水/股息, 月剩餘 ≈ 月美金餘額×rate + 月新臺幣餘額, 剩餘 is null.
5. Revert the test rows on the copy sheet (delete 股息 + 測試 rows by hand or via update_range) if desired — it is the dev copy, so this is optional.

- [ ] **Step 3: Wrap up**

Use the superpowers:finishing-a-development-branch skill (merge vs PR decision is Vincent's).
