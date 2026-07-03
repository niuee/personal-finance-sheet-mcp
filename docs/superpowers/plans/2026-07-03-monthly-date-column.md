# Monthly-Tab Date Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remap the tailored sheets-MCP tools to the monthly-tab layout after Vincent inserted a 日期 (date) column as column A, and teach `add_expense`/`start_month` about dates.

**Architecture:** `src/conventions.ts` is the single source of truth for sheet layout — it gains a `MONTH_COLS` column map and date-parsing helpers. `src/finance-ops.ts` swaps its hardcoded column indices/letters for those constants. `src/tools.ts` exposes the new optional `date` parameter. Spec: `docs/superpowers/specs/2026-07-03-monthly-date-column-design.md`.

**Tech Stack:** TypeScript on Cloudflare Workers, vitest, zod, bun.

## Global Constraints

- Run everything with bun: `bun run test` (vitest run), `bun run type-check` (tsc --noEmit). Never npm.
- New layout only — 6–9月 geometry. 5月's pre-standard layout stays unsupported.
- Monthly-tab geometry (0-indexed cols): A(0)=日期, B(1)=項目/budget labels, C(2)=美金 + 花費總額 label + budget values, D(3)=新臺幣 + total SUM, F(5)=category labels, G(6)=category formulas.
- Dates in the sheet are real date serials (days since 1899-12-30) displayed `mm/dd`. 2026-07-01 = serial 46204 (verified on live sheet). 2026-09-01 = 46266.
- `date` on add_expense is OPTIONAL; omitted = leave column A untouched. start_month clears all kept dates.
- Fail closed: validate before any write; error messages name the anchor and column they searched.
- Commit after each green task with a `feat:`/`test:`/`refactor:` message ending in the Claude co-author trailer.

---

### Task 1: Layout constants + date helpers in conventions.ts

**Files:**
- Modify: `src/conventions.ts`
- Test: `test/conventions.test.ts`

**Interfaces:**
- Produces: `MONTH_COLS` (`{date:0, item:1, usd:2, twd:3, totalLabel:2, totalValue:3, categoryLabel:5, categoryFormula:6, budgetLabel:1, budgetValue:2}` as const), `dateSerial(year, month, day): number`, `parseDateInput(input: string, now?: Date): number` (throws on bad input), updated `CONVENTIONS_TEXT`.

- [ ] **Step 1: Write the failing tests**

Add to `test/conventions.test.ts` — extend the import from `../src/conventions` with `MONTH_COLS, dateSerial, parseDateInput`, and add inside `describe("conventions")`:

```ts
	it("maps the monthly-tab columns (date-column layout)", () => {
		expect(MONTH_COLS).toEqual({
			date: 0,
			item: 1,
			usd: 2,
			twd: 3,
			totalLabel: 2,
			totalValue: 3,
			categoryLabel: 5,
			categoryFormula: 6,
			budgetLabel: 1,
			budgetValue: 2,
		});
	});

	it("converts calendar dates to Sheets serials", () => {
		expect(dateSerial(1899, 12, 31)).toBe(1);
		expect(dateSerial(2026, 7, 1)).toBe(46204); // matches the live sheet's 7月!A3
	});

	it("parses M/D input with the current Taipei year", () => {
		const now = new Date("2026-07-02T12:00:00Z");
		expect(parseDateInput("7/1", now)).toBe(46204);
		expect(parseDateInput("07/01", now)).toBe(46204);
	});

	it("parses explicit years in slash and dash forms", () => {
		expect(parseDateInput("2026/07/01")).toBe(46204);
		expect(parseDateInput("2026-7-1")).toBe(46204);
	});

	it("resolves the default year in Taipei time across the UTC year boundary", () => {
		// 2026-12-31T17:00:00Z is already 2027-01-01 01:00 in Taipei
		expect(parseDateInput("1/1", new Date("2026-12-31T17:00:00Z"))).toBe(dateSerial(2027, 1, 1));
	});

	it("rejects unparseable and impossible dates", () => {
		expect(() => parseDateInput("tomorrow")).toThrow("Unrecognized date");
		expect(() => parseDateInput("13/40")).toThrow("Invalid date");
		expect(() => parseDateInput("2026/02/30")).toThrow("Invalid date");
	});
```

Also extend the needle list in the existing `"conventions text mentions the anchors Claude needs"` test with `"日期"` and `"新臺幣支付"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/conventions.test.ts`
Expected: FAIL — `MONTH_COLS`, `dateSerial`, `parseDateInput` are not exported; needle assertions fail.

