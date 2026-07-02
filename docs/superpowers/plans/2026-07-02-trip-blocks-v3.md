# Trip Mosaic Blocks (v3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `add_trip_entry` work with the trip tab's real mosaic layout — 12 stacked category blocks across four column bands — with JPY and direct-TWD entries and band-scoped cell insertion when a block is full.

**Architecture:** A pure `findTripBlocks(values)` scanner discovers blocks by their header signature (日期+店鋪) and label row; `addTripEntry` is rewritten around it: first-empty-row write, band-scoped `insertRange` when full, and `分類總花費` SUM rewrites when the total's range doesn't cover the new row. All validation precedes writes.

**Tech Stack:** Existing project stack (TypeScript, Workers, vitest, bun). Branch: `trip-blocks`.

**Spec:** `docs/superpowers/specs/2026-07-02-trip-blocks-v3-design.md` (its "Observed block anatomy" section is ground truth).

## Global Constraints

- Use bun, not npm: `bun run test`, `bun run type-check`.
- Never use `insertDimension` (whole sheet rows) on a trip tab — only `insertRange` scoped to the block's 7 columns with `shiftDimension: "ROWS"`.
- All layout knowledge (labels, header signature, scan cap) lives ONLY in `src/conventions.ts`.
- Fail-closed: every anchor and total-formula precondition is validated BEFORE the first write call; anchor/precondition errors name what was searched or found.
- Exactly one of `jpy`/`twd` per entry — validated in the op with a descriptive error.
- Existing non-trip tests (month tools, client, conventions except the trip bits) must keep passing unchanged. Suite currently 55 tests.
- 1-indexed rows in public signatures/returns; 0-indexed only inside Sheets API request bodies.
- Commit per task on branch `trip-blocks`; do NOT push until the final merge step (pushing main auto-deploys… but this branch is not main; still, keep the branch local until integration passes).

---

### Task 1: Conventions v3 (mosaic constants + text)

