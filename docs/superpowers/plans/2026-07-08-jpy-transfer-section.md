# 乾坤大挪移（日幣）NTD→JPY Transfer Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `add_transfer` gains `currency: "jpy"`, logging NTD→JPY exchanges into a new 乾坤大挪移 section on the trip tab (columns A–G) and wiring each entry's NTD side into the right month tab's 銀行餘額 formulas.

**Architecture:** The existing `addTransfer` in `src/finance-ops.ts` is refactored around a per-currency section config (columns, grid read range, GOOGLEFINANCE pair). The USD branch keeps today's behavior byte-for-byte. The JPY branch targets a trip tab, uses **block-scoped cell inserts** (whole-row inserts are forbidden on trip tabs — they slice the mosaic of column bands), stamps canonical number formats, then appends per-entry cross-tab terms into three month-tab formulas.

**Tech Stack:** TypeScript on Cloudflare Workers (wrangler), zod tool schemas (MCP), vitest with hand-mocked `SheetsClient`. Use `bun` for everything (`bun run test`, `bun run type-check`) — never npm.

**Spec:** `docs/superpowers/specs/2026-07-08-jpy-transfer-section-design.md`

## Global Constraints

- Never insert whole sheet rows in a trip tab (`src/conventions.ts` rule): use `insertRange` scoped to the section's columns with `shiftDimension: "ROWS"`.
- Existing `add_transfer` calls (no `currency`, or `currency: "usd"`) must behave byte-for-byte as today; the existing addTransfer tests must pass unmodified except where a test file helper is explicitly extended.
- All sheet sections are located by label anchor (`findRowByValue`), never by fixed row numbers.
- Month-formula wiring is **append-only**: read the existing formula, verify it starts with `=`, append the term. Never rebuild a formula.
- Commit after every task; commit author is `niuee <vntchang@gmail.com>`.
- The live sheet is NOT touched by any task except Task 5 (dev copy only). Prod section creation happens after merge, outside this plan.

## Reference: live-verified wiring targets (7 月, prod)

The USD 總和 (row 42 today) feeds exactly these NTD-side formulas (labels in column B, values in column D):

| label | live formula (7月) | USD term | JPY per-entry term |
|---|---|---|---|
| 本月新臺幣支出 | `=SUMIF(F3:F34,"TWD",E3:E34)+M42` | `+M42` (see note) | `+'{trip}'!G{row}` |
| 保守預計本月底新臺幣餘額 | `=D60+D57-D58-I42+IF(R42>0, 0, R42)+E4` | `-I42` | `-'{trip}'!B{row}` |
| 本月底新臺幣餘額 | `=D60+D57-D58-I42+D59+E4` | `-I42` | `-'{trip}'!B{row}` |

Note: the live `+M42` in 本月新臺幣支出 points at the 手續費 sum, not the
當筆總額外花費 sum (`N42`) the conventions describe — a pre-existing sheet
discrepancy flagged to Vincent separately. The JPY branch wires the
**extra column G** (匯差+手續費), per the approved spec.

---

### Task 1: Per-currency section config + generalized finder

**Files:**
- Modify: `src/conventions.ts` (after the `TRANSFER_COLS` block, ~line 226)
- Modify: `src/finance-ops.ts:194-224` (`TRANSFER_GRID_READ`, `findTransferSection`)
- Test: `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: existing `TRANSFER_COLS`, `TRANSFER_SECTION_LABEL`, `TRANSFER_TOTAL_LABEL`, `findRowByValue`, `colLetter`.
- Produces:
  - `TRANSFER_JPY_COLS` (conventions.ts): `{ date: 0, ntd: 1, spot: 2, actual: 3, spread: 4, fee: 5, extra: 6 }` (columns A–G).
  - `TRANSFER_JPY_HEADERS` (conventions.ts): `["日期", "新臺幣", "當下日幣", "實際日幣", "匯差", "手續費", "當筆總額外花費"]`.
  - `TransferSectionConfig` and `TRANSFER_SECTIONS` (finance-ops.ts): `TRANSFER_SECTIONS.usd` / `TRANSFER_SECTIONS.jpy`, each `{ cols: { date, ntd, spot, actual, spread, fee, extra }, gridRead: string, pair: "USDTWD" | "JPYTWD", missingHint: string }`.
  - `findTransferSection(values, tab, cfg?)` — third param defaults to `TRANSFER_SECTIONS.usd`; returns `{ headerRow, totalRow }` as today.

- [ ] **Step 1: Write the failing tests**

Append to the `describe("addTransfer", ...)` region's neighborhood in `test/finance-ops.test.ts` (import `findTransferSection` and `TRANSFER_SECTIONS` from `../src/finance-ops`):

```ts
/** A trip-tab grid whose JPY transfer section sits at A69 (title), A70 (header), A71 (one empty data row), A72 (總和). */
function jpyTransferGrid(): unknown[][] {
	const g: unknown[][] = [];
	for (let r = 0; r < 75; r++) g.push([]);
	g[68] = ["乾坤大挪移"];
	g[69] = ["日期", "新臺幣", "當下日幣", "實際日幣", "匯差", "手續費", "當筆總額外花費"];
	g[71] = ["總和", "=sum(B71)", "=sum(C71)", "=sum(D71)", "=sum(E71)", "=sum(F71)", "=sum(G71)"];
	return g;
}