- [ ] **Step 3: Implement in conventions.ts**

Insert after the `SHEET_TIMEZONE` declaration:

```ts
/** 0-indexed columns of a monthly tab (a 日期 column was inserted as column A in 2026-07). */
export const MONTH_COLS = {
	/** A — 日期, a real date displayed mm/dd; blank on recurring rows. */
	date: 0,
	/** B — 項目 (also where 上月透支 and the budget-block labels live). */
	item: 1,
	/** C — 美金 (USD). */
	usd: 2,
	/** D — 新臺幣 (TWD). */
	twd: 3,
	/** C — the 花費總額 label. */
	totalLabel: 2,
	/** D — the 花費總額 =SUM window. */
	totalValue: 3,
	/** F — category labels (訂閱費 …). */
	categoryLabel: 5,
	/** G — category sum formulas. */
	categoryFormula: 6,
	/** B — budget-block labels (沛還/薪水/剩餘/美金支付). */
	budgetLabel: 1,
	/** C — budget-block values. */
	budgetValue: 2,
} as const;

/** Sheets date serial: days since 1899-12-30. */
export function dateSerial(year: number, month: number, day: number): number {
	return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

const DATE_INPUT_RE = /^(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})$/;

/** "M/D", "MM/DD", "YYYY/M/D", or "YYYY-MM-DD" → Sheets serial; a missing year means the current year in Taipei. */
export function parseDateInput(input: string, now: Date = new Date()): number {
	const m = input.trim().match(DATE_INPUT_RE);
	if (!m) {
		throw new Error(`Unrecognized date "${input}" (expected M/D, MM/DD, or YYYY-MM-DD).`);
	}
	const year =
		m[1] !== undefined
			? Number(m[1])
			: Number(new Intl.DateTimeFormat("en-US", { timeZone: SHEET_TIMEZONE, year: "numeric" }).format(now));
	const month = Number(m[2]);
	const day = Number(m[3]);
	const d = new Date(Date.UTC(year, month - 1, day));
	if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
		throw new Error(`Invalid date "${input}".`);
	}
	return dateSerial(year, month, day);
}
```

Replace the two MONTHLY-TABS-layout bullets and the summary/budget bullets of `CONVENTIONS_TEXT` so the monthly section reads:

```
MONTHLY TABS — named "N 月" (e.g. "9 月", with a space).
- Header row 2: 日期 項目 美金 新臺幣. Expense list in columns A-D from row 3 down: A=日期 (a real date shown mm/dd; blank on recurring rows), B=item, C=美金 (USD), D=新臺幣 (TWD).
- USD rows convert with D = C*GOOGLEFINANCE("CURRENCY:USDTWD").
- The list ends at the "花費總額" row (label in column C, total in D, formula SUM over the window). New expenses must land INSIDE that window — write into an empty row above 花費總額, or insert a row inside the window so the SUM extends. Never append below 花費總額.
- Row 3 "上月透支" carries last month's overdraft via a cross-tab formula.
- Summary block, labels in column F / values in G: 訂閱費, 基本房租生活費 (fixed rent, not a sum), 交通中餐等等雜支, 本月額外雜支. The sums reference hand-picked cells (e.g. sum(D22,D3)) — adding an expense to a category means splicing its D-cell into that formula.
- Below the list: 總預算 / 沛還 / 薪水 / 剩餘 / 美金支付 / 新臺幣支付 (labels in column B, values in column C).
```