**Files:**
- Modify: `src/conventions.ts`, `test/conventions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact exports Task 2–3 import): `TRIP_HEADER_DATE = "日期"`, `TRIP_HEADER_SHOP = "店鋪"`, `TRIP_TOTAL_LABEL = "分類總花費"`, `TRIP_MAX_BLOCK_ROWS = 30`; `TRIP_BLOCK_WIDTH` stays (= 8; 7 data columns + 1 spacer). `TRIP_CATEGORY_ROW` is KEPT in this task (finance-ops still imports it — deleting it here would break every finance-ops test at module load); mark it `/** @deprecated v2 single-row model — deleted in Task 2 with the finance-ops import swap. */`. Task 2 deletes it.

- [ ] **Step 1: Update the failing test first**

In `test/conventions.test.ts`, add the four new names to the import from `../src/conventions` (do NOT import `TRIP_CATEGORY_ROW` — it is being deleted) and replace the "conventions text mentions the anchors" test with:

```ts
	it("conventions text mentions the anchors Claude needs", () => {
		for (const needle of [
			"花費總額",
			"GOOGLEFINANCE",
			"上月透支",
			"insert",
			"0.22",
			"分類總花費",
			"電子產品",
			"機票住宿",
		]) {
			expect(CONVENTIONS_TEXT).toContain(needle);
		}
	});

	it("exports the trip block anchors", () => {
		expect(TRIP_HEADER_DATE).toBe("日期");
		expect(TRIP_HEADER_SHOP).toBe("店鋪");
		expect(TRIP_TOTAL_LABEL).toBe("分類總花費");
		expect(TRIP_MAX_BLOCK_ROWS).toBe(30);
	});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun run test`
Expected: FAIL — the new imports don't exist; other suites still pass.

- [ ] **Step 3: Implement in `src/conventions.ts`**

Mark the old constant deprecated (keep it exporting `2` — Task 2 deletes it):

```ts
/** @deprecated v2 single-row model — deleted in Task 2 with the finance-ops import swap. */
export const TRIP_CATEGORY_ROW = 2;
```

Around `TRIP_BLOCK_WIDTH`, make the trip section read:

```ts
/** Trip tabs: a block header row starts with these two cells, side by side. */
export const TRIP_HEADER_DATE = "日期";
export const TRIP_HEADER_SHOP = "店鋪";
/** A block's terminator row contains this substring (may be prefixed, e.g. 機票住宿分類總花費). */
export const TRIP_TOTAL_LABEL = "分類總花費";
/** Scan cap for blocks with no terminator row. */
export const TRIP_MAX_BLOCK_ROWS = 30;
/** Each block is 7 data columns (日期 店鋪 品項 支付方式 日幣原價 臺幣 臺幣進位) + 1 spacer. */
export const TRIP_BLOCK_WIDTH = 8;
```

Replace the `TRIP TABS` section of `CONVENTIONS_TEXT` with:

```
TRIP TABS — e.g. "2026/07/25 京都東京".
- A mosaic of category blocks in four column bands (A-G, I-O, Q-W, Z-AF), stacked vertically within each band.
- Each block: a header row (日期, 店鋪, 品項, 支付方式, 日幣原價, 臺幣…, 臺幣進位), the category name on the row below it, data rows, and usually a 分類總花費 total row.
- Known categories: 模型, 書, 餐(當下吃的), 機票住宿, 雜支, 衣服/鞋子, 吃的伴手禮, 紀念品小物, 交通, 送禮, 入場券, 電子產品.
- Entries are JPY-priced (¥ → TWD at ~0.22 plus a rounded-up column) or TWD-direct (機票住宿-style: 日幣原價 empty, 臺幣 holds the NTD amount).
- A budget-vs-actual summary occupies the bottom-right of the grid — it is not a category block.
- Never insert whole sheet rows in a trip tab: a row insert cuts across all bands and damages neighboring blocks. add_trip_entry writes into empty rows inside a block, or inserts cells scoped to the block's own columns.
```

- [ ] **Step 4: Run the conventions tests**

Run: `bun run test && bun run type-check`
Expected: full suite (55) PASS; type-check exit 0 (the deprecated constant still exists, so nothing breaks).

- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts test/conventions.test.ts
git commit -m "feat: mosaic trip-block conventions (removes TRIP_CATEGORY_ROW)"
```

---

### Task 2: `findTripBlocks` scanner

**Files:**
- Modify: `src/finance-ops.ts` (add scanner; also swap its conventions import from `TRIP_CATEGORY_ROW` to the new constants so the module compiles again), `test/finance-ops.test.ts` (new describe + shared fixture)

**Interfaces:**
- Consumes: `TRIP_HEADER_DATE`, `TRIP_HEADER_SHOP`, `TRIP_TOTAL_LABEL`, `TRIP_MAX_BLOCK_ROWS` from conventions.
- Produces:

```ts
export interface TripBlock {
	category: string;
	headerRow: number;    // 1-indexed
	startCol: number;     // 0-indexed band start
	firstDataRow: number; // headerRow + 2
	endRow: number;       // exclusive: 分類總花費 row, next header in the band, or firstDataRow + TRIP_MAX_BLOCK_ROWS
}
export function findTripBlocks(values: unknown[][]): TripBlock[]
```

**IMPORTANT ordering note:** the old `addTripEntry` still references `TRIP_CATEGORY_ROW` at this point. As part of this task: (a) in `src/finance-ops.ts`, change the conventions import to the new constants and replace the expression `values[TRIP_CATEGORY_ROW - 1] ?? []` in the old `addTripEntry` with `values[1] ?? []`, and its error message's `row ${TRIP_CATEGORY_ROW}` with `row 2` (temporary — Task 3 deletes that function body; the constant's value was 2, so v2 behavior is unchanged and the old trip tests keep passing); (b) DELETE the deprecated `TRIP_CATEGORY_ROW` export from `src/conventions.ts` in the same commit.