describe("findTransferSection (jpy config)", () => {
	it("finds the trip-tab section anchored in column A", () => {
		const s = findTransferSection(jpyTransferGrid(), "2026/07/25 京都東京", TRANSFER_SECTIONS.jpy);
		expect(s).toEqual({ headerRow: 70, totalRow: 72 });
	});

	it("throws the trip-tab hint when the section is missing", () => {
		expect(() => findTransferSection([[]], "2026/07/25 京都東京", TRANSFER_SECTIONS.jpy)).toThrow(
			/乾坤大挪移.*trip tab/,
		);
	});

	it("still finds the month-tab USD section by default", () => {
		const s = findTransferSection(transferGrid(), "9 月");
		expect(s).toEqual({ headerRow: 34, totalRow: 36 });
	});
});
```

(`transferGrid()` already exists in the test file for the USD tests; check its shape — if its header/total rows differ from 34/36, use the rows it actually encodes.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun run test -- finance-ops`
Expected: FAIL — `TRANSFER_SECTIONS` is not exported / `findTransferSection` does not accept a third argument. Existing tests still pass.

- [ ] **Step 3: Implement**

In `src/conventions.ts`, directly after the `TRANSFER_COLS` const (keep its JSDoc style):

```ts
/**
 * 乾坤大挪移（日幣）— the NTD→JPY transfer log on TRIP tabs (from the
 * 2026/07/25 京都東京 trip on), columns A–G below all trip content. Same
 * anatomy as the USD section; the JPY received is trip cash and has no
 * bank ledger — only the NTD side wires into the monthly 銀行餘額 block,
 * per entry (see addTransfer).
 */
export const TRANSFER_JPY_COLS = {
	/** A — 日期; also the column of the section title and the 總和 label. */
	date: 0,
	/** B — 新臺幣 debited from the bank. */
	ntd: 1,
	/** C — 當下日幣 = 新臺幣 / spot rate, pinned at entry time. */
	spot: 2,
	/** D — 實際日幣: the JPY that actually arrived. */
	actual: 3,
	/** E — 匯差 in NTD = (當下日幣 − 實際日幣) × the pinned rate. */
	spread: 4,
	/** F — 手續費 in NTD. */
	fee: 5,
	/** G — 當筆總額外花費 = 匯差 + 手續費. */
	extra: 6,
} as const;

/** Header row of the JPY section, left to right from TRANSFER_JPY_COLS.date. */
export const TRANSFER_JPY_HEADERS = [
	"日期",
	"新臺幣",
	"當下日幣",
	"實際日幣",
	"匯差",
	"手續費",
	"當筆總額外花費",
] as const;
```

In `src/finance-ops.ts`, replace the `TRANSFER_GRID_READ` const + `findTransferSection` (lines ~194-224) with:

```ts
/** The 乾坤大挪移 section spans H–N, wider than GRID_READ — read the full width. */
export const TRANSFER_GRID_READ = "A1:N60";
/** The trip tab's JPY section lives in A–G below all trip content (~row 72 today) — generous headroom. */
export const TRANSFER_JPY_GRID_READ = "A1:G200";

/** Per-currency shape of a 乾坤大挪移 section: where it lives and how its rate is pinned. */
export interface TransferSectionConfig {
	cols: { date: number; ntd: number; spot: number; actual: number; spread: number; fee: number; extra: number };
	gridRead: string;
	/** GOOGLEFINANCE currency pair, e.g. "USDTWD". */
	pair: "USDTWD" | "JPYTWD";
	/** Appended to the missing-section error. */
	missingHint: string;
}

export const TRANSFER_SECTIONS: { usd: TransferSectionConfig; jpy: TransferSectionConfig } = {
	usd: {
		cols: {
			date: TRANSFER_COLS.date,
			ntd: TRANSFER_COLS.ntd,
			spot: TRANSFER_COLS.spotUsd,
			actual: TRANSFER_COLS.actualUsd,
			spread: TRANSFER_COLS.spread,
			fee: TRANSFER_COLS.fee,
			extra: TRANSFER_COLS.extra,
		},
		gridRead: TRANSFER_GRID_READ,
		pair: "USDTWD",
		missingHint: "the transfer log exists from 7月 2026 on.",
	},
	jpy: {
		cols: TRANSFER_JPY_COLS,
		gridRead: TRANSFER_JPY_GRID_READ,
		pair: "JPYTWD",
		missingHint: "the NTD→JPY log lives on the trip tab — create the section (title/header/總和, columns A–G, below all trip content) before logging.",
	},
};

export interface TransferSection {
	/** 1-indexed row of the 日期/新臺幣/… header. */
	headerRow: number;
	/** 1-indexed row of the 總和 totals. */
	totalRow: number;
}

/** Locate a 乾坤大挪移 block (FORMULA-render grid of cfg.gridRead). Throws when absent or malformed. */
export function findTransferSection(
	values: unknown[][],
	tab: string,
	cfg: TransferSectionConfig = TRANSFER_SECTIONS.usd,
): TransferSection {
	const dateCol = cfg.cols.date;
	const anchorRow = findRowByValue(values, dateCol, TRANSFER_SECTION_LABEL);
	if (anchorRow === null) {
		throw new Error(
			`No ${TRANSFER_SECTION_LABEL} section in ${tab} (searched column ${colLetter(dateCol)} of ${cfg.gridRead}) — ${cfg.missingHint}`,
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

Add `TRANSFER_JPY_COLS` (and `TRANSFER_JPY_HEADERS` if used) to the conventions import list at the top of `finance-ops.ts` (the block importing `TRANSFER_COLS` etc., ~line 69).

The word "jpy" changes the missing-section message for the USD path too — it now ends with `cfg.missingHint` instead of the inline text. The old text is preserved verbatim as `TRANSFER_SECTIONS.usd.missingHint`, so the existing test asserting `/乾坤大挪移/` keeps passing.

- [ ] **Step 4: Run the full suite + type check**

Run: `bun run test && bun run type-check`
Expected: PASS (all existing tests untouched; three new tests green).

- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts src/finance-ops.ts test/finance-ops.test.ts
git commit -m "refactor: config-driven 乾坤大挪移 section finder (USD + trip-tab JPY shapes)" --author="niuee <vntchang@gmail.com>"
```