Keep the TRIP TABS / OTHER / closing-advice paragraphs exactly as they are.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- test/conventions.test.ts`
Expected: PASS (all). Note: `test/finance-ops.test.ts` still passes at this point — nothing consumes the new exports yet.

- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts test/conventions.test.ts
git commit -m "feat: MONTH_COLS layout map and date helpers for the new 日期 column

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Remap finance-ops to the shifted columns

**Files:**
- Modify: `src/finance-ops.ts` (addExpense, monthSummary, startMonth, GRID_READ)
- Test: `test/finance-ops.test.ts` (monthGrid fixture + addExpense/monthSummary/startMonth suites)

**Interfaces:**
- Consumes: `MONTH_COLS` from Task 1 (import it in `src/finance-ops.ts`).
- Produces: same exported signatures as today; `GRID_READ` becomes `"A1:H60"`. Module-level consts `USD_COL`/`TWD_COL`/`EXPENSE_WINDOW_RE` (not exported).

- [ ] **Step 1: Rewrite the fixture and expectations to the new layout (failing tests)**

In `test/finance-ops.test.ts`, replace `monthGrid()` with:

```ts
/** Grid mirroring the real 9月 layout after the 日期 column (FORMULA render). Row = index+1. */
function monthGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["9 月花費"];
	g[1] = ["日期", "項目", "美金", "新臺幣"];
	g[2] = [46266, "上月透支", "", "=IF(-'8 月'!C32 > 0, -'8 月'!C32, 0)"];
	g[3] = ["", "Google Cloud", 11.53, '=C4*GOOGLEFINANCE("CURRENCY:USDTWD")'];
	g[4] = ["", "ElevenLabs", 6, '=C5*GOOGLEFINANCE("CURRENCY:USDTWD")', "", "訂閱費", "=sum(D4,D5)"];
	g[5] = ["", "iCloud", 9.99, '=C6*GOOGLEFINANCE("CURRENCY:USDTWD")', "", "基本房租生活費", "=20000"];
	g[6] = ["", "電話費", "", 1261, "", "交通中餐等等雜支", "=sum(D7)"];
	g[7] = ["", "近鐵 80000系", "", "='火車模型'!D4", "", "本月額外雜支", "=sum(D8,D3)"];
	// rows 9-10 (indices 8-9) empty inside the window
	g[10] = ["", "", "花費總額", "=SUM(D3:D10)"];
	g[12] = ["", "沛還", 20500];
	g[13] = ["", "薪水", 63913];
	g[14] = ["", "剩餘", "=sum(C13:C14)-D11"];
	g[15] = ["", "美金支付", 640.42];
	return g;
}
```

Then update the three describe blocks:

**`addExpense` suite:**
- Every `readRange` assertion: `["'9 月'!A1:H60", "FORMULA"]`.
- "writes a TWD expense…": expense `updateCells` becomes `start: { sheetId: 111, rowIndex: 8, columnIndex: 1 }` with the same three cells (`晚餐`, `{}`, `250`); category `updateCells` becomes `start: { sheetId: 111, rowIndex: 7, columnIndex: 6 }` with formula `"=sum(D8,D3,D9)"`; result `categoryFormula: "=sum(D8,D3,D9)"`.
- "writes a USD expense…": expense cells `["API credits", 30, '=C9*GOOGLEFINANCE("CURRENCY:USDTWD")']` at `columnIndex: 1`; category `start: { sheetId: 111, rowIndex: 4, columnIndex: 6 }`, formula `"=sum(D4,D5,D9)"`.
- "inserts a row inside the SUM window…": filler rows become `grid[8] = ["", "already", "", 1]` and `grid[9] = ["", "full", "", 2]`; insertDimension unchanged (indices 9→10); expense write at `columnIndex: 1`; category formula `"=sum(D8,D3,D10)"` at `columnIndex: 6`.
- "shifts the category formula row…": rebuild the mini-grid as
  ```ts
	g[0] = ["title"];
	g[2] = ["", "a", "", 1];
	g[3] = ["", "b", "", 2];
	g[4] = ["", "c", "", 3, "", "本月額外雜支", "=sum(D3)"];
	g[5] = ["", "", "花費總額", "=SUM(D3:D5)"];
  ```
  and expect `requests[2].updateCells.start` `columnIndex: 6`, formula `"=sum(D3,D5)"`.
- "fails closed when the 花費總額 cell is not a plain SUM range": `g[10] = ["", "", "花費總額", "=SUM(D3:D10)+D2"]`.
- "inserts inside the SUM window even when it ends above the total row": `g[10] = ["", "", "花費總額", "=SUM(D3:D8)"]`; expected spliced formula `"=sum(D9,D3,D8)"`.
- "rejects unknown categories…" and "refuses… truncated" need no expectation changes.

**`monthSummary` suite** — fixture overrides and read assertion:

```ts
			grid[2] = ["", "上月透支", "", 13603.67];
			grid[4] = ["", "ElevenLabs", 6, 191.43, "", "訂閱費", 26843.6];
			grid[6] = ["", "電話費", "", 1261, "", "交通中餐等等雜支", 5511];
			grid[7] = ["", "近鐵 80000系", "", 5690.37, "", "本月額外雜支", 19294.03];
			grid[10] = ["", "", "花費總額", 72127.21];
			grid[14] = ["", "剩餘", 12285.79];