- [ ] **Step 1: Write the failing tests**

Append to `test/finance-ops.test.ts` (add `findTripBlocks` to the finance-ops import). This fixture is shared with Task 3 — place it at the top level of the file:

```ts
/**
 * Mosaic fixture mirroring the real trip tab: band A (cols 0-6) and band B
 * (cols 8-14); band B has two stacked blocks; a summary section at the
 * bottom that must never be detected as a block. Row = index+1.
 */
function mosaicGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["日期", "店鋪", "品項", "支付方式", "日幣原價", "臺幣 0.22 匯率", "臺幣 進位", "", "日期", "店鋪", "品項", "支付方式", "日幣原價", "臺幣", "臺幣進位"];
	g[1] = ["模型", "", "", "", "", "", "", "", "機票住宿"];
	g[2] = ["10/08", "Yodobashi", "鑷子", "Suica", 1373, "=E3*0.22", "=CEILING(F3)", "", "07/25", "", "去程機票", "已算在預算", "", 7849, 7849];
	g[3] = ["", "", "", "", "", "", "", "", "07/25", "", "回程機票", "已算在預算", "", 8173, 8173];
	// rows 4-5 empty in band A; row 5 empty in band B
	g[5] = ["", "", "", "分類總花費", "=SUM(E3:E5)", "", "=SUM(G3:G5)", "", "", "", "", "機票住宿分類總花費", "", "", "=SUM(O3:O5)"];
	// second block stacked in band B: header row 8, label row 9, ONE full data row 10, total row 11
	g[7] = ["", "", "", "", "", "", "", "", "日期", "店鋪", "品項", "支付方式", "日幣原價", "臺幣 0.22 匯率", "臺幣進位"];
	g[8] = ["", "", "", "", "", "", "", "", "電子產品"];
	g[9] = ["", "", "", "", "", "", "", "", "10/09", "ビックカメラ", "DJI", "Suica", 13900, "=M10*0.22", "=CEILING(N10)"];
	g[10] = ["", "", "", "", "", "", "", "", "", "", "", "分類總花費", "=SUM(M10:M10)", "", "=SUM(O10:O10)"];
	// summary section — not a block
	g[13] = ["本次總預算 粗估", "類別", "預算"];
	return g;
}

describe("findTripBlocks", () => {
	it("discovers stacked blocks across bands with correct geometry", () => {
		const blocks = findTripBlocks(mosaicGrid());
		expect(blocks).toEqual([
			{ category: "模型", headerRow: 1, startCol: 0, firstDataRow: 3, endRow: 6 },
			{ category: "機票住宿", headerRow: 1, startCol: 8, firstDataRow: 3, endRow: 6 },
			{ category: "電子產品", headerRow: 8, startCol: 8, firstDataRow: 10, endRow: 11 },
		]);
	});

	it("does not mistake the summary section for a block", () => {
		const blocks = findTripBlocks(mosaicGrid());
		expect(blocks.map((b) => b.category)).not.toContain("本次總預算 粗估");
	});

	it("skips a stray header row with no label beneath it", () => {
		const g = mosaicGrid();
		g[15] = ["日期", "店鋪"];
		expect(findTripBlocks(g)).toHaveLength(3);
	});

	it("caps a block with no terminator at TRIP_MAX_BLOCK_ROWS", () => {
		const g: unknown[][] = [];
		g[0] = ["日期", "店鋪", "品項", "支付方式", "日幣原價", "臺幣", "臺幣進位"];
		g[1] = ["雜支"];
		g[2] = ["07/25", "", "紅包", "已算在預算", 25000, 4945.23, 4946];
		const [block] = findTripBlocks(g);
		expect(block).toEqual({ category: "雜支", headerRow: 1, startCol: 0, firstDataRow: 3, endRow: 33 });
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test test/finance-ops.test.ts`
Expected: FAIL — `findTripBlocks` is not exported. Old trip tests still pass.