---

### Task 2: addTransfer JPY branch — params, validation, write path

**Files:**
- Modify: `src/finance-ops.ts` (`AddTransferParams` + `addTransfer`, ~lines 909-1050)
- Test: `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: `TRANSFER_SECTIONS`, `findTransferSection(values, tab, cfg)` from Task 1; existing `cellData`, `colLetter`, `quoteTab`, `parseDateInput`, `todaySerial`, `serialToIso`, `assertNotTruncated`, `monthTabName`, `currentMonthTab`.
- Produces: `addTransfer(client, p)` accepting
  ```ts
  export interface AddTransferParams {
  	/** Which transfer log to write; default "usd". */
  	currency?: "usd" | "jpy";
  	/** Trip tab name, exactly as it appears — jpy only. */
  	tab?: string;
  	/** NTD debited from the bank (新臺幣). */
  	ntd: number;
  	/** USD that actually arrived (實際美金) — usd only. */
  	usd?: number;
  	/** JPY that actually arrived (實際日幣) — jpy only. */
  	jpy?: number;
  	/** 手續費 in NTD. */
  	fee: number;
  	/** M/D, MM/DD, YYYY/M/D, or YYYY-MM-DD; omitted = today in Taipei. */
  	date?: string;
  	/** usd only. */
  	month?: number;
  }
  ```
  JPY return shape after this task: `{ tab, row, inserted, date, ntd, jpy, rate, spotJpy, spread, fee, extraCost }`. Task 3 adds `wiredMonthTab` — do not reference it in this task.
- Task 3 relies on: the JPY branch computing `monthTab` from the entry date (`serialToIso(dateSerialValue).slice(5, 7)` → number → `monthTabName(n)`) and the final written row number.

- [ ] **Step 1: Write the failing tests**

Add to `test/finance-ops.test.ts` (the `transferClient` helper already returns the grid for ranged reads and the rate for single-cell reads — reuse it):

```ts
describe("addTransfer (jpy)", () => {
	const TRIP = "2026/07/25 京都東京";

	it("validates the param combination up front", async () => {
		const client = transferClient(jpyTransferGrid());
		await expect(addTransfer(client, { currency: "jpy", ntd: 20000, jpy: 90000, fee: 30 } as any)).rejects.toThrow(
			/tab/,
		);
		await expect(
			addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 20000, usd: 700, jpy: 90000, fee: 30 } as any),
		).rejects.toThrow(/usd/);
		await expect(
			addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 20000, jpy: 90000, fee: 30, month: 7 } as any),
		).rejects.toThrow(/month/);
		await expect(addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 20000, fee: 30 } as any)).rejects.toThrow(
			/jpy/,
		);
		// usd branch untouched: tab/jpy are rejected there
		await expect(addTransfer(client, { tab: TRIP, ntd: 20000, usd: 700, fee: 30 } as any)).rejects.toThrow(/tab/);
		expect((client.readRange as any).mock.calls).toHaveLength(0);
	});

	it("writes into the first empty A–G row with the JPYTWD rate pinned and formats stamped", async () => {
		const client = transferClient(jpyTransferGrid(), 0.208);
		const result = await addTransfer(client, {
			currency: "jpy",
			tab: TRIP,
			ntd: 20800,
			jpy: 99000,
			fee: 150,
			date: "7/10",
		});

		expect((client.readRange as any).mock.calls[0]).toEqual([`'${TRIP}'!A1:G200`, "FORMULA"]);
		// batch 1: scratch GOOGLEFINANCE into C71 (first empty data row), no insert
		const batch1 = (client.batchUpdate as any).mock.calls[0][0];
		expect(batch1).toHaveLength(1);
		expect(batch1[0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 70, columnIndex: 2 });
		expect(batch1[0].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			formulaValue: '=GOOGLEFINANCE("CURRENCY:JPYTWD")',
		});
		expect((client.readRange as any).mock.calls[1]).toEqual([`'${TRIP}'!C71`, "UNFORMATTED_VALUE"]);

		// batch 2: formats, 日期, entry row, 總和 rewrite
		const batch2 = (client.batchUpdate as any).mock.calls[1][0];
		const repeats = batch2.filter((r: any) => r.repeatCell);
		expect(repeats).toHaveLength(4); // A date, C:D ¥, B NTD, E:G NTD (B and E:G are not contiguous)
		expect(repeats[0].repeatCell.cell.userEnteredFormat.numberFormat).toEqual({
			type: "DATE",
			pattern: "mm/dd",
		});
		const updates = batch2.filter((r: any) => r.updateCells);
		const rowCells = updates.find((u: any) => u.updateCells.start.columnIndex === 1 && u.updateCells.start.rowIndex === 70);
		expect(rowCells.updateCells.rows[0].values.map((v: any) => v.userEnteredValue)).toEqual([
			{ numberValue: 20800 }, // B 新臺幣
			{ formulaValue: "=B71/0.208" }, // C 當下日幣 (pinned)
			{ numberValue: 99000 }, // D 實際日幣
			{ formulaValue: "=(C71-D71)*0.208" }, // E 匯差 (pinned)
			{ numberValue: 150 }, // F 手續費
			{ formulaValue: "=E71+F71" }, // G 當筆總額外花費
		]);
		const sums = updates.find((u: any) => u.updateCells.start.rowIndex === 71 && u.updateCells.start.columnIndex === 1);
		expect(sums.updateCells.rows[0].values.map((v: any) => v.userEnteredValue.formulaValue)).toEqual([
			"=SUM(B71:B71)",
			"=SUM(C71:C71)",
			"=SUM(D71:D71)",
			"=SUM(E71:E71)",
			"=SUM(F71:F71)",
			"=SUM(G71:G71)",
		]);

		// 20800 − 99000×0.208 = 208 spread; +150 fee = 358
		expect(result).toMatchObject({
			tab: TRIP,
			row: 71,
			inserted: false,
			date: "2026-07-10",
			ntd: 20800,
			jpy: 99000,
			rate: 0.208,
			spread: 208,
			fee: 150,
			extraCost: 358,
		});
		expect(result.spotJpy).toBeCloseTo(100000, 2);
	});

	it("inserts A–G-scoped cells (never a whole row) when the section is full", async () => {
		const grid = jpyTransferGrid();
		grid[70] = [46266, 20000, "=B71/0.21", 95000, "=(C71-D71)*0.21", 100, "=E71+F71"];
		const client = transferClient(grid, 0.208);
		const result = await addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 10000, jpy: 47000, fee: 50, date: "7/12" });

		const batch1 = (client.batchUpdate as any).mock.calls[0][0];
		expect(batch1[0].insertRange).toEqual({
			range: { sheetId: 111, startRowIndex: 71, endRowIndex: 72, startColumnIndex: 0, endColumnIndex: 7 },
			shiftDimension: "ROWS",
		});
		expect(batch1.some((r: any) => r.insertDimension)).toBe(false);
		expect(result).toMatchObject({ row: 72, inserted: true });
		const batch2 = (client.batchUpdate as any).mock.calls[1][0];
		const sums = batch2.find((u: any) => u.updateCells?.start.rowIndex === 72 && u.updateCells?.start.columnIndex === 1);
		expect(sums.updateCells.rows[0].values[0].userEnteredValue).toEqual({ formulaValue: "=SUM(B71:B72)" });
	});

	it("fails and clears the scratch cell when GOOGLEFINANCE is not numeric", async () => {
		const client = transferClient(jpyTransferGrid(), "#N/A");
		await expect(addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 100, jpy: 400, fee: 0 })).rejects.toThrow(
			"JPYTWD",
		);
		const calls = (client.batchUpdate as any).mock.calls;
		expect(calls[1][0][0].updateCells.rows[0].values).toEqual([{}]);
	});

	it("refuses when the trip tab has no section, with the create-it hint", async () => {
		const client = transferClient([[]]);
		await expect(addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 100, jpy: 400, fee: 0 })).rejects.toThrow(
			/trip tab/,
		);
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});
});
```

Note on `transferClient`: its ranged-vs-single-cell dispatch is `range.includes(":")` — `'…'!C71` has no colon, so the rate read path already works for JPY. Do not modify the helper.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- finance-ops`
Expected: the new `addTransfer (jpy)` tests FAIL (validation errors not thrown, jpy branch missing). All others PASS.

