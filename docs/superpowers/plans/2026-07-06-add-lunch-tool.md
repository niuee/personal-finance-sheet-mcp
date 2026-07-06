# add_lunch (中餐預算) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `add_lunch` MCP tool that logs lunches into the 中餐預算 section (columns O–Q) of a monthly tab, plus start_month clearing of that section, A–F-scoped one-off deletes in start_month, and lunch fields in month_summary.

**Architecture:** Mirrors the existing `add_transfer` pattern exactly: layout constants in `src/conventions.ts`, a label-anchored section finder + op in `src/finance-ops.ts`, a thin zod-validated tool registration in `src/tools.ts`, mocked-`SheetsClient` unit tests in `test/finance-ops.test.ts`. Spec: `docs/superpowers/specs/2026-07-06-add-lunch-tool-design.md` — read it first.

**Tech Stack:** TypeScript (Cloudflare Worker), zod v4, vitest, Google Sheets API batchUpdate requests. **Use bun**: `bun install`, `bunx vitest run …`, `bun run type-check`.

## Global Constraints

- Indent with TABS (match every existing file).
- Comments explain constraints the code can't show, in the same voice as neighboring comments — no "added for task N" narration.
- Column indexes are 0-based in code (O=14, P=15, Q=16); sheet rows are 1-indexed everywhere except Sheets API `rowIndex`/`startRowIndex` (0-indexed).
- Never widen `GRID_READ`/`TRANSFER_GRID_READ` themselves — add a new `LUNCH_GRID_READ = "A1:Q60"`.
- Every op fails closed: parse dates before any read/write; refuse truncated grid reads via `assertNotTruncated`.
- Commit after every task with the repo's conventional style (`feat: …`, `test: …`) and trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Sheet geometry (from the live 7月 tab — the fixtures must mirror it)

```
O34  中餐預算                                 ← anchor (column O)
O35  編列預算            Q35  剩餘 (負數會加回去支出）
O36  =E15 (budget)       Q36  =O36-Q40 (leftover)
O37  日期   P37 項目   Q37 金額                ← header
O38+ data rows (date serial mm/dd, item, NTD amount)
     P40  總和          Q40  =sum(Q38:Q39)
```

Bank block: `午餐超支或回補 = =Q36` sits between 新臺幣支出 and 上月新臺幣餘額; `總新臺幣餘額 = 預計總新臺幣餘額 + 午餐超支或回補`. The recurring 中餐 expense row IS the budget; lunches never go into the expense list.

---

### Task 1: Lunch constants + conventions text

**Files:**
- Modify: `src/conventions.ts` (after the `TRANSFER_COLS` block, ~line 155; and inside `CONVENTIONS_TEXT`)
- Test: `test/conventions.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `LUNCH_SECTION_LABEL: "中餐預算"`, `LUNCH_TOTAL_LABEL: "總和"`, `LUNCH_DEFAULT_ITEM: "中餐"`, `LUNCH_ADJUST_LABEL: "午餐超支或回補"`, `LUNCH_COLS: { date: 14, item: 15, amount: 16 }` — all exported from `src/conventions.ts`; Tasks 2–5 import them.

- [ ] **Step 1: Write the failing tests**

In `test/conventions.test.ts`, extend the existing import from `../src/conventions` with `LUNCH_SECTION_LABEL, LUNCH_TOTAL_LABEL, LUNCH_DEFAULT_ITEM, LUNCH_ADJUST_LABEL, LUNCH_COLS`, add a new `it` block after "exports the income-section labels", and add needles to the anchors test:

```ts
	it("exports the 中餐預算 lunch-section anchors", () => {
		expect(LUNCH_SECTION_LABEL).toBe("中餐預算");
		expect(LUNCH_TOTAL_LABEL).toBe("總和");
		expect(LUNCH_DEFAULT_ITEM).toBe("中餐");
		expect(LUNCH_ADJUST_LABEL).toBe("午餐超支或回補");
		expect(LUNCH_COLS).toEqual({ date: 14, item: 15, amount: 16 });
	});