- [ ] **Step 3: Implement in `src/finance-ops.ts`**

Update the conventions import in `src/finance-ops.ts`: remove `TRIP_CATEGORY_ROW`, add `TRIP_HEADER_DATE, TRIP_HEADER_SHOP, TRIP_MAX_BLOCK_ROWS, TRIP_TOTAL_LABEL`. In the OLD `addTripEntry`, replace `values[TRIP_CATEGORY_ROW - 1] ?? []` with `values[1] ?? []` and change its error message's `row ${TRIP_CATEGORY_ROW}` to `row 2` (temporary; deleted in Task 3). Delete the deprecated `TRIP_CATEGORY_ROW` export from `src/conventions.ts`. Then add:

```ts
export interface TripBlock {
	category: string;
	headerRow: number;
	startCol: number;
	firstDataRow: number;
	endRow: number;
}

/** Discover trip category blocks: header row (日期+店鋪), label on the next row, region bounded by 分類總花費 / next header / scan cap. */
export function findTripBlocks(values: unknown[][]): TripBlock[] {
	const cell = (r: number, c: number) => String(values[r - 1]?.[c] ?? "").trim();

	const blocks: TripBlock[] = [];
	for (let r = 1; r <= values.length; r++) {
		const rowLen = (values[r - 1] ?? []).length;
		for (let c = 0; c < rowLen; c++) {
			if (cell(r, c) !== TRIP_HEADER_DATE || cell(r, c + 1) !== TRIP_HEADER_SHOP) continue;

			let category = "";
			for (let lc = c; lc < c + 7; lc++) {
				const v = cell(r + 1, lc);
				if (v !== "") {
					category = v;
					break;
				}
			}
			if (category === "") continue; // stray header with no label beneath

			const firstDataRow = r + 2;
			let endRow = firstDataRow + TRIP_MAX_BLOCK_ROWS;
			for (let br = firstDataRow; br < firstDataRow + TRIP_MAX_BLOCK_ROWS && br <= values.length; br++) {
				const band = Array.from({ length: 7 }, (_, i) => cell(br, c + i));
				if (band.some((v) => v.includes(TRIP_TOTAL_LABEL))) {
					endRow = br;
					break;
				}
				if (cell(br, c) === TRIP_HEADER_DATE && cell(br, c + 1) === TRIP_HEADER_SHOP) {
					endRow = br;
					break;
				}
			}
			blocks.push({ category, headerRow: r, startCol: c, firstDataRow, endRow });
		}
	}
	return blocks;
}
```

- [ ] **Step 4: Run tests**

Run: `bun run test && bun run type-check`
Expected: 59 tests PASS (55 + 4 new); type-check exit 0 (the `TRIP_CATEGORY_ROW` import is gone).

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: findTripBlocks mosaic scanner"
```

---

### Task 3: `addTripEntry` rewrite

**Files:**
- Modify: `src/finance-ops.ts` (replace `TripEntryParams` + `addTripEntry` entirely), `test/finance-ops.test.ts` (replace the old "addTripEntry" describe block and the old `tripGrid`/`tripClient` helpers with the new suite below)

**Interfaces:**
- Consumes: `findTripBlocks` (Task 2), `quoteTab`, `colLetter`, `adaptRowFormula`, `cellData`, `assertNotTruncated` (module-private, already present), conventions constants; `SheetsClient.readRange/getSheetId/batchUpdate/updateRange`.
- Produces: `addTripEntry(client, { tab, category, date, shop, item, paymentMethod, jpy?, twd? }): Promise<{ tab, category, row, updatedRange, currency: "JPY" | "TWD" }>`.

- [ ] **Step 1: Replace the old trip tests with the new suite**

Delete the old `tripGrid()`/`tripClient()` helpers and the entire old `describe("addTripEntry", ...)` block. Add:

```ts
function tripClient(grid: unknown[][]): SheetsClient {
	return {
		readRange: vi.fn(async () => ({ range: "x", values: grid, truncated: false })),
		getSheetId: vi.fn(async () => 111),
		batchUpdate: vi.fn(async () => ({ replies: [{}] })),
		updateRange: vi.fn(async () => ({ updatedRange: "written", updatedCells: 7 })),
	} as unknown as SheetsClient;
}

