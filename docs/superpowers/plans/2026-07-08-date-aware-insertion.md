# Date-Aware Expense Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `add_expense` and `set_expense_date` keep the monthly expense list date-sorted (spec: `docs/superpowers/specs/2026-07-08-date-aware-insertion-design.md`).

**Architecture:** One pure position function (`expensePositionFor`) computes the 1-indexed row an expense should occupy. `addExpense` uses it to pick its write/insert position (with a special insert+`moveDimension` dance when the row belongs past the window's last row, where a plain insert would fall outside every range). `setExpenseDate` uses it (masking the row being moved) to append a `moveDimension` relocation to its batch.

**Tech Stack:** TypeScript on Cloudflare Workers, vitest, Google Sheets API `batchUpdate` requests. Use `bun`/`bunx`, never npm.

## Global Constraints

- Branch: `feat/date-aware-insertion` (already created; work directly on it).
- Ordering convention (spec §Ordering): dated rows ascend by 日期; ties append AFTER existing same-date rows; dateless rows sort last; nothing ever lands above the 上月透支 carry rows.
- Every structural insert must stay strictly inside the 花費總額 SUM window so all dependent ranges auto-extend. Never rewrite the SUM/SUMIF formulas.
- Google Sheets `moveDimension.destinationIndex` is zero-based and expressed in PRE-removal coordinates: a row moved DOWN ends up at 1-based row `destinationIndex` (its old slot closes beneath it); a row moved UP ends up at `destinationIndex + 1`.
- Tests: `bunx vitest run test/finance-ops.test.ts`. Typecheck: `bun run type-check`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `expensePositionFor` position function

**Files:**
- Modify: `src/finance-ops.ts` (insert directly after `findExpenseWindow`, which ends near line 157)
- Test: `test/finance-ops.test.ts` (new `describe` after the `window helpers` block, ~line 242)

**Interfaces:**
- Consumes: `MONTH_COLS`, `PREV_USD_OVERDRAFT_LABEL`, `PREV_NTD_OVERDRAFT_LABEL`, `OVERDRAFT_LABEL` — all already imported in `finance-ops.ts`.
- Produces: `export function expensePositionFor(values: unknown[][], windowStart: number, windowEnd: number, totalRow: number, serial: number | null, ignoreRow?: number): number` — Tasks 2 and 3 call exactly this signature.

- [ ] **Step 1: Write the failing tests**

Add to `test/finance-ops.test.ts` (import `expensePositionFor` in the existing import block from `../src/finance-ops`):

```ts
describe("expensePositionFor", () => {
	/** Window rows 3-10, 花費總額 at 11; carries dated 100, then 101 / 103 / dateless Netflix, empties 8-10. */
	function orderedGrid(): unknown[][] {
		const g: unknown[][] = [];
		g[2] = [100, "上月美金透支", "透支", 5, "", "USD"];
		g[3] = [100, "上月新臺幣透支", "透支", "", 5, "TWD"];
		g[4] = [101, "早餐", "吃喝", "", 80, "TWD"];
		g[5] = [103, "晚餐", "吃喝", "", 250, "TWD"];
		g[6] = ["", "Netflix", "訂閱", 26.99, "=D7*X", "USD"];
		g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)"];
		return g;
	}

	it("places a dated row after the last not-later date, ties after", () => {
		expect(expensePositionFor(orderedGrid(), 3, 10, 11, 102)).toBe(6); // between 早餐(101) and 晚餐(103)
		expect(expensePositionFor(orderedGrid(), 3, 10, 11, 101)).toBe(6); // tie with 早餐 → after it
		expect(expensePositionFor(orderedGrid(), 3, 10, 11, 104)).toBe(7); // after 晚餐, before dateless Netflix
	});

	it("places a dateless row after every non-empty row", () => {
		expect(expensePositionFor(orderedGrid(), 3, 10, 11, null)).toBe(8);
	});

	it("clamps a backdated row below the carry rows", () => {
		expect(expensePositionFor(orderedGrid(), 3, 10, 11, 99)).toBe(5);
	});

	it("masks ignoreRow when repositioning an existing row", () => {
		// 晚餐 (row 6) redated between the carries and 早餐: without itself the last <= is 早餐 (row 5)
		expect(expensePositionFor(orderedGrid(), 3, 10, 11, 101, 6)).toBe(6);
	});

	it("scans only to the row above 花費總額 when the window reaches past it", () => {
		expect(expensePositionFor(orderedGrid(), 3, 15, 11, null)).toBe(8);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts -t expensePositionFor`
Expected: FAIL — `expensePositionFor` is not exported.

- [ ] **Step 3: Implement**

In `src/finance-ops.ts`, right after `findExpenseWindow`:

```ts
const CARRY_ROW_LABELS: readonly string[] = [PREV_USD_OVERDRAFT_LABEL, PREV_NTD_OVERDRAFT_LABEL, OVERDRAFT_LABEL];

/**
 * The 1-indexed row an expense dated `serial` should OCCUPY to keep the
 * window date-sorted: after the last row dated <= serial (a same-date tie
 * appends after), with a dateless row (serial null) after every non-empty
 * row — the order an ascending UI date sort produces. Never above a
 * 上月…透支 carry row. Returns at most min(windowEnd, totalRow-1) + 1.
 * `ignoreRow` masks the row being repositioned (set_expense_date).
 */
export function expensePositionFor(
	values: unknown[][],
	windowStart: number,
	windowEnd: number,
	totalRow: number,
	serial: number | null,
	ignoreRow?: number,
): number {
	const scanEnd = Math.min(windowEnd, totalRow - 1);
	let last = windowStart - 1;
	let carry = windowStart - 1;
	for (let r = windowStart; r <= scanEnd; r++) {
		if (r === ignoreRow) continue;
		const row = values[r - 1] ?? [];
		if (CARRY_ROW_LABELS.includes(String(row[MONTH_COLS.item] ?? "").trim())) carry = r;
		if (serial === null) {
			if (row.some((c) => c !== "" && c != null)) last = r;
		} else {
			const d = row[MONTH_COLS.date];
			if (typeof d === "number" && d <= serial) last = r;
		}
	}
	return Math.max(last, carry) + 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/finance-ops.test.ts -t expensePositionFor`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: expensePositionFor — date-sorted position for an expense row

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: date-aware placement in `addExpense`

**Files:**
- Modify: `src/finance-ops.ts:762-789` (target-row selection) and `:832-849` (move request + payload)
- Test: `test/finance-ops.test.ts` — fixtures `monthGrid` (~line 74) and `currentMonthGrid` (~line 122), the `addExpense` describe (~line 799)

**Interfaces:**
- Consumes: `expensePositionFor` from Task 1.
- Produces: `addExpense` result gains no new fields; `row` in the payload is the row the expense FINALLY occupies (after any move); `inserted` true whenever a structural insert happened.

- [ ] **Step 1: Update fixtures so existing dateless/dated tests keep their placement**

In `test/finance-ops.test.ts`:

`monthGrid()` — date the last non-empty row (近鐵, index 7):

```ts
	g[7] = [dateSerial(2026, 9, 1), "近鐵 80000系", "購物", "", "='火車模型'!D4"];
```

`currentMonthGrid()` — date 電話費 (index 5):

```ts
	g[5] = [dateSerial(2026, 7, 1), "電話費", "生活用品", "", 1261, "TWD"];
```

(`dateSerial` is already imported in the test file.) With these, a dated add on either grid targets the first empty row (9 resp. 7) exactly as the old first-empty behavior did, so the credit-bucket `addExpense` tests (which pass July dates) keep their `rowIndex 6` / guard-shift-0 expectations.

- [ ] **Step 2: Rewrite the two placement-sensitive tests and add four new ones**

Replace the test `"inserts a row inside the SUM window when no empty row exists"` (~line 871) — a dateless add on a full window now inserts at the last row AND moves below the shifted old last row:

```ts
	it("inserts + moves below the last row when the window is full (dateless sorts last)", async () => {
		const grid = monthGrid();
		grid[8] = ["", "already", "雜", "", 1];
		grid[9] = ["", "full", "雜", "", 2];

		const client = fakeClient(grid);
		const result = await addExpense(client, { item: "加購", amount: 100, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0]).toEqual({
			insertDimension: {
				range: { sheetId: 111, dimension: "ROWS", startIndex: 9, endIndex: 10 },
				inheritFromBefore: true,
			},
		});
		expect(requests[1]).toEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 9, columnIndex: 1 },
				rows: [
					{
						values: [
							{ userEnteredValue: { stringValue: "加購" } },
							{},
							{},
							{ userEnteredValue: { numberValue: 100 } },
							{ userEnteredValue: { stringValue: "TWD" } },
							{},
						],
					},
				],
				fields: "userEnteredValue",
			},
		});
		// pre-removal coordinates: one past the shifted old last row
		expect(requests.at(-1)).toEqual({
			moveDimension: {
				source: { sheetId: 111, dimension: "ROWS", startIndex: 9, endIndex: 10 },
				destinationIndex: 11,
			},
		});
		expect(result).toMatchObject({ row: 11, inserted: true });
	});
```

Check the test `"writes the date as a real date serial with mm/dd format when given"` (~line 927): it uses `date: "2026/09/02"` on `monthGrid` — with the Step-1 fixture change (近鐵 dated 9/1) the target stays row 9 and the test should pass unchanged. If it asserts a whole-array `toEqual`, leave it as is and only fix it if the run in Step 3 disagrees.

Add these new tests inside the `addExpense` describe:

```ts
	it("inserts a backdated expense at its date-sorted position", async () => {
		const g = currentMonthGrid();
		g[6] = [dateSerial(2026, 7, 10), "晚餐", "吃喝", "", 300, "TWD"]; // row 7 dated 7/10
		const client = fakeClient(g);

		const result = await addExpense(client, { item: "早餐", amount: 80, currency: "TWD", month: 9, date: "7/3" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// after 電話費 (7/1, row 6), before 晚餐 (7/10, row 7)
		expect(requests[0]).toEqual({
			insertDimension: {
				range: { sheetId: 111, dimension: "ROWS", startIndex: 6, endIndex: 7 },
				inheritFromBefore: true,
			},
		});
		expect(requests[1].updateCells.start).toEqual({ sheetId: 111, rowIndex: 6, columnIndex: 1 });
		expect(requests.some((r: any) => r.moveDimension)).toBe(false);
		expect(result).toMatchObject({ row: 7, inserted: true });
	});

	it("moves a latest-dated expense below the shifted last row when the window is full", async () => {
		const g = monthGrid();
		g[8] = [dateSerial(2026, 9, 3), "已有", "吃喝", "", 120, "TWD"];
		g[9] = [dateSerial(2026, 9, 5), "最後", "吃喝", "", 90, "TWD"];
		const client = fakeClient(g);

		const result = await addExpense(client, { item: "宵夜", amount: 60, currency: "TWD", month: 9, date: "9/6" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].insertDimension.range).toEqual({ sheetId: 111, dimension: "ROWS", startIndex: 9, endIndex: 10 });
		expect(requests.at(-1)).toEqual({
			moveDimension: {
				source: { sheetId: 111, dimension: "ROWS", startIndex: 9, endIndex: 10 },
				destinationIndex: 11,
			},
		});
		expect(result).toMatchObject({ row: 11, inserted: true });
	});

	it("never inserts above the 上月透支 carry rows for a backdated expense", async () => {
		const client = fakeClient(currentMonthGrid());

		const result = await addExpense(client, { item: "補記", amount: 10, currency: "TWD", month: 9, date: "6/15" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// nothing dated <= 6/15 — clamped to right below the carry rows (3-4)
		expect(requests[0].insertDimension.range).toEqual({ sheetId: 111, dimension: "ROWS", startIndex: 4, endIndex: 5 });
		expect(result).toMatchObject({ row: 5, inserted: true });
	});

	it("reuses an empty row when it sits exactly at the sorted position", async () => {
		const g = currentMonthGrid(); // 電話費 dated 7/1 at row 6; rows 7-10 empty
		const client = fakeClient(g);

		const result = await addExpense(client, { item: "晚餐", amount: 250, currency: "TWD", month: 9, date: "7/5" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests.some((r: any) => r.insertDimension)).toBe(false);
		expect(requests[0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 6, columnIndex: 1 });
		expect(result).toMatchObject({ row: 7, inserted: false });
	});
```

- [ ] **Step 3: Run the addExpense tests to verify the new ones fail**

Run: `bunx vitest run test/finance-ops.test.ts -t addExpense`
Expected: the four new tests and the rewritten full-window test FAIL (old placement logic); the fixture-preserved tests still pass.

- [ ] **Step 4: Implement the placement in `addExpense`**

In `src/finance-ops.ts`, replace the block from `// First fully-empty row inside the SUM window` (line ~764) through the `insertDimension` push (line ~788) with:

```ts
	// Date-sorted position: after the last row dated <= the new date; a
	// dateless row lands after everything — the order an ascending UI date
	// sort produces. Never above the 上月…透支 carry rows.
	let targetRow = expensePositionFor(values, windowStart, windowEnd, totalRow, dateSerialValue);
	const scanEnd = Math.min(windowEnd, totalRow - 1);

	const sheetId = await client.getSheetId(tab);
	const requests: object[] = [];
	const targetIsEmpty = targetRow <= scanEnd && !(values[targetRow - 1] ?? []).some((c) => c !== "" && c != null);
	const inserted = !targetIsEmpty;
	let moveToRow: number | null = null;
	if (inserted) {
		if (windowEnd <= windowStart) {
			throw new Error(`The expense window =SUM(${TWD_COL}${windowStart}:${TWD_COL}${windowEnd}) in ${tab} is too small to insert into safely.`);
		}
		// An insert AT the window's first row would shift the SUM range down
		// instead of extending it. Dead branch on real tabs (the carry rows
		// clamp positions past it) — kept as a safety rail.
		targetRow = Math.max(targetRow, windowStart + 1);
		if (targetRow > windowEnd) {
			// Belongs after the window's last row, where an insert would fall
			// outside every range. Insert at the last row (auto-extends), then
			// move the new row below the shifted old last row.
			targetRow = windowEnd;
			moveToRow = windowEnd + 1;
		}
		requests.push({
			insertDimension: {
				range: { sheetId, dimension: "ROWS", startIndex: targetRow - 1, endIndex: targetRow },
				inheritFromBefore: true,
			},
		});
	}
```

(The old `const sheetId`/`const requests`/`const inserted` lines are subsumed — do not leave duplicates.)

Then, after the bucket-guard block (`requests.push(...guard.requests);`, line ~829) and before `await client.batchUpdate(requests);`, add:

```ts
	if (moveToRow !== null) {
		requests.push({
			moveDimension: {
				source: { sheetId, dimension: "ROWS", startIndex: targetRow - 1, endIndex: targetRow },
				// Pre-removal coordinates: the new row sits at 0-based
				// windowEnd-1, the old last row at windowEnd, so "after the old
				// last row" is 0-based windowEnd+1 == moveToRow. The row lands
				// at 1-based moveToRow once its old slot closes.
				destinationIndex: moveToRow,
			},
		});
	}
```

In the return payload change `row: targetRow,` to:

```ts
		row: moveToRow ?? targetRow,
```

- [ ] **Step 5: Run the full file's tests**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: PASS. If any credit-bucket `addExpense` test fails on placement, its add date predates the fixture's 電話費 7/1 anchor — fix by checking the test's `date:` param against the rule (target = after last row dated ≤ it), not by changing the implementation.

- [ ] **Step 6: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: add_expense places rows date-sorted inside the window

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `setExpenseDate` relocates the row

**Files:**
- Modify: `src/finance-ops.ts:1205-1235` (setExpenseDate tail)
- Test: `test/finance-ops.test.ts` — `setExpenseDate` describe (~line 1282)

**Interfaces:**
- Consumes: `expensePositionFor` from Task 1 (with `ignoreRow`).
- Produces: `setExpenseDate` result gains `movedToRow: number | null` (null = already in position).

- [ ] **Step 1: Write the failing tests**

Add inside the `setExpenseDate` describe:

```ts
	it("moves the row down to its date-sorted position after dating it", async () => {
		const g = dateGrid();
		g[7] = [dateSerial(2026, 7, 3), "後面", "吃喝", "", 120, "TWD", ""]; // row 8 dated 7/3
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/10", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests.at(-1)).toEqual({
			moveDimension: {
				source: { sheetId: 111, dimension: "ROWS", startIndex: 6, endIndex: 7 },
				destinationIndex: 8, // before original row 9; lands at row 8 after its slot closes
			},
		});
		expect(result).toMatchObject({ row: 7, movedToRow: 8 });
	});

	it("moves the row up when the new date predates every dated row", async () => {
		const g = dateGrid();
		(g[5] as unknown[])[0] = dateSerial(2026, 7, 8); // 電話費 now dated 7/8
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/2", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests.at(-1)).toEqual({
			moveDimension: {
				source: { sheetId: 111, dimension: "ROWS", startIndex: 6, endIndex: 7 },
				destinationIndex: 4, // right below the carry rows
			},
		});
		expect(result).toMatchObject({ movedToRow: 5 });
	});

	it("does not move a row already in its sorted position", async () => {
		const client = fakeClient(dateGrid());
		const result = await setExpenseDate(client, { item: "Netflix", date: "7/10", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests.some((r: any) => r.moveDimension)).toBe(false);
		expect(result.movedToRow).toBeNull();
	});
```

(`dateGrid` puts Netflix at row 7; after Task 2's fixture change 電話費 at row 6 is dated 7/1, so "7/10" with nothing later below means target 7 = in place.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts -t setExpenseDate`
Expected: the three new tests FAIL (`movedToRow` undefined / no moveDimension emitted).

- [ ] **Step 3: Implement**

In `setExpenseDate` (`src/finance-ops.ts`), after the bucket-guard block (ends line ~1221) and before `await client.batchUpdate(requests);`, add:

```ts
	// Relocate to the date-sorted position, computed as if the row were
	// absent. moveDimension rewrites references like an insert+delete pair,
	// so window ranges keep their size and the +D3/+E4 carry add-backs follow
	// their cells. target == row (its own slot) and target == row + 1
	// (immediately after itself) both mean "already in place".
	const target = expensePositionFor(values, windowStart, windowEnd, totalRow, serial, row);
	let movedToRow: number | null = null;
	if (target !== row && target !== row + 1) {
		requests.push({
			moveDimension: {
				source: { sheetId, dimension: "ROWS", startIndex: row - 1, endIndex: row },
				// Pre-removal coordinates; a down-move lands one row higher
				// once the old slot closes.
				destinationIndex: target - 1,
			},
		});
		movedToRow = target > row ? target - 1 : target;
	}
```

And add `movedToRow,` to the returned object (after `previousDate,`).

- [ ] **Step 4: Run the full file's tests**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: PASS. Existing setExpenseDate tests that date a row on `dateGrid` may now legitimately emit a trailing moveDimension (e.g. the duplicate-项目 test dates row 7 with a 7/3-dated row 8 below) — those tests assert `result.row` or `requests[0]` only and should still pass; if one does whole-array equality, append the expected moveDimension per the rule above rather than weakening the assertion. The spec requires a move composed with a bucket-guard insert in one batch: if no existing card test ends up asserting both a guard insert and a trailing moveDimension, extend one of them to assert both (guard requests first, moveDimension last).

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: set_expense_date moves the dated row to its sorted position

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: tool descriptions, conventions text, final verification

**Files:**
- Modify: `src/tools.ts:136` (add_expense description), `src/tools.ts:181` (set_expense_date description)
- Modify: `src/conventions.ts` (the `- The list ends at the "花費總額" row…` bullet, ~line 383)

**Interfaces:**
- Consumes: behavior from Tasks 2-3 (documentation only — no code changes).
- Produces: nothing downstream.

- [ ] **Step 1: Update the two tool descriptions**

`src/tools.ts` line 136, replace the add_expense description string with:

```
"Log an expense into a monthly tab (defaults to the current month). Writes into the expense window at its date-sorted position (after the last row dated on-or-before it; dateless rows sort last) so 花費總額 picks it up and a hand date-sort of the list survives; converts USD via GOOGLEFINANCE, and tags the row's 類別 cell. Use this instead of append_rows/update_range for monthly expenses."
```

`src/tools.ts` line 181, replace the set_expense_date description string with:

```
"Fill in (or change) the 日期 of an existing expense row on a monthly tab — e.g. when a dateless recurring subscription charges a credit card, dating the row is what drops it into the 信用卡帳單對帳區 bucket. Finds the row by exact 項目; with duplicate names it prefers the single dateless row (pass row to disambiguate). The dated row is then moved to its date-sorted position (movedToRow in the result; null when it already sat there). If the row's 支付方式 holds a card, the target bucket is grown automatically when its spill area is full."
```

- [ ] **Step 2: Extend the conventions bullet**

In `src/conventions.ts`, find the bullet starting `- The list ends at the "花費總額" row` and append one sentence before its closing period chain, so it ends:

```
… Never append below 花費總額. The tools keep the list date-sorted — add_expense and set_expense_date place rows after the last not-later 日期, dateless rows last, matching an ascending UI sort.
```

- [ ] **Step 3: Full verification**

Run: `bunx vitest run` — Expected: all test files PASS.
Run: `bun run type-check` — Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools.ts src/conventions.ts
git commit -m "docs: describe date-sorted placement in tool descriptions and conventions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