- [ ] **Step 3: Implement the JPY branch**

In `src/finance-ops.ts`, replace `AddTransferParams` with the interface from **Interfaces** above, then restructure `addTransfer`:

```ts
export async function addTransfer(client: SheetsClient, p: AddTransferParams) {
	const currency = p.currency ?? "usd";
	if (currency === "jpy") {
		if (!p.tab) throw new Error("currency:'jpy' logs into a trip tab — provide tab (e.g. 2026/07/25 京都東京).");
		if (p.jpy === undefined) throw new Error("currency:'jpy' needs jpy (實際日幣 that actually arrived).");
		if (p.usd !== undefined) throw new Error("currency:'jpy' takes jpy, not usd.");
		if (p.month !== undefined) {
			throw new Error("currency:'jpy' derives the wiring month from date — month is not accepted.");
		}
	} else {
		if (p.usd === undefined) throw new Error("usd (實際美金 that actually arrived) is required.");
		if (p.jpy !== undefined) throw new Error("jpy is only valid with currency:'jpy'.");
		if (p.tab !== undefined) throw new Error("tab is only valid with currency:'jpy' — usd transfers target a month tab (use month).");
	}
	const cfg = TRANSFER_SECTIONS[currency];
	const tab = currency === "jpy" ? p.tab! : p.month !== undefined ? monthTabName(p.month) : currentMonthTab();
	const received = currency === "jpy" ? p.jpy! : p.usd!;
	// Parse before any read/write so a bad date fails closed.
	const dateSerialValue = p.date !== undefined ? parseDateInput(p.date) : todaySerial();
	...
}
```

The body then follows today's flow with `cfg.cols` in place of `TRANSFER_COLS` and `cfg.pair` in the GOOGLEFINANCE formula/error, plus two divergences:

1. **Full-section insert.** Where the USD branch pushes `insertDimension` (whole row, `inheritFromBefore: true`), branch on currency:

```ts
	if (targetRow === null) {
		targetRow = totalRow;
		finalTotalRow = totalRow + 1;
		scratchRequests.push(
			currency === "jpy"
				? {
						// Trip tabs are a mosaic of column bands — never insert whole rows
						// (conventions.ts); shift only this section's own columns.
						insertRange: {
							range: {
								sheetId,
								startRowIndex: targetRow - 1,
								endRowIndex: targetRow,
								startColumnIndex: cfg.cols.date,
								endColumnIndex: cfg.cols.extra + 1,
							},
							shiftDimension: "ROWS",
						},
					}
				: {
						insertDimension: {
							range: { sheetId, dimension: "ROWS", startIndex: targetRow - 1, endIndex: targetRow },
							inheritFromBefore: true,
						},
					},
		);
	}
```

2. **Format stamping (jpy only).** Cells created by `insertRange` (or never-formatted empties at the sheet bottom) carry no format. Before the value writes in the second `batchUpdate`, prepend three `repeatCell` requests when `currency === "jpy"` (mirroring `addTripEntry`'s `formatCell`, finance-ops.ts:1913-1928):

```ts
	const jpyFormatRequests =
		currency !== "jpy"
			? []
			: [
					formatRepeat(cfg.cols.date, { numberFormat: { type: "DATE", pattern: "mm/dd" } }, 1),
					formatRepeat(cfg.cols.spot, { numberFormat: { type: "CURRENCY", pattern: "[$¥]#,##0" } }, 2), // C:D
					formatRepeat(cfg.cols.ntd, { numberFormat: { type: "CURRENCY", pattern: "[$NTD ]#,##0" } }, 1), // B
					formatRepeat(cfg.cols.spread, { numberFormat: { type: "CURRENCY", pattern: "[$NTD ]#,##0" } }, 3), // E:G
				];
```

with a local helper (same shape as addTripEntry's):

```ts
	const formatRepeat = (col: number, format: object, width: number) => ({
		repeatCell: {
			range: { sheetId, startRowIndex: r - 1, endRowIndex: r, startColumnIndex: col, endColumnIndex: col + width },
			cell: { userEnteredFormat: format },
			fields: "userEnteredFormat.numberFormat",
		},
	});
```

That is four `repeatCell` requests, in the order A (date) / C:D (¥) / B (NTD) / E:G (NTD) — B cannot merge with E:G because C:D sit between them. The Step 1 test asserts exactly this count and order.

Row-cell formulas use `cfg.cols` letters:

```ts
	const B = colLetter(cfg.cols.ntd);
	const C = colLetter(cfg.cols.spot);
	const D = colLetter(cfg.cols.actual);
	const E = colLetter(cfg.cols.spread);
	const F = colLetter(cfg.cols.fee);
	const rowCells = [
		cellData(p.ntd),
		cellData(`=${B}${r}/${rate}`),
		cellData(received),
		cellData(`=(${C}${r}-${D}${r})*${rate}`),
		cellData(p.fee),
		cellData(`=${E}${r}+${F}${r}`),
	];
```

(For `currency === "usd"` these letters resolve to I/J/K/L/M and the emitted formulas are identical to today's.)

Return value:

```ts
	const spread = p.ntd - received * rate;
	const base = {
		tab,
		row: r,
		inserted,
		date: serialToIso(dateSerialValue),
		ntd: p.ntd,
		rate,
		spread: round2(spread),
		fee: p.fee,
		extraCost: round2(spread + p.fee),
	};
	if (currency === "jpy") {
		return { ...base, jpy: received, spotJpy: round2(p.ntd / rate) };
	}
	return { ...base, usd: received, spotUsd: round2(p.ntd / rate) };
```

- [ ] **Step 4: Run the full suite + type check**

Run: `bun run test && bun run type-check`
Expected: PASS — including every pre-existing USD addTransfer test, unmodified.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: addTransfer currency:'jpy' — NTD→JPY entries on the trip tab" --author="niuee <vntchang@gmail.com>"
```

---

### Task 3: Per-entry month wiring

**Files:**
- Modify: `src/finance-ops.ts` (new private helper + call at the end of the jpy branch)
- Test: `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: Task 2's jpy branch (`dateSerialValue`, final row `r`, trip `tab`); existing `FULL_GRID_READ`, `MONTH_COLS`, `NTD_END_BALANCE_LABEL`, `NTD_CONSERVATIVE_END_LABEL`, `NTD_SPENDING_LABEL` (import from conventions), `findRowByValue`, `quoteTab`, `serialToIso`, `monthTabName`, `cellData`, `assertNotTruncated`.
- Produces: the jpy return value gains `wiredMonthTab: string`. Private helper:
  ```ts
  async function wireJpyTransferIntoMonth(
  	client: SheetsClient,
  	monthTab: string,
  	tripTab: string,
  	entryRow: number,
  ): Promise<void>
  ```

- [ ] **Step 1: Write the failing tests**

The mock client needs to serve two different grids (trip tab, then month tab). Add a purpose-built helper next to `transferClient`:

```ts
/** Serves the trip grid for A1:G200 reads, the month grid for A1:S160 reads, and `rate` for single cells. */
function jpyWiringClient(tripGrid: unknown[][], monthGrid: unknown[][], rate: unknown = 0.208): SheetsClient {
	return {
		readRange: vi.fn(async (range: string) =>
			range.includes("A1:G200")
				? { range, values: tripGrid, truncated: false }
				: range.includes("A1:S160")
					? { range, values: monthGrid, truncated: false }
					: { range, values: [[rate]], truncated: false },
		),
		getSheetId: vi.fn(async () => 111),
		batchUpdate: vi.fn(async () => ({ replies: [{}] })),
	} as unknown as SheetsClient;
}

/** A month grid with the three NTD bank formulas at rows 58/61/62 (labels col B, formulas col D). */
function bankMonthGrid(): unknown[][] {
	const g: unknown[][] = [];
	for (let r = 0; r < 70; r++) g.push([]);
	g[57] = ["", "本月新臺幣支出", "", '=SUMIF(F3:F34,"TWD",E3:E34)+M42'];
	g[60] = ["", "保守預計本月底新臺幣餘額", "", "=D60+D57-D58-I42+IF(R42>0, 0, R42)+E4"];
	g[61] = ["", "本月底新臺幣餘額", "", "=D60+D57-D58-I42+D59+E4"];
	return g;
}

describe("addTransfer (jpy) month wiring", () => {
	const TRIP = "2026/07/25 京都東京";

	it("appends per-entry terms to the three NTD bank formulas of the date's month", async () => {
		const client = jpyWiringClient(jpyTransferGrid(), bankMonthGrid());
		const result = await addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 20800, jpy: 99000, fee: 150, date: "7/10" });

		expect(result.wiredMonthTab).toBe("7 月");
		// wiring read targets the month tab
		const reads = (client.readRange as any).mock.calls.map((c: any) => c[0]);
		expect(reads).toContain("'7 月'!A1:S160");

		// last batchUpdate carries the three formula appends
		const wiring = (client.batchUpdate as any).mock.calls.at(-1)[0];
		const formulas = wiring.map((u: any) => ({
			row: u.updateCells.start.rowIndex + 1,
			f: u.updateCells.rows[0].values[0].userEnteredValue.formulaValue,
		}));
		expect(formulas).toEqual([
			{ row: 58, f: `=SUMIF(F3:F34,"TWD",E3:E34)+M42+'${TRIP}'!G71` },
			{ row: 61, f: `=D60+D57-D58-I42+IF(R42>0, 0, R42)+E4-'${TRIP}'!B71` },
			{ row: 62, f: `=D60+D57-D58-I42+D59+E4-'${TRIP}'!B71` },
		]);
		expect(wiring.every((u: any) => u.updateCells.start.columnIndex === 3)).toBe(true);
	});

	it("derives the month from the entry date, not from today", async () => {
		const client = jpyWiringClient(jpyTransferGrid(), bankMonthGrid());
		const result = await addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 100, jpy: 470, fee: 0, date: "2026-08-02" });
		expect(result.wiredMonthTab).toBe("8 月");
		expect((client.readRange as any).mock.calls.map((c: any) => c[0])).toContain("'8 月'!A1:S160");
	});

	it("names the already-written trip row when a bank label is missing", async () => {
		const month = bankMonthGrid();
		month[60] = []; // 保守預計 gone
		const client = jpyWiringClient(jpyTransferGrid(), month);
		await expect(
			addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 100, jpy: 470, fee: 0, date: "7/10" }),
		).rejects.toThrow(/A71.*already written|already written.*A71/s);
	});

	it("refuses to touch a non-formula bank cell", async () => {
		const month = bankMonthGrid();
		(month[57] as unknown[])[3] = 12345; // a raw number where a formula should be
		const client = jpyWiringClient(jpyTransferGrid(), month);
		await expect(
			addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 100, jpy: 470, fee: 0, date: "7/10" }),
		).rejects.toThrow(/本月新臺幣支出/);
	});
});
```

Also update the Task 2 happy-path tests: they used `transferClient`, whose every ranged read returns the trip grid — the wiring step would then fail to find bank labels. Switch the two Task 2 happy-path tests (`writes into the first empty…`, `inserts A–G-scoped cells…`) to `jpyWiringClient(grid, bankMonthGrid(), rate)` and add `wiredMonthTab: "7 月"` to their `toMatchObject` expectations. The validation/missing-section/bad-rate tests never reach wiring and stay on `transferClient`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- finance-ops`
Expected: new wiring tests FAIL (`wiredMonthTab` undefined, no month read). Task 2 happy-path tests may also fail until wiring lands — that's the point.

- [ ] **Step 3: Implement**

In `src/finance-ops.ts`, above `addTransfer`:

```ts
/**
 * Append one JPY transfer's NTD-side terms into the month tab the entry is
 * dated in: −新臺幣 into 本月底新臺幣餘額 AND 保守預計本月底新臺幣餘額 (both
 * subtract the USD section's principal on the live sheet), +當筆總額外花費
 * into 本月新臺幣支出. Append-only: the existing formula is kept verbatim.
 */
async function wireJpyTransferIntoMonth(
	client: SheetsClient,
	monthTab: string,
	tripTab: string,
	entryRow: number,
): Promise<void> {
	const { values, truncated } = await client.readRange(`${quoteTab(monthTab)}!${FULL_GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, monthTab, FULL_GRID_READ);
	const ntdRef = `'${tripTab}'!${colLetter(TRANSFER_JPY_COLS.ntd)}${entryRow}`;
	const extraRef = `'${tripTab}'!${colLetter(TRANSFER_JPY_COLS.extra)}${entryRow}`;
	const targets: Array<{ label: string; term: string }> = [
		{ label: NTD_SPENDING_LABEL, term: `+${extraRef}` },
		{ label: NTD_CONSERVATIVE_END_LABEL, term: `-${ntdRef}` },
		{ label: NTD_END_BALANCE_LABEL, term: `-${ntdRef}` },
	];
	const requests: object[] = [];
	const sheetId = await client.getSheetId(monthTab);
	for (const t of targets) {
		const row = findRowByValue(values, MONTH_COLS.budgetLabel, t.label);
		if (row === null) {
			throw new Error(`No ${t.label} row in ${monthTab} (column ${colLetter(MONTH_COLS.budgetLabel)}).`);
		}
		const formula = String(values[row - 1]?.[MONTH_COLS.budgetValue] ?? "");
		if (!formula.startsWith("=")) {
			throw new Error(
				`${monthTab}'s ${t.label} value cell is not a formula (${JSON.stringify(formula)}) — refusing to overwrite it.`,
			);
		}
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: row - 1, columnIndex: MONTH_COLS.budgetValue },
				rows: [{ values: [cellData(`${formula}${t.term}`)] }],
				fields: "userEnteredValue",
			},
		});
	}
	await client.batchUpdate(requests);
}
```

At the end of `addTransfer`'s jpy path (after the second `batchUpdate`, before the return):

```ts
	let wiredMonthTab: string | undefined;
	if (currency === "jpy") {
		const monthNum = Number(serialToIso(dateSerialValue).slice(5, 7));
		const monthTab = monthTabName(monthNum);
		try {
			await wireJpyTransferIntoMonth(client, monthTab, tab, r);
		} catch (e) {
			throw new Error(
				`The transfer row ${tab}!${colLetter(cfg.cols.date)}${r} was already written, but wiring it into ${monthTab} failed: ${e instanceof Error ? e.message : String(e)} — fix the two bank formulas by hand (−新臺幣 into 本月底/保守預計, +當筆總額外花費 into 本月新臺幣支出) or delete the row and retry.`,
			);
		}
		wiredMonthTab = monthTab;
	}