```

In the `"conventions text mentions the anchors Claude needs"` needle array, append four entries: `"中餐預算"`, `"add_lunch"`, `"午餐超支或回補"`, `"編列預算"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/conventions.test.ts`
Expected: FAIL — `LUNCH_SECTION_LABEL` has no export; needle `"中餐預算"` not contained.

- [ ] **Step 3: Implement in `src/conventions.ts`**

After the `TRANSFER_COLS` const (before `dateSerial`), add:

```ts
/**
 * 中餐預算 — the lunch-budget log (columns O–Q), present on monthly tabs from
 * 7月 2026 (start_month copies it forward and clears its data rows). The
 * recurring 中餐 row in the expense list IS the month's lunch budget; actual
 * lunches are logged here, never in the expense list. Title in O; two rows
 * below it a values row (O=編列預算 pointing at the 中餐 expense cell,
 * Q=剩餘 = 編列預算 − 總和); then a 日期/項目/金額 header, data rows, and a
 * 總和 row (label in P, =SUM in Q). The 銀行餘額 block wires to the leftover:
 * 午餐超支或回補 = the 剩餘 cell, and 總新臺幣餘額 = 預計總新臺幣餘額 +
 * 午餐超支或回補 — unspent budget flows back to the bank, an overdraft
 * (negative 剩餘) deducts more.
 */
export const LUNCH_SECTION_LABEL = "中餐預算";
export const LUNCH_TOTAL_LABEL = "總和";
export const LUNCH_DEFAULT_ITEM = "中餐";
export const LUNCH_ADJUST_LABEL = "午餐超支或回補";