```

`readRange` assertion: `["'9 月'!A1:H60", "UNFORMATTED_VALUE"]`. The expected result object is unchanged.

**`startMonth` suite:**
- "duplicates the previous month…": `requests[1]` (overdraft rewire) becomes `start: { sheetId: 555, rowIndex: 2, columnIndex: 3 }` with formula `"=IF(-'9 月'!C32 > 0, -'9 月'!C32, 0)"`. `requests[2]` (the delete) and the kept/cleared result are unchanged.
- "scrubs #REF!…": the second mocked read's poisoned row becomes `g[7] = ["", "", "", "", "", "本月額外雜支", "=sum(#REF!,D3)"]`; scrub expectation becomes `start: { sheetId: 555, rowIndex: 7, columnIndex: 6 }` with `"=sum(D3)"`.
- "deletes multiple one-off rows bottom-up": filler rows become `grid[8] = ["", "一次性A", "", 10]` and `grid[9] = ["", "一次性B", "", 20]`; expectations unchanged.
- "refuses to overwrite…" needs no changes.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/finance-ops.test.ts`
Expected: FAIL — addExpense/monthSummary/startMonth suites all red (old column indices); formula-surgery/trip/helper suites still green.

- [ ] **Step 3: Remap src/finance-ops.ts**

Add `MONTH_COLS` to the import from `./conventions`. Change `GRID_READ`:

```ts
/** The window that contains every anchor a monthly tab needs. */
export const GRID_READ = "A1:H60";
```

Below `colLetter`, add:

```ts
const USD_COL = colLetter(MONTH_COLS.usd);
const TWD_COL = colLetter(MONTH_COLS.twd);
const EXPENSE_WINDOW_RE = new RegExp(`^=SUM\\(${TWD_COL}(\\d+):${TWD_COL}(\\d+)\\)$`, "i");
```

In `addExpense`, replace the anchor lookups and writes:

```ts
	const totalRow = findRowByValue(values, MONTH_COLS.totalLabel, TOTAL_ROW_LABEL);
	if (totalRow === null) {
		throw new Error(
			`Could not find the "${TOTAL_ROW_LABEL}" row in ${tab} (searched column ${colLetter(MONTH_COLS.totalLabel)} of ${GRID_READ}).`,
		);
	}
	const totalFormula = String(values[totalRow - 1]?.[MONTH_COLS.totalValue] ?? "");
	const windowMatch = totalFormula.match(EXPENSE_WINDOW_RE);
	if (!windowMatch) {
		throw new Error(
			`The "${TOTAL_ROW_LABEL}" cell ${TWD_COL}${totalRow} in ${tab} is not a plain =SUM(${TWD_COL}start:${TWD_COL}end) formula (got "${totalFormula}") — cannot locate the expense window safely.`,
		);
	}
```

```ts
	const categoryRow = findRowByValue(values, MONTH_COLS.categoryLabel, categoryLabel);
	if (categoryRow === null) {
		throw new Error(
			`Could not find the category label "${categoryLabel}" in column ${colLetter(MONTH_COLS.categoryLabel)} of ${tab}.`,
		);
	}
	const categoryFormula = String(values[categoryRow - 1]?.[MONTH_COLS.categoryFormula] ?? "");
```

```ts
	const rowCells =
		p.currency === "USD"
			? [cellData(p.item), cellData(p.amount), cellData(`=${USD_COL}${targetRow}*GOOGLEFINANCE("CURRENCY:USDTWD")`)]
			: [cellData(p.item), cellData(null), cellData(p.amount)];
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: targetRow - 1, columnIndex: MONTH_COLS.item },
			rows: [{ values: rowCells }],
			fields: "userEnteredValue",
		},
	});
```

```ts
	const baseFormula = inserted ? adjustColumnRefsForInsert(categoryFormula, TWD_COL, targetRow) : categoryFormula;
	const categoryRowFinal = inserted && categoryRow >= targetRow ? categoryRow + 1 : categoryRow;
	const newCategoryFormula = spliceIntoSum(baseFormula, `${TWD_COL}${targetRow}`);
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: categoryRowFinal - 1, columnIndex: MONTH_COLS.categoryFormula },
			rows: [{ values: [cellData(newCategoryFormula)] }],
			fields: "userEnteredValue",
		},
	});
```

In `monthSummary`, replace the lookup helpers and return:

```ts
	const rowByItem = (label: string) => findRowByValue(values, MONTH_COLS.item, label);

	const categories: Record<string, number | null> = {};
	for (const [key, label] of Object.entries(CATEGORIES)) {
		categories[key] = cellAt(findRowByValue(values, MONTH_COLS.categoryLabel, label), MONTH_COLS.categoryFormula);
	}

	return {
		tab,
		花費總額: cellAt(findRowByValue(values, MONTH_COLS.totalLabel, TOTAL_ROW_LABEL), MONTH_COLS.totalValue),
		上月透支: cellAt(rowByItem(OVERDRAFT_LABEL), MONTH_COLS.twd),
		categories,
		薪水: cellAt(rowByItem(SALARY_LABEL), MONTH_COLS.budgetValue),
		沛還: cellAt(rowByItem(REPAYMENT_LABEL), MONTH_COLS.budgetValue),
		剩餘: cellAt(rowByItem(REMAINDER_LABEL), MONTH_COLS.budgetValue),
		美金支付: cellAt(rowByItem(USD_PAYMENT_LABEL), MONTH_COLS.budgetValue),
	};
```

(The old `rowByA` helper is deleted.)

In `startMonth`:
- `const totalRow = findRowByValue(values, MONTH_COLS.totalLabel, TOTAL_ROW_LABEL);`
- Overdraft block: `findRowByValue(values, MONTH_COLS.item, OVERDRAFT_LABEL)`; formula read from `values[overdraftRow - 1]?.[MONTH_COLS.twd]`; write `start: { sheetId, rowIndex: overdraftRow - 1, columnIndex: MONTH_COLS.twd }`.
- Kept/cleared scan: `const item = String(values[r - 1]?.[MONTH_COLS.item] ?? "").trim();`
- #REF scrub: `findRowByValue(afterValues, MONTH_COLS.categoryLabel, label)`; formula from `[MONTH_COLS.categoryFormula]`; write `columnIndex: MONTH_COLS.categoryFormula`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test && bun run type-check`
Expected: full suite PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "refactor: remap monthly-tab ops to the date-column layout via MONTH_COLS

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Optional date on add_expense

**Files:**
- Modify: `src/finance-ops.ts` (AddExpenseParams + addExpense), `src/tools.ts` (add_expense schema)
- Test: `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: `parseDateInput` from Task 1, `MONTH_COLS` from Task 1/2.
- Produces: `AddExpenseParams.date?: string`; addExpense return gains `date: string | null`. Request order when a date is given: [insertDimension?], expense-row updateCells, date updateCells, category updateCells.

- [ ] **Step 1: Write the failing tests**

Add to the `addExpense` describe block:

```ts
	it("writes the date as a real date serial with mm/dd format when given", async () => {
		const client = fakeClient(monthGrid());

		const result = await addExpense(client, { item: "晚餐", amount: 250, currency: "TWD", month: 9, date: "2026/09/02" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toHaveLength(3);
		expect(requests[1]).toEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 8, columnIndex: 0 },
				rows: [
					{
						values: [
							{
								userEnteredValue: { numberValue: 46267 },
								userEnteredFormat: { numberFormat: { type: "DATE", pattern: "mm/dd" } },
							},
						],
					},
				],
				fields: "userEnteredValue,userEnteredFormat.numberFormat",
			},
		});
		expect(result).toMatchObject({ row: 9, date: "2026/09/02" });
	});

	it("leaves the date cell untouched when date is omitted", async () => {
		const client = fakeClient(monthGrid());

		const result = await addExpense(client, { item: "晚餐", amount: 250, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toHaveLength(2);
		expect(requests.every((r: any) => r.updateCells.start.columnIndex !== 0)).toBe(true);
		expect(result).toMatchObject({ date: null });
	});

	it("rejects an invalid date before reading or writing anything", async () => {
		const client = fakeClient(monthGrid());
		await expect(
			addExpense(client, { item: "x", amount: 1, currency: "TWD", month: 9, date: "not-a-date" }),
		).rejects.toThrow("Unrecognized date");
		expect((client.readRange as any).mock.calls.length).toBe(0);
		expect((client.batchUpdate as any).mock.calls.length).toBe(0);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/finance-ops.test.ts`
Expected: FAIL — `date` not accepted / no date request emitted (first test), `date: null` missing from the result (second test), no early throw (third test).

- [ ] **Step 3: Implement**

In `src/finance-ops.ts`, add `parseDateInput` to the `./conventions` import. Extend the interface:

```ts
export interface AddExpenseParams {
	item: string;
	amount: number;
	currency: "TWD" | "USD";
	category?: string;
	month?: number;
	/** M/D, MM/DD, YYYY/M/D, or YYYY-MM-DD; omitted = leave the 日期 cell blank. */
	date?: string;
}
```

In `addExpense`, immediately after the category validation (before the readRange call):

```ts
	// Parse before any read/write so a bad date fails closed.
	const dateSerialValue = p.date !== undefined ? parseDateInput(p.date) : null;
```

After the expense-row `requests.push(...)` and before the category-formula block:

```ts
	if (dateSerialValue !== null) {
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: targetRow - 1, columnIndex: MONTH_COLS.date },
				rows: [
					{
						values: [
							{
								userEnteredValue: { numberValue: dateSerialValue },
								userEnteredFormat: { numberFormat: { type: "DATE", pattern: "mm/dd" } },
							},
						],
					},
				],
				fields: "userEnteredValue,userEnteredFormat.numberFormat",
			},
		});
	}