```

and include `...(wiredMonthTab !== undefined ? { wiredMonthTab } : {})` in the jpy return object (or add `wiredMonthTab` directly to the jpy branch's return literal).

Import `NTD_SPENDING_LABEL`, `NTD_CONSERVATIVE_END_LABEL`, `NTD_END_BALANCE_LABEL` in finance-ops.ts's conventions import if not already there (check — `monthSummary` already uses them, so they likely are).

- [ ] **Step 4: Run the full suite + type check**

Run: `bun run test && bun run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: wire each JPY transfer's NTD side into its month's 銀行餘額 formulas" --author="niuee <vntchang@gmail.com>"
```

---

### Task 4: Tool schema + conventions documentation

**Files:**
- Modify: `src/tools.ts:296-318` (the `add_transfer` registration)
- Modify: `src/conventions.ts` (the `- To the right of the expense list, a 乾坤大挪移 block…` bullet, ~line 389, and the trip-tab section ~lines 397-400)

**Interfaces:**
- Consumes: Task 2/3's `addTransfer` params and return.
- Produces: the MCP-visible schema; no code consumer.

- [ ] **Step 1: Update the tool registration**

Replace the `add_transfer` registration in `src/tools.ts` with:

```ts
	server.tool(
		"add_transfer",
		"Log a 乾坤大挪移 currency transfer. Default currency:'usd' targets a monthly tab (default: current month): writes into the transfer block (columns H-N), pins 當下美金/匯差 to the USDTWD spot rate at entry time, and keeps the 總和 sums covering every row; the 銀行餘額 ledgers pick it up automatically (+實際美金 into 本月底美金餘額, −新臺幣 from 本月底新臺幣餘額, 匯差+手續費 into 本月新臺幣支出). currency:'jpy' targets a TRIP tab (tab required, e.g. 2026/07/25 京都東京): writes into that tab's 乾坤大挪移 section (columns A-G) pinned to the JPYTWD rate, and wires the NTD side per entry into the month the date falls in (−新臺幣 from 本月底/保守預計新臺幣餘額, 匯差+手續費 into 本月新臺幣支出); the JPY received is trip cash and joins no bank ledger. Use this instead of update_range for transfers.",
		{
			currency: z.enum(["usd", "jpy"]).optional().describe("Transfer destination currency (default usd)"),
			tab: z.string().min(1).optional().describe("Trip tab name, exactly as it appears — required for currency:'jpy'"),
			ntd: z.number().positive().describe("NTD debited from the bank (新臺幣)"),
			usd: z.number().positive().optional().describe("USD that actually arrived (實際美金) — usd transfers only"),
			jpy: z.number().positive().optional().describe("JPY that actually arrived (實際日幣) — jpy transfers only"),
			fee: z.number().min(0).describe("手續費 in NTD"),
			date: z
				.string()
				.min(1)
				.optional()
				.describe("Transfer date: M/D, MM/DD, or YYYY-MM-DD (defaults to today in Taipei)"),
			month: monthParam.optional().describe("Target month 1-12 (default: current month) — usd transfers only"),
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

(`addTransfer` itself validates the combinations, so bad calls come back as clean tool errors.)

- [ ] **Step 2: Update the conventions text**

In `src/conventions.ts`:

1. Append to the 乾坤大挪移 bullet (~line 389), after "never hand-extend the 總和 formulas":

```
 A second 乾坤大挪移 variant lives on TRIP tabs (from the 2026/07/25 京都東京 trip on), columns A-G below all trip content: 日期 新臺幣 當下日幣 實際日幣 匯差 手續費 當筆總額外花費, data rows, then a 總和 row — same anatomy, JPYTWD rate pinned at entry. The JPY received is trip cash and joins NO bank ledger; the NTD side is wired PER ENTRY into the month tab the 日期 falls in (cross-tab terms appended to that month's 本月底新臺幣餘額 and 保守預計本月底新臺幣餘額 (−新臺幣) and 本月新臺幣支出 (+當筆總額外花費)). Log these with add_transfer currency:'jpy' (tab = the trip tab); when the section is full the tool inserts cells scoped to A-G, never whole rows.
```

2. In the trip-tab section of the conventions text (~lines 397-400, near the "Never insert whole sheet rows in a trip tab" rule), add one line:

```
- A trip tab may carry its own 乾坤大挪移 block (NTD→JPY, columns A-G below all content) — see the transfer bullet above; add_transfer currency:'jpy' owns it.
```

- [ ] **Step 3: Run the full suite + type check**

Run: `bun run test && bun run type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/tools.ts src/conventions.ts
git commit -m "feat: expose add_transfer currency:'jpy' + document the trip-tab 乾坤大挪移 section" --author="niuee <vntchang@gmail.com>"
```

---

### Task 5: E2E against the dev copy sheet

**Files:** none (live verification; dev copy sheet only)

**Interfaces:**
- Consumes: the deployed-locally tool (`bun run dev` = `wrangler dev`, which targets the COPY sheet — dev credentials/binding already point there per repo config).

The dev copy sheet mirrors prod's tabs, including `2026/07/25 京都東京`. Prod is NOT touched.

- [ ] **Step 1: Create the section on the dev copy's trip tab**

Start the dev server (`bun run dev`), connect an MCP client to it (same flow as previous E2E sessions), and with `update_range` create, below all existing content on the trip tab (find the current bottom with `read_range` first; assume title row T for the steps below):

- `A{T}` = `乾坤大挪移`
- `A{T+1}:G{T+1}` = `日期 | 新臺幣 | 當下日幣 | 實際日幣 | 匯差 | 手續費 | 當筆總額外花費`
- leave `{T+2}` empty (one data slot)
- `A{T+3}` = `總和`, `B{T+3}:G{T+3}` = `=SUM(B{T+2}:B{T+2})` … `=SUM(G{T+2}:G{T+2})`

- [ ] **Step 2: Log a transfer and verify the write**

Call `add_transfer` with `{ currency: "jpy", tab: "2026/07/25 京都東京", ntd: 20800, jpy: 99000, fee: 150, date: "7/10" }`.

Verify with `read_range` (formulas mode):
- Row `{T+2}`: B=20800, C=`=B{T+2}/<pinned literal rate ~0.2>`, D=99000, E=`=(C{T+2}-D{T+2})*<rate>`, F=150, G=`=E{T+2}+F{T+2}` — the rate is a literal number, no GOOGLEFINANCE left behind.
- 總和 row: `=SUM(B{T+2}:B{T+2})` per column, values rendering with NTD/¥ signs, date as mm/dd.
- `7 月` (dev copy): 本月新臺幣支出 formula ends `+'2026/07/25 京都東京'!G{T+2}`; 保守預計 and 本月底新臺幣餘額 end `-'2026/07/25 京都東京'!B{T+2}`; the displayed 本月底新臺幣餘額 dropped by ~20800+匯差+手續費 effects.

- [ ] **Step 3: Fill the section and verify the scoped insert**

Call `add_transfer` again (`{ currency: "jpy", tab: "…", ntd: 5000, jpy: 23500, fee: 30, date: "7/11" }` — the single data slot is now full).

Verify:
- A new row appeared between the first entry and 總和, and **neighboring trip blocks/columns did not shift** (spot-check a category block's rows above, and that no blank stripe cut through columns H+ at the insert row).
- 總和 sums now span both rows; the first entry's month-tab refs (`B{T+2}`/`G{T+2}`) are unchanged; the second entry's refs point one row lower.
- `7 月`'s three formulas carry BOTH entries' terms.

- [ ] **Step 4: Verify the USD branch still works on dev**

Call `add_transfer` with `{ ntd: 3000, usd: 100, fee: 10, month: 7 }` (no currency) against dev; verify it lands in the 7 月 H–N section exactly as before, then delete the test rows/terms (or leave them — it's the copy sheet; follow whatever cleanup previous E2E sessions did).

- [ ] **Step 5: Record the result**

Note E2E outcomes (any surprises, the rows used) in the PR description. No commit unless fixes were needed — if a fix was needed, add a test reproducing it first, then fix, then commit.

---

## Final: branch, PR

The work should be done on a branch (e.g. `feat/jpy-transfer-section`) created before Task 1 — if execution started on `main`, create the branch before the first commit. After Task 5:

```bash
git push -u origin feat/jpy-transfer-section
gh pr create --title "feat: 乾坤大挪移（日幣）— NTD→JPY transfers on the trip tab" --body "..."
```

PR body: summary of the section anatomy, the per-entry month wiring, the block-scoped-insert rule, E2E notes, and a pointer to the spec. End with the Claude Code attribution line.

**Post-merge (outside this plan):** deploy (`bun run deploy`), create the section on the PROD trip tab, note the M42-vs-N42 本月新臺幣支出 discrepancy for Vincent, update memory files.