/** 0-indexed columns of the 中餐預算 section (O–Q). */
export const LUNCH_COLS = {
	/** O — 日期; also the column of the section title, the 編列預算 label, and the budget value. */
	date: 14,
	/** P — 項目; also the column of the 總和 label. */
	item: 15,
	/** Q — 金額; also the 剩餘 value and the 總和 =SUM cell. */
	amount: 16,
} as const;
```

In `CONVENTIONS_TEXT`, make three edits:

(a) After the 乾坤大挪移 bullet (the one ending `…never hand-extend the 總和 formulas.`), insert a new bullet:

```
- Also to the right, a 中餐預算 block (columns O-Q, from 7月 2026 on): the recurring 中餐 row in the expense list is the month's lunch BUDGET, and actual lunches are logged in this block instead of the expense list. Title in O; a 編列預算 / 剩餘 (負數會加回去支出) values row two rows below it (編列預算 points at the 中餐 expense cell; 剩餘 = 編列預算 − 總和); then a 日期 項目 金額 header, data rows, and a 總和 row (label in P, =SUM in Q). The leftover feeds the 銀行餘額 block's 午餐超支或回補 row: 總新臺幣餘額 = 預計總新臺幣餘額 + 午餐超支或回補 — unspent budget returns to the bank, an overdraft (negative 剩餘) deducts more. Log lunches with add_lunch; never hand-extend the 總和 formula and never add_expense a lunch.
```

(b) In the 銀行餘額 bullet, after the sentence `Each 總…餘額 = 上月…餘額 + 收入 − 支出 (surplus AND overdraft carry).`, insert:

```
From 7月 2026 the NTD ledger also carries 午餐超支或回補 (the 中餐預算 block's 剩餘) and a 預計總新臺幣餘額 row, with 總新臺幣餘額 = 預計總新臺幣餘額 + 午餐超支或回補.
```

(c) In the closing paragraph, change `Prefer the tailored tools (add_expense, set_income, add_transfer, month_summary, start_month, add_trip_entry)` to `Prefer the tailored tools (add_expense, set_income, add_transfer, add_lunch, month_summary, start_month, add_trip_entry)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/conventions.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts test/conventions.test.ts
git commit -m "feat: 中餐預算 lunch-section constants + conventions text"
```

---

### Task 2: findLunchSection + lunchGrid fixture

**Files:**
- Modify: `src/finance-ops.ts` (next to `findTransferSection`, after ~line 156)
- Test: `test/finance-ops.test.ts` (fixture after `transferGrid()` ~line 164; describe block after `findTransferSection`'s ~line 388)

**Interfaces:**
- Consumes: `LUNCH_SECTION_LABEL`, `LUNCH_TOTAL_LABEL`, `LUNCH_COLS` from Task 1; existing `findRowByValue`, `colLetter`.
- Produces: `export const LUNCH_GRID_READ = "A1:Q60"`; `export interface LunchSection { budgetRow: number; headerRow: number; totalRow: number }`; `export function findLunchSection(values: unknown[][], tab: string): LunchSection` (throws on missing/malformed). Test fixture `lunchGrid(): unknown[][]` — section anchor row 33, budgetRow 35, headerRow 36, one empty data slot row 37, totalRow 38. Tasks 3–5 use all of these.

- [ ] **Step 1: Add the fixture and failing tests**

In `test/finance-ops.test.ts`, extend the `../src/finance-ops` import list with `findLunchSection` and `LUNCH_GRID_READ` (alphabetical position). After `transferGrid()` add:

```ts
/** transferGrid + a 中餐預算 lunch block at O33:Q38 (data slot row 37 empty). */
function lunchGrid(): unknown[][] {
	const g = transferGrid();
	const put = (idx: number, col: number, v: unknown) => {
		(g[idx] ??= [])[col] = v;
	};
	put(32, 14, "中餐預算");
	put(33, 14, "編列預算");
	put(33, 16, "剩餘 (負數會加回去支出）");
	put(34, 14, "=E5"); // 編列預算 ← the 中餐 expense cell
	put(34, 16, "=O35-Q38"); // 剩餘 = 編列預算 − 總和
	put(35, 14, "日期");
	put(35, 15, "項目");
	put(35, 16, "金額");
	// row 37 (index 36) empty — the first data slot
	put(37, 15, "總和");
	put(37, 16, "=sum(Q37)");
	return g;
}
```

(The lunch cells share sheet rows with the transfer block's G–M cells — deliberately, like the live tab. `transferGrid()`-based tests are unaffected because they never look at columns ≥ N.)

After the `findTransferSection` describe block add:

```ts
describe("findLunchSection", () => {
	it("locates the budget, header and 總和 rows from the anchor", () => {
		expect(findLunchSection(lunchGrid(), "9 月")).toEqual({ budgetRow: 35, headerRow: 36, totalRow: 38 });
	});

	it("throws when the tab has no 中餐預算 section", () => {
		expect(() => findLunchSection(transferGrid(), "6 月")).toThrow("中餐預算");
	});

	it("throws when the header row under the anchor is missing", () => {
		const g = lunchGrid();
		(g[35] as unknown[])[14] = "";
		expect(() => findLunchSection(g, "9 月")).toThrow("日期");
	});

	it("throws when there is no 總和 row", () => {
		const g = lunchGrid();
		(g[37] as unknown[])[15] = "";
		expect(() => findLunchSection(g, "9 月")).toThrow("總和");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: FAIL — `findLunchSection` is not exported.

- [ ] **Step 3: Implement in `src/finance-ops.ts`**

Extend the `./conventions` import with `LUNCH_COLS, LUNCH_SECTION_LABEL, LUNCH_TOTAL_LABEL` (Task 3 adds `LUNCH_DEFAULT_ITEM`, Task 5 adds `LUNCH_ADJUST_LABEL`). Directly after `findTransferSection`:

```ts
/** The 中餐預算 section spans O–Q — read past the transfer block's M. */
export const LUNCH_GRID_READ = "A1:Q60";

export interface LunchSection {
	/** 1-indexed row holding the 編列預算 / 剩餘 values. */
	budgetRow: number;
	/** 1-indexed row of the 日期/項目/金額 header. */
	headerRow: number;
	/** 1-indexed row of the 總和 total. */
	totalRow: number;
}

/** Locate the 中餐預算 block (grid of LUNCH_GRID_READ; labels match in any render). Throws when absent or malformed. */
export function findLunchSection(values: unknown[][], tab: string): LunchSection {
	const dateCol = LUNCH_COLS.date;
	const anchorRow = findRowByValue(values, dateCol, LUNCH_SECTION_LABEL);
	if (anchorRow === null) {
		throw new Error(
			`No ${LUNCH_SECTION_LABEL} section in ${tab} (searched column ${colLetter(dateCol)} of ${LUNCH_GRID_READ}) — the lunch-budget log exists from 7月 2026 on.`,
		);
	}
	const budgetRow = anchorRow + 2;
	const headerRow = anchorRow + 3;
	if (String(values[headerRow - 1]?.[dateCol] ?? "").trim() !== "日期") {
		throw new Error(
			`Row ${headerRow} under the ${LUNCH_SECTION_LABEL} anchor in ${tab} is not the 日期/項目/金額 header row.`,
		);
	}
	for (let r = headerRow + 1; r <= values.length; r++) {
		if (String(values[r - 1]?.[LUNCH_COLS.item] ?? "").trim() === LUNCH_TOTAL_LABEL) {
			return { budgetRow, headerRow, totalRow: r };
		}
	}
	throw new Error(`No ${LUNCH_TOTAL_LABEL} row under the ${LUNCH_SECTION_LABEL} header in ${tab}.`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: PASS (all — including the untouched transfer tests).

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: locate the 中餐預算 lunch section on a monthly grid"
```

---

### Task 3: addLunch op + add_lunch tool registration

**Files:**
- Modify: `src/finance-ops.ts` (after `addTransfer`, ~line 735)
- Modify: `src/tools.ts` (import `addLunch`; register after the `add_transfer` tool, ~line 269)
- Test: `test/finance-ops.test.ts` (after the `addTransfer` describe block, ~line 522)

**Interfaces:**
- Consumes: `findLunchSection`, `LUNCH_GRID_READ`, `lunchGrid()` from Task 2; `LUNCH_COLS`, `LUNCH_DEFAULT_ITEM`, `parseDateInput`, `todaySerial`, `serialToIso`, `monthTabName`, `currentMonthTab` from conventions; existing helpers `quoteTab`, `assertNotTruncated`, `cellData`, `colLetter`, `round2`.
- Produces: `export interface AddLunchParams { amount: number; item?: string; date?: string; month?: number }`; `export async function addLunch(client: SheetsClient, p: AddLunchParams)` returning `{ tab: string; row: number; inserted: boolean; date: string; item: string; amount: number; budget: number | null; spent: number | null; leftover: number | null }`. MCP tool `add_lunch`.

- [ ] **Step 1: Write the failing tests**

Extend the test file's `../src/finance-ops` import with `addLunch`. After the `addTransfer` describe block add:

```ts
/** Like fakeClient, but the post-write 編列預算/剩餘 read-back returns `budgetRow`. */
function lunchClient(grid: unknown[][], budgetRow: unknown[] = [3900, "", 3547]): SheetsClient {
	return {
		readRange: vi.fn(async (range: string) =>
			range.includes("A1:Q60")
				? { range, values: grid, truncated: false }
				: { range, values: [budgetRow], truncated: false },
		),
		getSheetId: vi.fn(async () => 111),
		batchUpdate: vi.fn(async () => ({ replies: [{}] })),
	} as unknown as SheetsClient;
}

describe("addLunch", () => {
	it("writes into the first empty row and rewrites 總和 over the data window", async () => {
		const client = lunchClient(lunchGrid());
		const result = await addLunch(client, { amount: 143, month: 9, date: "9/2" });

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:Q60", "FORMULA"]);
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toHaveLength(3); // date cell, item+amount, 總和 rewrite — no insert needed
		const dateCell = requests[0].updateCells;
		expect(dateCell.start).toEqual({ sheetId: 111, rowIndex: 36, columnIndex: 14 });
		expect(dateCell.rows[0].values[0].userEnteredFormat).toEqual({
			numberFormat: { type: "DATE", pattern: "mm/dd" },
		});
		const rowCells = requests[1].updateCells;
		expect(rowCells.start).toEqual({ sheetId: 111, rowIndex: 36, columnIndex: 15 });
		expect(rowCells.rows[0].values.map((v: any) => v.userEnteredValue)).toEqual([
			{ stringValue: "中餐" }, // P 項目 defaults
			{ numberValue: 143 }, // Q 金額
		]);
		const sum = requests[2].updateCells;
		expect(sum.start).toEqual({ sheetId: 111, rowIndex: 37, columnIndex: 16 });
		expect(sum.rows[0].values[0].userEnteredValue).toEqual({ formulaValue: "=SUM(Q37:Q37)" });

		// the 編列預算/剩餘 row is read back AFTER the write so the echo includes this entry
		expect((client.readRange as any).mock.calls[1]).toEqual(["'9 月'!O35:Q35", "UNFORMATTED_VALUE"]);
		expect(result).toEqual({
			tab: "9 月",
			row: 37,
			inserted: false,
			date: "2026-09-02",
			item: "中餐",
			amount: 143,
			budget: 3900,
			spent: 353, // 編列預算 − 剩餘
			leftover: 3547,
		});
	});

	it("inserts a row above 總和 when the section is full and widens the sum", async () => {
		const g = lunchGrid();
		(g[36] ??= [])[14] = 46266;
		(g[36] as unknown[])[15] = "中餐";
		(g[36] as unknown[])[16] = 143;
		const client = lunchClient(g);
		const result = await addLunch(client, { amount: 210, month: 9, date: "9/9" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].insertDimension).toEqual({
			range: { sheetId: 111, dimension: "ROWS", startIndex: 37, endIndex: 38 },
			inheritFromBefore: true,
		});
		expect(requests[1].updateCells.start).toEqual({ sheetId: 111, rowIndex: 37, columnIndex: 14 });
		expect(requests[3].updateCells.start).toEqual({ sheetId: 111, rowIndex: 38, columnIndex: 16 });
		expect(requests[3].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			formulaValue: "=SUM(Q37:Q38)",
		});
		expect(result).toMatchObject({ row: 38, inserted: true });
	});

	it("accepts a custom 項目 and defaults 日期 to today in Taipei", async () => {
		const client = lunchClient(lunchGrid());
		await addLunch(client, { amount: 95, item: "午餐咖啡", month: 9 });
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			numberValue: todaySerial(),
		});
		expect(requests[1].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			stringValue: "午餐咖啡",
		});
	});

	it("refuses when the tab has no 中餐預算 section", async () => {
		const client = lunchClient(transferGrid());
		await expect(addLunch(client, { amount: 100, month: 6 })).rejects.toThrow("中餐預算");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("rejects a bad date before any read or write", async () => {
		const client = lunchClient(lunchGrid());
		await expect(addLunch(client, { amount: 100, month: 9, date: "not-a-date" })).rejects.toThrow(
			"Unrecognized date",
		);
		expect((client.readRange as any).mock.calls).toHaveLength(0);
	});

	it("refuses when the grid read is truncated", async () => {
		const client = lunchClient(lunchGrid());
		(client.readRange as any).mockResolvedValue({ range: "x", values: lunchGrid(), truncated: true });
		await expect(addLunch(client, { amount: 100, month: 9 })).rejects.toThrow("truncated");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: FAIL — `addLunch` is not exported.

- [ ] **Step 3: Implement `addLunch` in `src/finance-ops.ts`**

After `addTransfer` (and its closing brace, before `monthSummary`):

```ts
export interface AddLunchParams {
	/** 金額 in NTD. */
	amount: number;
	/** 項目; defaults to 中餐. */
	item?: string;
	/** M/D, MM/DD, YYYY/M/D, or YYYY-MM-DD; omitted = today in Taipei. */
	date?: string;
	month?: number;
}

export async function addLunch(client: SheetsClient, p: AddLunchParams) {
	const tab = p.month !== undefined ? monthTabName(p.month) : currentMonthTab();
	// Parse before any read/write so a bad date fails closed.
	const dateSerialValue = p.date !== undefined ? parseDateInput(p.date) : todaySerial();
	const item = (p.item ?? LUNCH_DEFAULT_ITEM).trim() || LUNCH_DEFAULT_ITEM;

	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${LUNCH_GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, tab, LUNCH_GRID_READ);
	const { budgetRow, headerRow, totalRow } = findLunchSection(values, tab);

	// First row between the header and 總和 that is empty across O–Q.
	let targetRow: number | null = null;
	for (let r = headerRow + 1; r < totalRow; r++) {
		const cells = (values[r - 1] ?? []).slice(LUNCH_COLS.date, LUNCH_COLS.amount + 1);
		if (!cells.some((c) => c !== "" && c != null)) {
			targetRow = r;
			break;
		}
	}

	const sheetId = await client.getSheetId(tab);
	const inserted = targetRow === null;
	let finalTotalRow = totalRow;
	const requests: object[] = [];
	if (targetRow === null) {
		// Insert directly above 總和; the ledger's 午餐超支或回補 =Q reference
		// tracks the 剩餘 cell (above the insert) and needs no rewiring.
		targetRow = totalRow;
		finalTotalRow = totalRow + 1;
		requests.push({
			insertDimension: {
				range: { sheetId, dimension: "ROWS", startIndex: targetRow - 1, endIndex: targetRow },
				inheritFromBefore: true,
			},
		});
	}
	const Q = colLetter(LUNCH_COLS.amount);
	requests.push(
		{
			updateCells: {
				start: { sheetId, rowIndex: targetRow - 1, columnIndex: LUNCH_COLS.date },
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
		},
		{
			updateCells: {
				start: { sheetId, rowIndex: targetRow - 1, columnIndex: LUNCH_COLS.item },
				rows: [{ values: [cellData(item), cellData(p.amount)] }],
				fields: "userEnteredValue",
			},
		},
		// Rewrite 總和 over the whole data window: the sheet's original
		// =sum(Q38:Q39) cannot auto-extend, so the op owns the range from now on.
		{
			updateCells: {
				start: { sheetId, rowIndex: finalTotalRow - 1, columnIndex: LUNCH_COLS.amount },
				rows: [{ values: [cellData(`=SUM(${Q}${headerRow + 1}:${Q}${finalTotalRow - 1})`)] }],
				fields: "userEnteredValue",
			},
		},
	);
	await client.batchUpdate(requests);

	// Echo the section state AFTER the write so the caller sees the new leftover.
	const O = colLetter(LUNCH_COLS.date);
	const readBack = await client.readRange(`${quoteTab(tab)}!${O}${budgetRow}:${Q}${budgetRow}`, "UNFORMATTED_VALUE");
	const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
	const budget = num(readBack.values[0]?.[0]);
	const leftover = num(readBack.values[0]?.[2]);
	return {
		tab,
		row: targetRow,
		inserted,
		date: serialToIso(dateSerialValue),
		item,
		amount: p.amount,
		budget,
		spent: budget !== null && leftover !== null ? round2(budget - leftover) : null,
		leftover,
	};
}
```

(`budgetRow` sits above the header, so a full-section insert above 總和 never shifts it — the read-back address stays valid.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Register the tool in `src/tools.ts`**

Add `addLunch` to the `./finance-ops` import list (alphabetical: after `addExpense`). In `registerTailoredTools`, directly after the `add_transfer` registration:

```ts
	server.tool(
		"add_lunch",
		"Log a lunch into the 中餐預算 section of a monthly tab (columns O-Q; defaults to the current month): writes 日期/項目/金額 and keeps the section's 總和 covering every row. The month's lunch BUDGET is the recurring 中餐 row in the expense list — never also add_expense a lunch. The leftover (剩餘 = 編列預算 − 總和) feeds the 銀行餘額 block's 午餐超支或回補 row: unspent budget returns to 總新臺幣餘額, an overdraft deducts more. Returns budget/spent/leftover after the entry.",
		{
			amount: z.number().positive().describe("金額 in NTD"),
			item: z.string().min(1).optional().describe("項目 (default: 中餐)"),
			date: z
				.string()
				.min(1)
				.optional()
				.describe("Lunch date: M/D, MM/DD, or YYYY-MM-DD (defaults to today in Taipei)"),
			month: monthParam.optional().describe("Target month 1-12 (default: current month)"),
		},
		async (p) => {
			try {
				return ok(await addLunch(client, p));
			} catch (e) {
				return toError(e);
			}
		},
	);
```

- [ ] **Step 6: Type-check and full test run**

Run: `bun run type-check && bunx vitest run`
Expected: no type errors; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/finance-ops.ts src/tools.ts test/finance-ops.test.ts
git commit -m "feat: add_lunch MCP tool — 中餐預算 entry with 總和 rewrite"
```

---

### Task 4: start_month — clear the lunch log, scope one-off deletes to A–F

**Files:**
- Modify: `src/finance-ops.ts` (`startMonth`, ~lines 834–968)
- Test: `test/finance-ops.test.ts` (`startMonth` describe block, ~lines 851–1004)

**Interfaces:**
- Consumes: `findLunchSection`, `LUNCH_GRID_READ`, `lunchGrid()`; `LUNCH_COLS`, `LUNCH_SECTION_LABEL` from conventions; `MONTH_COLS.paidWith`.
- Produces: `startMonth` result gains `lunchCleared: boolean`; one-off deletes become `deleteRange` requests scoped to columns A–F. No signature changes.

- [ ] **Step 1: Update the existing tests and add the new one (failing)**

In the `startMonth` describe block:

(a) Test `"duplicates the previous month…"`: replace the `requests[5]` expectation with

```ts
		// Scoped to A–F: the 乾坤大挪移 / 中餐預算 sections share these sheet rows.
		expect(requests[5]).toEqual({
			deleteRange: {
				range: { sheetId: 555, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 0, endColumnIndex: 6 },
				shiftDimension: "ROWS",
			},
		});
```

and in its final `expect(result).toEqual({...})` add `lunchCleared: false,` after `clearedIncomes: [],`.

(b) Test `"deletes multiple one-off rows bottom-up"`: replace the two `deletes` lines with

```ts
		const deletes = requests.filter((r: any) => r.deleteRange);
		expect(deletes.map((r: any) => r.deleteRange.range.startRowIndex)).toEqual([9, 8, 7]);
```

(c) Test `"clears ad-hoc income rows…"`: replace the `deletes` expectation with

```ts
		const deletes = requests.filter((r: any) => r.deleteRange);
		expect(deletes).toEqual([
			{
				deleteRange: {
					range: { sheetId: 555, startRowIndex: 15, endRowIndex: 16, startColumnIndex: 0, endColumnIndex: 6 },
					shiftDimension: "ROWS",
				},
			},
		]);
```

(d) New test at the end of the describe block:

```ts
	it("clears the 中餐預算 data rows so the new month starts empty", async () => {
		const client = startMonthClient(lunchGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		expect((client.readRange as any).mock.calls[0]).toEqual(["'10 月'!A1:Q60", "FORMULA"]);
		const requests = (client.batchUpdate as any).mock.calls[1][0];
		// data rows 37..37 (0-indexed 36..37), columns O–Q (14..17) — cells cleared, nothing shifts
		const clear = requests.find((r: any) => r.repeatCell && r.repeatCell.range.startColumnIndex === 14);
		expect(clear).toEqual({
			repeatCell: {
				range: { sheetId: 555, startRowIndex: 36, endRowIndex: 37, startColumnIndex: 14, endColumnIndex: 17 },
				cell: {},
				fields: "userEnteredValue",
			},
		});
		expect(result.lunchCleared).toBe(true);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: FAIL — the three edited tests (still `deleteDimension`, no `lunchCleared` key) and the new test (read is `A1:H60`, no repeatCell at column 14).

- [ ] **Step 3: Implement in `startMonth`**

(a) Widen the grid read (both lines):

```ts
	const { values, truncated } = await client.readRange(`${quoteTab(newTab)}!${LUNCH_GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, newTab, LUNCH_GRID_READ);
```

(b) After the 銀行餘額 carry-over `for` loop (before the `kept`/`cleared` declarations), add:

```ts
	// The lunch log restarts each month: clear the 中餐預算 data rows (O–Q).
	// Cells are cleared, not deleted, so nothing shifts; the 總和 =SUM over the
	// empty window reads 0 and 剩餘 resets to the full budget. The anchor probe
	// keeps pre-section tabs silent while a malformed section still fails loudly.
	let lunchCleared = false;
	if (findRowByValue(values, LUNCH_COLS.date, LUNCH_SECTION_LABEL) !== null) {
		const lunch = findLunchSection(values, newTab);
		if (lunch.totalRow > lunch.headerRow + 1) {
			requests.push({
				repeatCell: {
					range: {
						sheetId,
						startRowIndex: lunch.headerRow,
						endRowIndex: lunch.totalRow - 1,
						startColumnIndex: LUNCH_COLS.date,
						endColumnIndex: LUNCH_COLS.amount + 1,
					},
					cell: {},
					fields: "userEnteredValue",
				},
			});
			lunchCleared = true;
		}
	}
```

(c) Replace the delete loop's request body:

```ts
	// Bottom-up so earlier deletions don't shift later indices. Scoped to A–F:
	// a whole-row delete would rip through the 乾坤大挪移 / 中餐預算 sections
	// (G–Q) that share these sheet rows; references across the column boundary
	// adjust on their own in both directions.
	for (const r of [...rowsToDelete].sort((a, b) => b - a)) {
		requests.push({
			deleteRange: {
				range: {
					sheetId,
					startRowIndex: r - 1,
					endRowIndex: r,
					startColumnIndex: 0,
					endColumnIndex: MONTH_COLS.paidWith + 1,
				},
				shiftDimension: "ROWS",
			},
		});
	}
```

(d) Extend the return:

```ts
	return { tab: newTab, duplicatedFrom: prevTab, kept, cleared, clearedIncomes, lunchCleared };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Update the start_month tool description in `src/tools.ts`**

Change the `start_month` description string to:

```
"Open a new month: duplicates the previous month's tab (keeping all formulas and recurring items like subscriptions), rewires 上月透支 to the month just ended, clears one-off expenses, and empties the 中餐預算 lunch log so the budget's 剩餘 resets. Refuses if the tab already exists."
```

- [ ] **Step 6: Type-check and full test run, then commit**

Run: `bun run type-check && bunx vitest run`
Expected: clean.

```bash
git add src/finance-ops.ts src/tools.ts test/finance-ops.test.ts
git commit -m "feat: start_month clears the 中餐預算 log; one-off deletes scoped to A-F"
```

---

### Task 5: month_summary lunch fields

**Files:**
- Modify: `src/finance-ops.ts` (`monthSummary`, ~lines 737–799)
- Modify: `src/tools.ts` (`month_summary` description, ~line 189)
- Test: `test/finance-ops.test.ts` (`monthSummary` describe block, ~lines 746–849)

**Interfaces:**
- Consumes: `findLunchSection`, `LUNCH_GRID_READ`, `lunchGrid()`; `LUNCH_COLS`, `LUNCH_SECTION_LABEL`, `LUNCH_ADJUST_LABEL` from conventions.
- Produces: `monthSummary` result gains `中餐預算: { 編列預算: number | null; 總和: number | null; 剩餘: number | null } | null` and `午餐超支或回補: number | null`.

- [ ] **Step 1: Update the existing tests and add the new one (failing)**

(a) In `"returns unformatted numbers keyed to the sheet's own labels"`: change the read assertion to `["'9 月'!A1:Q60", "UNFORMATTED_VALUE"]`, and add to the expected object (after `上月透支`): `中餐預算: null,` and `午餐超支或回補: null,`.

(b) In `"reports the migrated layout…"`: add the same two null fields to its expected object.

(c) New test at the end of the describe block:

```ts
	it("reports the 中餐預算 section and 午餐超支或回補", async () => {
		const grid = lunchGrid();
		// UNFORMATTED render: formulas come back as computed numbers
		(grid[34] as unknown[])[14] = 3900; // 編列預算
		(grid[34] as unknown[])[16] = 3547; // 剩餘
		(grid[36] ??= [])[14] = 46204;
		(grid[36] as unknown[])[15] = "中餐";
		(grid[36] as unknown[])[16] = 353;
		(grid[37] as unknown[])[16] = 353; // 總和
		grid[31] = ["", "午餐超支或回補", "", 3547];
		const client = fakeClient(grid);

		const result = await monthSummary(client, 9);

		expect(result.中餐預算).toEqual({ 編列預算: 3900, 總和: 353, 剩餘: 3547 });
		expect(result.午餐超支或回補).toBe(3547);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: FAIL — read range still `A1:H60`; `中餐預算` key missing.

- [ ] **Step 3: Implement in `monthSummary`**

(a) Widen the read:

```ts
	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${LUNCH_GRID_READ}`, "UNFORMATTED_VALUE");
	assertNotTruncated(truncated, tab, LUNCH_GRID_READ);
```

(b) After the incomes block (before the `return`), add:

```ts
	// 中餐預算 lunch-budget section (O–Q); null on tabs that predate it.
	let lunch: { 編列預算: number | null; 總和: number | null; 剩餘: number | null } | null = null;
	if (findRowByValue(values, LUNCH_COLS.date, LUNCH_SECTION_LABEL) !== null) {
		const sec = findLunchSection(values, tab);
		lunch = {
			編列預算: num(values[sec.budgetRow - 1]?.[LUNCH_COLS.date]),
			總和: num(values[sec.totalRow - 1]?.[LUNCH_COLS.amount]),
			剩餘: num(values[sec.budgetRow - 1]?.[LUNCH_COLS.amount]),
		};
	}
```

(c) In the returned object, after `上月透支`, add:

```ts
		中餐預算: lunch,
		午餐超支或回補: cellAt(rowByItem(LUNCH_ADJUST_LABEL), MONTH_COLS.budgetValue),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Update the month_summary tool description in `src/tools.ts`**

In the `month_summary` description string, after `per-類別 tag totals,` insert `the 中餐預算 lunch block (編列預算/總和/剩餘) and 午餐超支或回補,` so the field is discoverable.

- [ ] **Step 6: Full verification and commit**

Run: `bun run type-check && bunx vitest run`
Expected: clean — every suite PASS.

```bash
git add src/finance-ops.ts src/tools.ts test/finance-ops.test.ts
git commit -m "feat: month_summary reports 中餐預算 and 午餐超支或回補"
```

---

## Post-implementation (not part of the tasks)

- Deploy is a separate, user-approved step: `bun run deploy` (Cloudflare Worker at sheets-mcp.niuee.workers.dev). The add_transfer PR (#11) is also awaiting prod deploy — one deploy ships both.
- Live smoke test after deploy: `add_lunch` with a real lunch on the dev copy sheet, then verify 剩餘 and 總新臺幣餘額 moved as expected.