```

Add `date: p.date ?? null,` to the returned object.

In `src/tools.ts`, add to the `add_expense` schema after `currency`:

```ts
			date: z
				.string()
				.min(1)
				.optional()
				.describe(
					"Expense date: M/D, MM/DD, or YYYY-MM-DD (year defaults to the current Taipei year). Omit to leave the 日期 cell blank, like recurring rows.",
				),
```

(The handler already passes `p` through unchanged, so no handler edit is needed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test && bun run type-check`
Expected: full suite PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts src/tools.ts test/finance-ops.test.ts
git commit -m "feat: optional date on add_expense, written as a real mm/dd date

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: start_month clears the date column

**Files:**
- Modify: `src/finance-ops.ts` (startMonth)
- Test: `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: `MONTH_COLS.date`. New request order in startMonth's main batch: title, overdraft rewire, date-column repeatCell clear, row deletions (bottom-up).

- [ ] **Step 1: Update the failing tests**

In the `startMonth` suite's "duplicates the previous month…" test, insert between the `requests[1]` (overdraft) assertion and the delete assertion — and renumber the delete to `requests[3]`:

```ts
			// fixture totalRow is 11 → the clear covers rows 3-10 (0-indexed 2..10 exclusive)
			expect(requests[2]).toEqual({
				repeatCell: {
					range: { sheetId: 555, startRowIndex: 2, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 1 },
					cell: {},
					fields: "userEnteredValue",
				},
			});
			expect(requests[3]).toEqual({
				deleteDimension: { range: { sheetId: 555, dimension: "ROWS", startIndex: 7, endIndex: 8 } },
			});
```

(The "deletes multiple one-off rows bottom-up" test filters on `deleteDimension`, so it needs no change; the "scrubs #REF!" test inspects `batch[2]` — the separate scrub batch — also unchanged.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/finance-ops.test.ts`
Expected: FAIL — `requests[2]` is the deleteDimension, not the repeatCell.

- [ ] **Step 3: Implement**

In `startMonth`, after the overdraft `if` block and before the kept/cleared scan:

```ts
	// The date column restarts each month — clear it across the expense window.
	if (totalRow > 3) {
		requests.push({
			repeatCell: {
				range: {
					sheetId,
					startRowIndex: 2,
					endRowIndex: totalRow - 1,
					startColumnIndex: MONTH_COLS.date,
					endColumnIndex: MONTH_COLS.date + 1,
				},
				cell: {},
				fields: "userEnteredValue",
			},
		});
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test && bun run type-check`
Expected: full suite PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: start_month clears the 日期 column across the expense window

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full verification

**Files:**
- No new changes expected — verification only.

- [ ] **Step 1: Run the full suite and typecheck**

Run: `bun run test && bun run type-check`
Expected: every test file PASS, tsc clean.

- [ ] **Step 2: Spot-check the conventions text**

Run: `bun run test -- test/conventions.test.ts`
Expected: PASS, including the `日期` / `新臺幣支付` needles.

- [ ] **Step 3: Confirm the working tree is clean**

Run: `git status --short`
Expected: empty output (all work committed on `feat/add-date-for-monthly-spending`).

Deployment (`bun run deploy`) is intentionally NOT part of this plan — the live worker serves the real sheet; Vincent decides when to ship.
