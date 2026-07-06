# add_transfer (乾坤大挪移) Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tailored MCP tool `add_transfer` that logs an NTD→USD transfer into a monthly tab's 乾坤大挪移 section, pinning 當下美金/匯差 to the spot rate at entry time and keeping the 總和 sums covering every row.

**Architecture:** Follows the existing tailored-tool pattern: a pure-ish op `addTransfer` in `src/finance-ops.ts` (grid read → anchor location → batchUpdate writes), constants in `src/conventions.ts`, tool registration in `src/tools.ts`. Rate freezing works by writing `=GOOGLEFINANCE("CURRENCY:USDTWD")` into the new row's own 當下美金 cell, reading the computed value back, then rewriting the row with formulas pinned to that literal number.

**Tech Stack:** TypeScript on Cloudflare Workers, Google Sheets API v4 via the repo's `SheetsClient`, zod for tool schemas, vitest for tests.

**Spec:** `docs/superpowers/specs/2026-07-06-add-transfer-tool-design.md`

## Global Constraints

- Use **bun**: `bun run test`, `bun run type-check` (never npm).
- Work on branch `feat/add-transfer-tool` off `main`.
- Sheet layout facts (verified in prod 7月): section title `乾坤大挪移` in column G; header row below it with G=日期, H=新臺幣, I=當下美金, J=實際美金, K=匯差, L=手續費, M=當筆總額外花費; data rows below; a `總和` row (label in G, `=sum(...)` in H–M) closes the section. Ledger wiring: 總美金餘額 `+J總和`, 總新臺幣餘額 `-H總和`, 新臺幣支出 `+M總和`.
- `GRID_READ` is `A1:H60` — too narrow for this section. `addTransfer` reads its own `TRANSFER_GRID_READ = "A1:M60"`. Do NOT widen `GRID_READ` (other ops' tests pin its exact string).
- All row/column constants live in `src/conventions.ts`; ops never hardcode labels.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Conventions — transfer-section constants and date helpers

**Files:**
- Modify: `src/conventions.ts` (add after the `MONTH_COLS` block, around line 126)
- Test: `test/conventions.test.ts`

**Interfaces:**
- Consumes: existing `dateSerial`, `SHEET_TIMEZONE` in `src/conventions.ts`.
- Produces (used by Tasks 2–4):
  - `TRANSFER_SECTION_LABEL: "乾坤大挪移"`, `TRANSFER_TOTAL_LABEL: "總和"`
  - `TRANSFER_COLS: { date: 6, ntd: 7, spotUsd: 8, actualUsd: 9, spread: 10, fee: 11, extra: 12 }` (0-indexed G–M)
  - `todaySerial(now?: Date): number` — today in Taipei as a Sheets serial
  - `serialToIso(serial: number): string` — inverse of `dateSerial`, returns `"YYYY-MM-DD"`

- [ ] **Step 1: Write the failing tests**

Add to `test/conventions.test.ts` (import `todaySerial`, `serialToIso`, `dateSerial` from `../src/conventions`):

```ts
describe("todaySerial / serialToIso", () => {
	it("todaySerial uses the Taipei calendar date", () => {
		// 18:00 UTC on 7/6 is already 02:00 on 7/7 in Taipei
		expect(todaySerial(new Date("2026-07-06T18:00:00Z"))).toBe(dateSerial(2026, 7, 7));
		expect(todaySerial(new Date("2026-07-06T03:00:00Z"))).toBe(dateSerial(2026, 7, 6));
	});

	it("serialToIso inverts dateSerial", () => {
		expect(serialToIso(dateSerial(2026, 7, 6))).toBe("2026-07-06");
		expect(serialToIso(dateSerial(1999, 12, 31))).toBe("1999-12-31");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test test/conventions.test.ts`
Expected: FAIL — `todaySerial` / `serialToIso` are not exported.

- [ ] **Step 3: Implement in `src/conventions.ts`**

After the `MONTH_COLS` block add:

```ts
/**
 * 乾坤大挪移 — the NTD→USD transfer log, present on monthly tabs from 7月
 * 2026 (start_month copies it forward). Title in column G, a header row
 * below it, data rows, then a 總和 row (label in G, =SUM per column H–M).
 * The 銀行餘額 block wires to the 總和 row: 總美金餘額 +J (USD received),
 * 總新臺幣餘額 −H (NTD sent), 新臺幣支出 +M (匯差+手續費 count as the
 * month's NTD spending). The principal is a transfer, not income/spending.
 */
export const TRANSFER_SECTION_LABEL = "乾坤大挪移";
export const TRANSFER_TOTAL_LABEL = "總和";

/** 0-indexed columns of the 乾坤大挪移 section (G–M). */
export const TRANSFER_COLS = {
	/** G — 日期; also the column of the section title and the 總和 label. */
	date: 6,
	/** H — 新臺幣 debited from the bank. */
	ntd: 7,
	/** I — 當下美金 = 新臺幣 / spot rate, pinned at entry time. */
	spotUsd: 8,
	/** J — 實際美金: the USD that actually arrived. */
	actualUsd: 9,
	/** K — 匯差 in NTD = (當下美金 − 實際美金) × the pinned rate. */
	spread: 10,
	/** L — 手續費 in NTD. */
	fee: 11,
	/** M — 當筆總額外花費 = 匯差 + 手續費. */
	extra: 12,
} as const;
```

And next to `dateSerial` / `parseDateInput` add:

```ts
/** Inverse of dateSerial: Sheets serial → "YYYY-MM-DD". */
export function serialToIso(serial: number): string {
	return new Date(serial * 86_400_000 + Date.UTC(1899, 11, 30)).toISOString().slice(0, 10);
}

/** Today's calendar date in Taipei as a Sheets serial. */
export function todaySerial(now: Date = new Date()): number {
	// en-CA formats as YYYY-MM-DD
	const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: SHEET_TIMEZONE })
		.format(now)
		.split("-")
		.map(Number);
	return dateSerial(y, m, d);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test test/conventions.test.ts`
Expected: PASS (all suites in the file).

- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts test/conventions.test.ts
git commit -m "feat: 乾坤大挪移 section constants + Taipei date helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `findTransferSection` grid helper

**Files:**
- Modify: `src/finance-ops.ts` (add near `findExpenseWindow`, after line 118; extend the conventions import list)
- Test: `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: `findRowByValue`, `colLetter` (finance-ops), `TRANSFER_SECTION_LABEL`, `TRANSFER_TOTAL_LABEL`, `TRANSFER_COLS` (Task 1).
- Produces (used by Task 3):
  - `TRANSFER_GRID_READ = "A1:M60"` (exported const)
  - `interface TransferSection { headerRow: number; totalRow: number }` (1-indexed)
  - `findTransferSection(values: unknown[][], tab: string): TransferSection` — throws descriptive errors when the section is missing or malformed.

- [ ] **Step 1: Write the failing tests**

Add to `test/finance-ops.test.ts`. First the shared fixture, next to `migratedMonthGrid()` (grid arrays are `row = index + 1`):

```ts
/** migratedMonthGrid + a 乾坤大挪移 transfer block at G33:M36 (data slot row 35 empty). */
function transferGrid(): unknown[][] {
	const g = migratedMonthGrid();
	g[32] = ["", "", "", "", "", "", "乾坤大挪移"];
	g[33] = ["", "", "", "", "", "", "日期", "新臺幣", "當下美金", "實際美金", "匯差", "手續費", "當筆總額外花費"];
	// row 35 empty — the first data slot
	g[35] = ["", "", "", "", "", "", "總和", "=sum(H35)", "=sum(I35)", "=sum(J35)", "=sum(K35)", "=sum(L35)", "=sum(M35)"];
	return g;
}
```

Then the tests (import `findTransferSection` from `../src/finance-ops`):

```ts
describe("findTransferSection", () => {
	it("locates the header and 總和 rows from the anchor", () => {
		expect(findTransferSection(transferGrid(), "9 月")).toEqual({ headerRow: 34, totalRow: 36 });
	});

	it("throws when the tab has no 乾坤大挪移 section", () => {
		expect(() => findTransferSection(migratedMonthGrid(), "6 月")).toThrow("乾坤大挪移");
	});

	it("throws when the header row under the anchor is missing", () => {
		const g = transferGrid();
		g[33] = [];
		expect(() => findTransferSection(g, "9 月")).toThrow("日期");
	});

	it("throws when there is no 總和 row", () => {
		const g = transferGrid();
		g[35] = [];
		expect(() => findTransferSection(g, "9 月")).toThrow("總和");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test test/finance-ops.test.ts`
Expected: FAIL — `findTransferSection` is not exported.

- [ ] **Step 3: Implement in `src/finance-ops.ts`**

Extend the `./conventions` import with `TRANSFER_COLS`, `TRANSFER_SECTION_LABEL`, `TRANSFER_TOTAL_LABEL` (keep alphabetical order). Then after `findExpenseWindow`:

```ts
/** The 乾坤大挪移 section spans G–M, wider than GRID_READ — read the full width. */
export const TRANSFER_GRID_READ = "A1:M60";

export interface TransferSection {
	/** 1-indexed row of the 日期/新臺幣/… header. */
	headerRow: number;
	/** 1-indexed row of the 總和 totals. */
	totalRow: number;
}

/** Locate the 乾坤大挪移 block (FORMULA-render grid of TRANSFER_GRID_READ). Throws when absent or malformed. */
export function findTransferSection(values: unknown[][], tab: string): TransferSection {
	const dateCol = TRANSFER_COLS.date;
	const anchorRow = findRowByValue(values, dateCol, TRANSFER_SECTION_LABEL);
	if (anchorRow === null) {
		throw new Error(
			`No ${TRANSFER_SECTION_LABEL} section in ${tab} (searched column ${colLetter(dateCol)} of ${TRANSFER_GRID_READ}) — the transfer log exists from 7月 2026 on.`,
		);
	}
	const headerRow = anchorRow + 1;
	if (String(values[headerRow - 1]?.[dateCol] ?? "").trim() !== "日期") {
		throw new Error(
			`The row under the ${TRANSFER_SECTION_LABEL} anchor in ${tab} is not the 日期/新臺幣/… header row.`,
		);
	}
	for (let r = headerRow + 1; r <= values.length; r++) {
		if (String(values[r - 1]?.[dateCol] ?? "").trim() === TRANSFER_TOTAL_LABEL) {
			return { headerRow, totalRow: r };
		}
	}
	throw new Error(`No ${TRANSFER_TOTAL_LABEL} row under the ${TRANSFER_SECTION_LABEL} header in ${tab}.`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test test/finance-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: locate the 乾坤大挪移 transfer section on a monthly grid

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `addTransfer` operation

**Files:**
- Modify: `src/finance-ops.ts` (add after `addExpense`, around line 555)
- Test: `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: `findTransferSection`, `TRANSFER_GRID_READ` (Task 2); `TRANSFER_COLS`, `todaySerial`, `serialToIso` (Task 1); existing `quoteTab`, `assertNotTruncated`, `cellData`, `colLetter`, `monthTabName`, `currentMonthTab`, `parseDateInput`; `SheetsClient.readRange/getSheetId/batchUpdate`.
- Produces (used by Task 4):
  - `interface AddTransferParams { ntd: number; usd: number; fee: number; date?: string; month?: number }`
  - `addTransfer(client: SheetsClient, p: AddTransferParams): Promise<{ tab; row; inserted; date; ntd; usd; rate; spotUsd; spread; fee; extraCost }>`

Behavior contract:
1. Bad `date` fails before any read/write. Omitted `date` = today in Taipei.
2. Reads `TRANSFER_GRID_READ` as FORMULA; refuses on truncation.
3. Target row = first row between header and 總和 that is empty across G–M; if none, insert a whole sheet row directly above 總和 (`inheritFromBefore: true` — cross-references like the ledger's `+J36`/`-H36`/`+M36` and the income SUMIFs adjust automatically).
4. batchUpdate #1: (optional insert) + scratch `=GOOGLEFINANCE("CURRENCY:USDTWD")` into the target row's I cell. Then read that one cell UNFORMATTED_VALUE. Non-numeric/non-positive → clear the scratch cell (batchUpdate) and throw.
5. batchUpdate #2: 日期 (serial, mm/dd format), H/J/L values, I/K/M formulas pinned to the literal rate, and the 總和 row rewritten to `=SUM(col{firstData}:col{lastData})` for H–M (the pre-existing single-cell `=sum(H35)` cannot auto-extend, so the op owns the sum range from now on).

- [ ] **Step 1: Write the failing tests**

Add to `test/finance-ops.test.ts` (import `addTransfer` from `../src/finance-ops`, `todaySerial` from `../src/conventions`). A transfer-aware fake client — the grid read contains `:`, the scratch read is a single cell:

```ts
function transferClient(grid: unknown[][], rate: unknown = 29.85): SheetsClient {
	return {
		readRange: vi.fn(async (range: string) =>
			range.includes(":")
				? { range, values: grid, truncated: false }
				: { range, values: [[rate]], truncated: false },
		),
		getSheetId: vi.fn(async () => 111),
		batchUpdate: vi.fn(async () => ({ replies: [{}] })),
	} as unknown as SheetsClient;
}

describe("addTransfer", () => {
	it("writes into the first empty row with the rate pinned", async () => {
		const client = transferClient(transferGrid());
		const result = await addTransfer(client, { ntd: 30000, usd: 1000, fee: 30, month: 9, date: "9/2" });

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:M60", "FORMULA"]);
		// batch 1: scratch GOOGLEFINANCE into I35, no insert needed
		const batch1 = (client.batchUpdate as any).mock.calls[0][0];
		expect(batch1).toHaveLength(1);
		expect(batch1[0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 34, columnIndex: 8 });
		expect(batch1[0].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			formulaValue: '=GOOGLEFINANCE("CURRENCY:USDTWD")',
		});
		expect((client.readRange as any).mock.calls[1]).toEqual(["'9 月'!I35", "UNFORMATTED_VALUE"]);

		// batch 2: 日期, the entry row, the 總和 rewrite
		const batch2 = (client.batchUpdate as any).mock.calls[1][0];
		const dateCell = batch2[0].updateCells;
		expect(dateCell.start).toEqual({ sheetId: 111, rowIndex: 34, columnIndex: 6 });
		expect(dateCell.rows[0].values[0].userEnteredFormat).toEqual({
			numberFormat: { type: "DATE", pattern: "mm/dd" },
		});
		const rowCells = batch2[1].updateCells;
		expect(rowCells.start).toEqual({ sheetId: 111, rowIndex: 34, columnIndex: 7 });
		expect(rowCells.rows[0].values.map((v: any) => v.userEnteredValue)).toEqual([
			{ numberValue: 30000 },                       // H 新臺幣
			{ formulaValue: "=H35/29.85" },               // I 當下美金 (pinned)
			{ numberValue: 1000 },                        // J 實際美金
			{ formulaValue: "=(I35-J35)*29.85" },         // K 匯差 (pinned)
			{ numberValue: 30 },                          // L 手續費
			{ formulaValue: "=K35+L35" },                 // M 當筆總額外花費
		]);
		const sums = batch2[2].updateCells;
		expect(sums.start).toEqual({ sheetId: 111, rowIndex: 35, columnIndex: 7 });
		expect(sums.rows[0].values.map((v: any) => v.userEnteredValue.formulaValue)).toEqual([
			"=SUM(H35:H35)", "=SUM(I35:I35)", "=SUM(J35:J35)", "=SUM(K35:K35)", "=SUM(L35:L35)", "=SUM(M35:M35)",
		]);

		// 30000 − 1000×29.85 = 150 spread; +30 fee = 180
		expect(result).toMatchObject({
			tab: "9 月", row: 35, inserted: false, date: "2026-09-02",
			ntd: 30000, usd: 1000, rate: 29.85, spread: 150, fee: 30, extraCost: 180,
		});
		expect(result.spotUsd).toBeCloseTo(1005.03, 2);
	});

	it("inserts a row above 總和 when the section is full and widens the sums", async () => {
		const grid = transferGrid();
		grid[34] = ["", "", "", "", "", "", 46266, 30000, "=H35/29.9", 1000, "=(I35-J35)*29.9", 30, "=K35+L35"];
		const client = transferClient(grid);
		const result = await addTransfer(client, { ntd: 15000, usd: 500, fee: 15, month: 9, date: "9/9" });

		const batch1 = (client.batchUpdate as any).mock.calls[0][0];
		expect(batch1[0].insertDimension.range).toEqual({
			sheetId: 111, dimension: "ROWS", startIndex: 35, endIndex: 36,
		});
		expect(batch1[1].updateCells.start).toEqual({ sheetId: 111, rowIndex: 35, columnIndex: 8 });
		expect((client.readRange as any).mock.calls[1]).toEqual(["'9 月'!I36", "UNFORMATTED_VALUE"]);

		const batch2 = (client.batchUpdate as any).mock.calls[1][0];
		expect(batch2[2].updateCells.start).toEqual({ sheetId: 111, rowIndex: 36, columnIndex: 7 });
		expect(batch2[2].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			formulaValue: "=SUM(H35:H36)",
		});
		expect(result).toMatchObject({ row: 36, inserted: true });
	});

	it("defaults 日期 to today in Taipei", async () => {
		const client = transferClient(transferGrid());
		await addTransfer(client, { ntd: 100, usd: 3, fee: 0, month: 9 });
		const dateCell = (client.batchUpdate as any).mock.calls[1][0][0].updateCells.rows[0].values[0];
		expect(dateCell.userEnteredValue.numberValue).toBe(todaySerial());
	});

	it("fails and clears the scratch cell when GOOGLEFINANCE is not numeric", async () => {
		const client = transferClient(transferGrid(), "#N/A");
		await expect(addTransfer(client, { ntd: 100, usd: 3, fee: 0, month: 9 })).rejects.toThrow("GOOGLEFINANCE");
		const calls = (client.batchUpdate as any).mock.calls;
		expect(calls).toHaveLength(2); // scratch write, then the clearing write
		expect(calls[1][0][0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 34, columnIndex: 8 });
		expect(calls[1][0][0].updateCells.rows[0].values).toEqual([{}]);
	});

	it("refuses when the tab has no 乾坤大挪移 section", async () => {
		const client = transferClient(migratedMonthGrid());
		await expect(addTransfer(client, { ntd: 100, usd: 3, fee: 0, month: 6 })).rejects.toThrow("乾坤大挪移");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("rejects a bad date before any read or write", async () => {
		const client = transferClient(transferGrid());
		await expect(
			addTransfer(client, { ntd: 100, usd: 3, fee: 0, month: 9, date: "not-a-date" }),
		).rejects.toThrow("Unrecognized date");
		expect((client.readRange as any).mock.calls).toHaveLength(0);
	});

	it("refuses when the grid read is truncated", async () => {
		const client = transferClient(transferGrid());
		(client.readRange as any).mockResolvedValue({ range: "x", values: transferGrid(), truncated: true });
		await expect(addTransfer(client, { ntd: 100, usd: 3, fee: 0, month: 9 })).rejects.toThrow("truncated");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test test/finance-ops.test.ts`
Expected: FAIL — `addTransfer` is not exported.

- [ ] **Step 3: Implement in `src/finance-ops.ts`**

Extend the `./conventions` import with `serialToIso`, `todaySerial`. Then after `addExpense`:

```ts
export interface AddTransferParams {
	/** NTD debited from the bank (新臺幣). */
	ntd: number;
	/** USD that actually arrived (實際美金). */
	usd: number;
	/** 手續費 in NTD. */
	fee: number;
	/** M/D, MM/DD, YYYY/M/D, or YYYY-MM-DD; omitted = today in Taipei. */
	date?: string;
	month?: number;
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

export async function addTransfer(client: SheetsClient, p: AddTransferParams) {
	const tab = p.month !== undefined ? monthTabName(p.month) : currentMonthTab();
	// Parse before any read/write so a bad date fails closed.
	const dateSerialValue = p.date !== undefined ? parseDateInput(p.date) : todaySerial();

	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${TRANSFER_GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, tab, TRANSFER_GRID_READ);
	const { headerRow, totalRow } = findTransferSection(values, tab);

	// First row between the header and 總和 that is empty across G–M.
	let targetRow: number | null = null;
	for (let r = headerRow + 1; r < totalRow; r++) {
		const cells = (values[r - 1] ?? []).slice(TRANSFER_COLS.date, TRANSFER_COLS.extra + 1);
		if (!cells.some((c) => c !== "" && c != null)) {
			targetRow = r;
			break;
		}
	}

	const sheetId = await client.getSheetId(tab);
	const inserted = targetRow === null;
	let finalTotalRow = totalRow;
	const scratchRequests: object[] = [];
	if (targetRow === null) {
		// Insert directly above 總和; the ledger's +J/−H/+M references shift with it.
		targetRow = totalRow;
		finalTotalRow = totalRow + 1;
		scratchRequests.push({
			insertDimension: {
				range: { sheetId, dimension: "ROWS", startIndex: targetRow - 1, endIndex: targetRow },
				inheritFromBefore: true,
			},
		});
	}
	// The entry's own 當下美金 cell doubles as the rate scratch: live GOOGLEFINANCE,
	// read once, then overwritten with the pinned formula.
	const scratchWrite = {
		updateCells: {
			start: { sheetId, rowIndex: targetRow - 1, columnIndex: TRANSFER_COLS.spotUsd },
			rows: [{ values: [cellData('=GOOGLEFINANCE("CURRENCY:USDTWD")')] }],
			fields: "userEnteredValue",
		},
	};
	scratchRequests.push(scratchWrite);
	await client.batchUpdate(scratchRequests);

	const scratchCell = `${colLetter(TRANSFER_COLS.spotUsd)}${targetRow}`;
	const read = await client.readRange(`${quoteTab(tab)}!${scratchCell}`, "UNFORMATTED_VALUE");
	const rate = read.values[0]?.[0];
	if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
		await client.batchUpdate([
			{ updateCells: { ...scratchWrite.updateCells, rows: [{ values: [{}] }] } },
		]);
		throw new Error(
			`GOOGLEFINANCE("CURRENCY:USDTWD") did not return a usable rate (got ${JSON.stringify(rate)}); the scratch cell ${scratchCell} was cleared — try again in a moment.`,
		);
	}

	const r = targetRow;
	const H = colLetter(TRANSFER_COLS.ntd);
	const I = colLetter(TRANSFER_COLS.spotUsd);
	const J = colLetter(TRANSFER_COLS.actualUsd);
	const K = colLetter(TRANSFER_COLS.spread);
	const L = colLetter(TRANSFER_COLS.fee);
	const rowCells = [
		cellData(p.ntd),                        // H 新臺幣
		cellData(`=${H}${r}/${rate}`),          // I 當下美金, rate pinned at entry
		cellData(p.usd),                        // J 實際美金
		cellData(`=(${I}${r}-${J}${r})*${rate}`), // K 匯差 in NTD
		cellData(p.fee),                        // L 手續費
		cellData(`=${K}${r}+${L}${r}`),         // M 當筆總額外花費
	];
	// Rewrite 總和 over the whole data window: the sheet's original single-cell
	// =sum(H35) cannot auto-extend, so the op owns the range from now on.
	const sumCells = [];
	for (let c = TRANSFER_COLS.ntd; c <= TRANSFER_COLS.extra; c++) {
		const col = colLetter(c);
		sumCells.push(cellData(`=SUM(${col}${headerRow + 1}:${col}${finalTotalRow - 1})`));
	}
	await client.batchUpdate([
		{
			updateCells: {
				start: { sheetId, rowIndex: r - 1, columnIndex: TRANSFER_COLS.date },
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
				start: { sheetId, rowIndex: r - 1, columnIndex: TRANSFER_COLS.ntd },
				rows: [{ values: rowCells }],
				fields: "userEnteredValue",
			},
		},
		{
			updateCells: {
				start: { sheetId, rowIndex: finalTotalRow - 1, columnIndex: TRANSFER_COLS.ntd },
				rows: [{ values: sumCells }],
				fields: "userEnteredValue",
			},
		},
	]);

	const spread = p.ntd - p.usd * rate; // == (當下美金 − 實際美金) × rate
	return {
		tab,
		row: r,
		inserted,
		date: serialToIso(dateSerialValue),
		ntd: p.ntd,
		usd: p.usd,
		rate,
		spotUsd: round2(p.ntd / rate),
		spread: round2(spread),
		fee: p.fee,
		extraCost: round2(spread + p.fee),
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test test/finance-ops.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Run the full suite and type-check**

Run: `bun run test && bun run type-check`
Expected: PASS / no errors.

- [ ] **Step 6: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: addTransfer op — 乾坤大挪移 entry with entry-time rate pinning

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Register `add_transfer` + document the section in conventions text

**Files:**
- Modify: `src/tools.ts` (inside `registerTailoredTools`, after the `add_trip_entry` registration ~line 245)
- Modify: `src/conventions.ts` (`CONVENTIONS_TEXT`, MONTHLY TABS section)
- Test: `test/conventions.test.ts` (only if it asserts on CONVENTIONS_TEXT — check first; if it doesn't, no new test needed for the text)

**Interfaces:**
- Consumes: `addTransfer`, `AddTransferParams` (Task 3); existing `ok`/`toError`/`monthParam` in `tools.ts`.
- Produces: the MCP tool `add_transfer` (ntd, usd, fee, date?, month?).

- [ ] **Step 1: Register the tool in `src/tools.ts`**

Add `addTransfer` to the `./finance-ops` import list (alphabetical). After the `add_trip_entry` registration:

```ts
	server.tool(
		"add_transfer",
		"Log a 乾坤大挪移 NTD→USD transfer into a monthly tab (defaults to the current month): writes the entry into the transfer block (columns G-M), pins 當下美金/匯差 to the USDTWD spot rate at entry time, and keeps the 總和 sums covering every row. The 銀行餘額 ledgers pick it up automatically: +實際美金 into 總美金餘額, −新臺幣 from 總新臺幣餘額, and 匯差+手續費 into 新臺幣支出 as this month's NTD spending. Use this instead of update_range for transfers.",
		{
			ntd: z.number().positive().describe("NTD debited from the bank (新臺幣)"),
			usd: z.number().positive().describe("USD that actually arrived (實際美金)"),
			fee: z.number().min(0).describe("手續費 in NTD"),
			date: z
				.string()
				.min(1)
				.optional()
				.describe("Transfer date: M/D, MM/DD, or YYYY-MM-DD (defaults to today in Taipei)"),
			month: monthParam.optional().describe("Target month 1-12 (default: current month)"),
		},
		async (p) => {
			try {
				return ok(await addTransfer(client, p));
			} catch (e) {
				return toError(e);
			}
		},
	);
```

- [ ] **Step 2: Document the section in `CONVENTIONS_TEXT`**

In `src/conventions.ts`, inside the MONTHLY TABS section of `CONVENTIONS_TEXT`, add this bullet directly after the 銀行餘額 paragraph (the line starting `- Further down, a 銀行餘額 block …`):

```
- To the right of the expense list, a 乾坤大挪移 block (the NTD→USD transfer log, from 7月 2026 on) spans columns G-M: the title in G, a header row (日期 新臺幣 當下美金 實際美金 匯差 手續費 當筆總額外花費), data rows, then a 總和 row with per-column SUMs. 當下美金 and 匯差 are pinned to the USDTWD rate at entry time (a literal number, not live GOOGLEFINANCE). The 銀行餘額 block wires to the 總和 row: 總美金餘額 adds +J總和 (USD received), 總新臺幣餘額 subtracts -H總和 (NTD sent), and 新臺幣支出 adds +M總和 so 匯差+手續費 count as the month's NTD spending — the principal itself is a transfer, not income or spending. Log transfers with add_transfer; never hand-extend the 總和 formulas.
```

Also update the closing "Prefer the tailored tools (…)" line to include `add_transfer` in the list.

- [ ] **Step 3: Run the full suite and type-check**

Run: `bun run test && bun run type-check`
Expected: PASS / no errors. If a conventions test asserts on the tailored-tools list or text, update it to match.

- [ ] **Step 4: Commit**

```bash
git add src/tools.ts src/conventions.ts test/conventions.test.ts
git commit -m "feat: add_transfer MCP tool + 乾坤大挪移 conventions doc

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: End-to-end verification against the dev sheet

**Files:** none (verification only)

**Interfaces:**
- Consumes: the deployed dev worker (dev targets the COPY sheet, prod the real one — see wrangler.jsonc envs).

- [ ] **Step 1: Confirm how dev is run/deployed**

Read `wrangler.jsonc` for the dev environment/sheet ID. The dev worker targets the copy sheet, so writes are safe.

- [ ] **Step 2: Deploy or run dev worker and exercise the tool**

Deploy the dev environment (e.g. `bun run deploy -- --env dev` — match whatever env name wrangler.jsonc defines) and call `add_transfer` against the dev sheet's 7月 tab (e.g. ntd 30000, usd 1000, fee 30). Verify in the response: pinned rate, spread ≈ ntd − usd×rate.

- [ ] **Step 3: Verify the sheet state**

Read `7 月!G33:M37` (formulas) on the copy sheet: entry row filled, I/K pinned to a literal rate, 總和 row now `=SUM(H35:H35)`-style, and the ledger cells (總美金餘額/總新臺幣餘額/新臺幣支出) reflect the entry. Add a SECOND transfer to verify the insert path and sum-widening, then confirm 總和 covers both rows.

- [ ] **Step 4: Clean up the dev sheet**

Remove the two test entries (or restore the section to empty + `=SUM` over the single empty row) so the copy sheet stays tidy.

---

## Final step

Use superpowers:finishing-a-development-branch — push `feat/add-transfer-tool`, open a PR to `main` (PR body ends with the Claude Code attribution), and after merge deploy prod when Vincent confirms.