describe("addTripEntry (mosaic)", () => {
	it("writes a JPY entry into the first empty row, adapting the previous row's formulas", async () => {
		const client = tripClient(mosaicGrid());

		const result = await addTripEntry(client, {
			tab: "京都",
			category: "模型",
			date: "10/10",
			shop: "Volks",
			item: "N規小物",
			paymentMethod: "Suica",
			jpy: 2200,
		});

		// row 4 is the first empty band-A row; totals =SUM(E3:E5)/=SUM(G3:G5) already cover it
		expect((client.batchUpdate as any).mock.calls.length).toBe(0);
		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!A4:G4",
			[["10/10", "Volks", "N規小物", "Suica", 2200, "=E4*0.22", "=CEILING(F4)"]],
		]);
		expect(result).toMatchObject({ category: "模型", row: 4, currency: "JPY" });
	});

	it("writes a TWD-direct entry with an empty ¥ cell and a CEILING round", async () => {
		const client = tripClient(mosaicGrid());

		const result = await addTripEntry(client, {
			tab: "京都",
			category: "機票住宿",
			date: "08/01",
			shop: "",
			item: "回程補付",
			paymentMethod: "已算在預算",
			twd: 1500,
		});

		expect((client.batchUpdate as any).mock.calls.length).toBe(0);
		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!I5:O5",
			[["08/01", "", "回程補付", "已算在預算", "", 1500, "=CEILING(N5)"]],
		]);
		expect(result).toMatchObject({ category: "機票住宿", row: 5, currency: "TWD" });
	});

	it("extends a total whose SUM range does not cover the target row", async () => {
		const g = mosaicGrid();
		g[5] = ["", "", "", "分類總花費", "=SUM(E3:E3)", "", "=SUM(G3:G3)", "", "", "", "", "機票住宿分類總花費", "", "", "=SUM(O3:O5)"];
		const client = tripClient(g);

		await addTripEntry(client, {
			tab: "京都",
			category: "模型",
			date: "10/10",
			shop: "x",
			item: "y",
			paymentMethod: "Suica",
			jpy: 100,
		});

		expect((client.batchUpdate as any).mock.calls[0][0]).toEqual([
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 5, columnIndex: 4 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=SUM(E3:E4)" } }] }],
					fields: "userEnteredValue",
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 5, columnIndex: 6 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=SUM(G3:G4)" } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect((client.updateRange as any).mock.calls[0][0]).toBe("'京都'!A4:G4");
	});

	it("inserts band-scoped cells when the block is full and rewrites its totals", async () => {
		const client = tripClient(mosaicGrid());

		const result = await addTripEntry(client, {
			tab: "京都",
			category: "電子產品",
			date: "10/10",
			shop: "Sofmap",
			item: "SSD",
			paymentMethod: "Suica",
			jpy: 9800,
		});

		expect((client.batchUpdate as any).mock.calls[0][0]).toEqual([
			{
				insertRange: {
					range: { sheetId: 111, startRowIndex: 10, endRowIndex: 11, startColumnIndex: 8, endColumnIndex: 15 },
					shiftDimension: "ROWS",
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 11, columnIndex: 12 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=SUM(M10:M11)" } }] }],
					fields: "userEnteredValue",
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 11, columnIndex: 14 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=SUM(O10:O11)" } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!I11:O11",
			[["10/10", "Sofmap", "SSD", "Suica", 9800, "=M11*0.22", "=CEILING(N11)"]],
		]);
		expect(result).toMatchObject({ category: "電子產品", row: 11, currency: "JPY" });
	});

	it("fails closed when a full block's total is not a plain SUM", async () => {
		const g = mosaicGrid();
		g[10] = ["", "", "", "", "", "", "", "", "", "", "", "分類總花費", "=SUM(M10:M10)+1", "", "=SUM(O10:O10)"];
		const client = tripClient(g);

		await expect(
			addTripEntry(client, { tab: "京都", category: "電子產品", date: "x", shop: "x", item: "x", paymentMethod: "x", jpy: 1 }),
		).rejects.toThrow("cannot safely extend");
		expect((client.batchUpdate as any).mock.calls.length).toBe(0);
		expect((client.updateRange as any).mock.calls.length).toBe(0);
	});

	it("requires exactly one of jpy and twd", async () => {
		const client = tripClient(mosaicGrid());
		const base = { tab: "京都", category: "模型", date: "x", shop: "x", item: "x", paymentMethod: "x" };
		await expect(addTripEntry(client, { ...base })).rejects.toThrow("exactly one");
		await expect(addTripEntry(client, { ...base, jpy: 1, twd: 1 })).rejects.toThrow("exactly one");
		expect((client.updateRange as any).mock.calls.length).toBe(0);
	});

	it("names every discovered category when the block is missing", async () => {
		const client = tripClient(mosaicGrid());
		await expect(
			addTripEntry(client, { tab: "京都", category: "食物", date: "x", shop: "x", item: "x", paymentMethod: "x", jpy: 1 }),
		).rejects.toThrow("模型, 機票住宿, 電子產品");
	});

	it("refuses to operate on a truncated read", async () => {
		const grid = mosaicGrid();
		const client = tripClient(grid);
		(client.readRange as any).mockResolvedValue({ range: "x", values: grid, truncated: true });
		await expect(
			addTripEntry(client, { tab: "京都", category: "模型", date: "x", shop: "x", item: "x", paymentMethod: "x", jpy: 1 }),
		).rejects.toThrow("truncated");
		expect((client.updateRange as any).mock.calls.length).toBe(0);
	});
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun run test test/finance-ops.test.ts`
Expected: FAIL — old `addTripEntry` signature/behavior doesn't match (e.g. `jpy` required, no mosaic discovery).

- [ ] **Step 3: Replace `TripEntryParams` + `addTripEntry` in `src/finance-ops.ts`**

```ts
export interface TripEntryParams {
	tab: string;
	category: string;
	date: string;
	shop: string;
	item: string;
	paymentMethod: string;
	jpy?: number;
	twd?: number;
}

const TRIP_READ = "A1:AL200";
/** Plain single-column SUM range, e.g. =SUM(M10:M12). */
const PLAIN_SUM_RANGE_RE = /^=SUM\(([A-Z]{1,2})(\d+):\1(\d+)\)$/i;

export async function addTripEntry(client: SheetsClient, p: TripEntryParams) {
	if ((p.jpy === undefined) === (p.twd === undefined)) {
		throw new Error("Provide exactly one of jpy or twd for a trip entry.");
	}

	const { values, truncated } = await client.readRange(`${quoteTab(p.tab)}!${TRIP_READ}`, "FORMULA");
	assertNotTruncated(truncated, p.tab, TRIP_READ);

	const blocks = findTripBlocks(values);
	const block = blocks.find((b) => b.category === p.category.trim());
	if (!block) {
		throw new Error(
			`Category block "${p.category}" not found in ${p.tab}. Blocks present: ${blocks.map((b) => b.category).join(", ")}`,
		);
	}
	const { startCol, firstDataRow, endRow } = block;
	const cellStr = (r: number, c: number) => String(values[r - 1]?.[c] ?? "").trim();

	// The block's 分類總花費 row (endRow when terminated by one) and its two total cells.
	const totalRow = Array.from({ length: 7 }, (_, i) => cellStr(endRow, startCol + i)).some((v) =>
		v.includes(TRIP_TOTAL_LABEL),
	)
		? endRow
		: null;
	const totals = (totalRow === null ? [] : [4, 6]).map((off) => {
		const formula = cellStr(totalRow!, startCol + off);
		const m = formula.match(PLAIN_SUM_RANGE_RE);
		return {
			col: startCol + off,
			formula,
			parsed: m ? { col: m[1], a: Number(m[2]), b: Number(m[3]) } : null,
		};
	});

	// Target: first fully-empty band row inside the region.
	let targetRow: number | null = null;
	for (let r = firstDataRow; r < endRow; r++) {
		if (Array.from({ length: 7 }, (_, i) => cellStr(r, startCol + i)).every((v) => v === "")) {
			targetRow = r;
			break;
		}
	}

	const insertNeeded = targetRow === null;
	if (insertNeeded) {
		if (totalRow === null) {
			throw new Error(
				`Block "${p.category}" in ${p.tab} is full and has no ${TRIP_TOTAL_LABEL} row to anchor a safe cell insert — add rows to it manually.`,
			);
		}
		for (const t of totals) {
			if (t.formula.startsWith("=") && t.parsed === null) {
				throw new Error(
					`Block "${p.category}" is full and its total formula "${t.formula}" is not a plain =SUM(range) — cannot safely extend it. Add a row to the block manually.`,
				);
			}
		}
		targetRow = totalRow;
	}
	const row = targetRow!;

	// Totals whose SUM range doesn't cover the new row get rewritten.
	const rewrites = totals.filter((t) => t.parsed !== null && (row < t.parsed.a || row > t.parsed.b));

	if (insertNeeded || rewrites.length > 0) {
		const sheetId = await client.getSheetId(p.tab);
		const requests: object[] = [];
		if (insertNeeded) {
			requests.push({
				insertRange: {
					range: {
						sheetId,
						startRowIndex: row - 1,
						endRowIndex: row,
						startColumnIndex: startCol,
						endColumnIndex: startCol + 7,
					},
					shiftDimension: "ROWS",
				},
			});
		}
		for (const t of rewrites) {
			const a = Math.min(t.parsed!.a, row);
			const b = Math.max(t.parsed!.b, row);
			// A cell insert at `row` shifts the total row itself down by one.
			const totalRowFinal = insertNeeded ? totalRow! + 1 : totalRow!;
			requests.push({
				updateCells: {
					start: { sheetId, rowIndex: totalRowFinal - 1, columnIndex: t.col },
					rows: [{ values: [cellData(`=SUM(${t.parsed!.col}${a}:${t.parsed!.col}${b})`)] }],
					fields: "userEnteredValue",
				},
			});
		}
		await client.batchUpdate(requests);
	}

	// Conversion columns: adapt the row above's formulas for JPY entries; TWD entries are direct.
	const jpyCol = colLetter(startCol + 4);
	const twdCol = colLetter(startCol + 5);
	let twdValue: string | number;
	let roundFormula = `=CEILING(${twdCol}${row})`;
	if (p.twd !== undefined) {
		twdValue = p.twd;
	} else {
		twdValue = `=${jpyCol}${row}*0.22`;
		const prevRow = row - 1;
		if (prevRow >= firstDataRow) {
			const prevTwd = cellStr(prevRow, startCol + 5);
			const prevRound = cellStr(prevRow, startCol + 6);
			if (prevTwd.startsWith("=")) twdValue = adaptRowFormula(prevTwd, prevRow, row);
			if (prevRound.startsWith("=")) roundFormula = adaptRowFormula(prevRound, prevRow, row);
		}
	}

	const range = `${quoteTab(p.tab)}!${colLetter(startCol)}${row}:${colLetter(startCol + 6)}${row}`;
	const result = await client.updateRange(range, [
		[p.date, p.shop, p.item, p.paymentMethod, p.jpy ?? "", twdValue, roundFormula],
	]);
	return {
		tab: p.tab,
		category: block.category,
		row,
		updatedRange: result.updatedRange,
		currency: p.jpy !== undefined ? ("JPY" as const) : ("TWD" as const),
	};
}
```

Note on partial-failure ordering: the batchUpdate (insert + total rewrites) runs before the entry write on purpose — if the entry write then fails, the extended SUM merely covers an empty row (adds 0), a harmless, visible state.

- [ ] **Step 4: Run tests**

Run: `bun run test && bun run type-check`
Expected: 63 tests PASS (59 − 4 old trip tests + 8 new); type-check exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: mosaic-aware addTripEntry with TWD entries and band-scoped inserts"
```

---

### Task 4: Tool schema + README

**Files:**
- Modify: `src/tools.ts` (add_trip_entry registration only), `README.md`

**Interfaces:**
- Consumes: the new `addTripEntry` params (jpy/twd optional).

- [ ] **Step 1: Update the `add_trip_entry` registration in `src/tools.ts`**

Replace it with:

```ts
	server.tool(
		"add_trip_entry",
		"Log a purchase into a trip tab (e.g. 2026/07/25 京都東京). Finds the category block anywhere in the tab's mosaic layout (模型, 書, 餐(當下吃的), 機票住宿, 雜支, 衣服/鞋子, 吃的伴手禮, 紀念品小物, 交通, 送禮, 入場券, 電子產品, ...), writes into the block's first empty row — inserting block-scoped cells if it is full — and keeps the 分類總花費 totals covering the new entry. Provide EXACTLY ONE of jpy (¥-priced purchase) or twd (NTD-direct row, 機票住宿-style).",
		{
			tab: z.string().min(1).describe("Trip tab name, exactly as it appears"),
			category: z.string().min(1).describe("Block title, e.g. 模型 or 電子產品"),
			date: z.string().min(1).describe("Date/time as you write it, e.g. 10/08 16:03"),
			shop: z.string().describe("Store name (may be empty)"),
			item: z.string().min(1).describe("What was bought"),
			payment_method: z.string().describe("e.g. Suica, 現金, 信用卡, 已算在預算"),
			jpy: z.number().optional().describe("Price in Japanese yen — exactly one of jpy/twd"),
			twd: z.number().optional().describe("Price in NTD for TWD-direct rows — exactly one of jpy/twd"),
		},
		async ({ tab, category, date, shop, item, payment_method, jpy, twd }) => {
			try {
				return ok(await addTripEntry(client, { tab, category, date, shop, item, paymentMethod: payment_method, jpy, twd }));
			} catch (e) {
				return toError(e);
			}
		},
	);
```

- [ ] **Step 2: Update README's `add_trip_entry` line** to mention mosaic discovery and jpy/twd.

- [ ] **Step 3: Verify**

Run: `bun run test && bun run type-check`
Expected: 63 tests PASS; exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/tools.ts README.md
git commit -m "feat: add_trip_entry schema for mosaic categories and TWD entries"
```

---

### Task 5: Integration, merge, ship

- [ ] **Step 1: Local integration (user-driven, against the COPY sheet's trip tab)**

`bun run dev` + `bunx @modelcontextprotocol/inspector` → connect → verify:
1. `add_trip_entry` error with `category: "不存在"` lists ~12 real categories.
2. JPY entry into a stacked block (`電子產品` — full block: verify the band-scoped insert shifts only that band; neighbors intact; 分類總花費 updates).
3. TWD entry into `機票住宿` (¥ cell empty, NTD written, total updates).
4. Entry into a roomy block (`模型`) lands in the first empty row with working conversion formulas.
5. Clean up test rows in the copy sheet.

- [ ] **Step 2: Final review, merge, ship**

Whole-branch review → merge `trip-blocks` into `main` → `bun run test` on main → push (CI) → `bun run deploy` (until Workers Builds is connected) → toggle the Claude web connector → acceptance: add a real purchase to a previously unreachable category.
