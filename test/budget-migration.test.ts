import { describe, expect, it, vi } from "vitest";
import { migrateBudgetSplit, NTD_DISPLAY_PATTERN, planBudgetSplit, USD_DISPLAY_PATTERN } from "../src/budget-migration";
import type { SheetsClient } from "../src/sheets-client";
import { budgetGrid, legacyBudgetGrid, oldMonthGrid } from "./budget-fixtures";
import { applyRequests, normalize } from "./sheet-sim";

const SHEET_ID = 111;

/** Moves the legacy fixture's 本月匯率 row from 15 to 16 the way a sheet edit would: every $C$15 follows it. */
function rateRowTo16(g: unknown[][]): void {
	g[15] = g[14]!.slice(0, 5);
	g[14] = [];
	for (const row of g) {
		if (!row) continue;
		row.forEach((v, c) => {
			if (typeof v === "string" && v.startsWith("=")) row[c] = v.replace(/\$C\$15(?!\d)/g, "$C$16");
		});
	}
}
const plan = () => planBudgetSplit(legacyBudgetGrid(), "11 月", SHEET_ID);
const updateStarts = (requests: object[]) =>
	(requests as any[]).filter((r) => r.updateCells).map((r) => r.updateCells.start as { rowIndex: number; columnIndex: number });

describe("planBudgetSplit", () => {
	it("replaying the plan on the old template yields the split template", () => {
		expect(normalize(applyRequests(legacyBudgetGrid(), plan().requests))).toEqual(normalize(budgetGrid()));
	});

	it("the rate row moves before anything names it", () => {
		const { requests, rateRow, categories } = plan();
		const cut = requests.findIndex((r: any) => r.cutPaste);
		const firstNamed = requests.findIndex((r) => JSON.stringify(r).includes("$C$23"));
		expect(cut).toBeGreaterThanOrEqual(0);
		expect(cut).toBeLessThan(firstNamed);
		expect(rateRow).toBe(23);
		expect(JSON.stringify(requests.slice(cut + 1))).not.toContain("$C$15");
		expect(categories).toEqual(["生活用品", "吃喝", "購物", "訂閱", "交通", "娛樂", "學貸", "其他", "中餐"]);
	});

	it("never writes rows 3–4 of the left side, income rows, or block entries", () => {
		for (const { rowIndex, columnIndex } of updateStarts(plan().requests)) {
			expect(rowIndex === 2 || rowIndex === 3 ? columnIndex : 99).toBeGreaterThanOrEqual(6);
			expect(rowIndex >= 27 && rowIndex <= 30).toBe(false);
			expect(rowIndex >= 6 && columnIndex >= 7).toBe(false);
		}
	});

	it("formats USD and NTD cells", () => {
		const { requests } = plan();
		expect(requests).toContainEqual({
			repeatCell: {
				range: { sheetId: SHEET_ID, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 28, endColumnIndex: 31 },
				cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: USD_DISPLAY_PATTERN } } },
				fields: "userEnteredFormat.numberFormat",
			},
		});
		expect(requests).toContainEqual({
			repeatCell: {
				range: { sheetId: SHEET_ID, startRowIndex: 39, endRowIndex: 40, startColumnIndex: 3, endColumnIndex: 4 },
				cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: NTD_DISPLAY_PATTERN } } },
				fields: "userEnteredFormat.numberFormat",
			},
		});
	});

	describe("refuses what it doesn't recognise", () => {
		it("an already-split tab", () => {
			expect(() => planBudgetSplit(budgetGrid(), "11 月", SHEET_ID)).toThrow(/already uses per-currency/);
		});

		it("an old-layout month", () => {
			expect(() => planBudgetSplit(oldMonthGrid(), "10 月", SHEET_ID)).toThrow(/not a budget month/);
		});

		it("a second USD line for one category", () => {
			const g = legacyBudgetGrid();
			rateRowTo16(g);
			g[14] = ["", "訂閱預算", "訂閱", 5, "=D15*$C$16", "USD"];
			expect(() => planBudgetSplit(g, "11 月", SHEET_ID)).toThrow(/訂閱.*two USD/);
		});

		it("a TWD line that converts a filled USD amount", () => {
			const g = legacyBudgetGrid();
			g[5]![3] = 5; // 吃喝: E6 = D6*$C$15 with D6 filled
			expect(() => planBudgetSplit(g, "11 月", SHEET_ID)).toThrow(/吃喝.*converts/);
		});

		it("an unexpected cell in a block's money rows", () => {
			const g = legacyBudgetGrid();
			g[2]![10] = "x"; // K3, in the 中餐 block
			expect(() => planBudgetSplit(g, "11 月", SHEET_ID)).toThrow(/K3/);
		});

		it.each([
			["a TWD amount that references the rate", (g: unknown[][]) => {
				g[4]![4] = "=30*$C$15";
			}, /E5/],
			["a USD amount that references a cell", (g: unknown[][]) => {
				g[8]![3] = "=500/$C$15";
			}, /D9/],
			["an NTD amount that references another line", (g: unknown[][]) => {
				g[13]![4] = "=E14*8+E10";
			}, /E14/],
			["a USD line whose E isn't its own conversion", (g: unknown[][]) => {
				g[8]![4] = 12345;
			}, /E9/],
			["a TWD line with a USD amount that would be dropped", (g: unknown[][]) => {
				g[9]![3] = 40;
			}, /D10/],
		] as const)("a budget amount it can't carry safely: %s", (_name, edit, where) => {
			const g = legacyBudgetGrid();
			edit(g);
			expect(() => planBudgetSplit(g, "11 月", SHEET_ID)).toThrow(where);
		});

		it.each([
			["a hand-edited 編列預算", (g: unknown[][]) => {
				g[3]![12] = '=SUMIF($B$3:$B$23,"購物預算",$E$3:$E$23)+500';
			}, /M4/],
			["a hand-set 剩餘", (g: unknown[][]) => {
				g[3]![14] = 100;
			}, /O4/],
			["a hand-edited 總和", (g: unknown[][]) => {
				g[4]![14] = "=SUM(O7:O)";
			}, /O5/],
		] as const)("a block whose money rows were edited by hand: %s", (_name, edit, where) => {
			const g = legacyBudgetGrid();
			edit(g);
			expect(() => planBudgetSplit(g, "11 月", SHEET_ID)).toThrow(where);
		});

		it.each([
			["a non-budget row", ["", "保留款", "", "", 500, ""]],
			["an unlabelled amount", ["", "", "", "", 777, ""]],
		] as const)("a row inside the old list that isn't a budget line: %s", (_name, row) => {
			const g = legacyBudgetGrid();
			rateRowTo16(g);
			g[14] = [...row];
			expect(() => planBudgetSplit(g, "11 月", SHEET_ID)).toThrow(/row 15/);
		});

		it("blocks that don't all sit on the same rows", () => {
			const g = legacyBudgetGrid();
			for (let r = g.length - 1; r >= 1; r--) {
				for (let c = 12; c <= 15; c++) {
					(g[r + 1] ??= [])[c] = g[r]?.[c];
					if (g[r]) g[r]![c] = undefined;
				}
			}
			expect(() => planBudgetSplit(g, "11 月", SHEET_ID)).toThrow(/same rows/);
		});

		it("anything in the rows the list grows into", () => {
			const g = legacyBudgetGrid();
			(g[19] ??= [])[1] = "note"; // B20
			expect(() => planBudgetSplit(g, "11 月", SHEET_ID)).toThrow(/B20/);
		});
	});
});

/** Fake client: each readRange returns the next grid in `reads`. */
function migrationClient(reads: unknown[][][]): SheetsClient {
	const queue = [...reads];
	return {
		readRange: vi.fn(async (range: string) => ({ range, values: queue.shift() ?? [], truncated: false })),
		getSheetId: vi.fn(async () => SHEET_ID),
		batchUpdate: vi.fn(async () => ({ replies: [] })),
	} as unknown as SheetsClient;
}

describe("migrateBudgetSplit", () => {
	it("migrates in one batch after reading, and reports before and after", async () => {
		const before = legacyBudgetGrid();
		before[33]![3] = -99.99;
		const after = budgetGrid();
		after[33]![3] = -99.99;
		after[22]![2] = 32.54;
		const client = migrationClient([legacyBudgetGrid(), before, after]);
		const r = await migrateBudgetSplit(client, "11 月");
		const reads = (client.readRange as any).mock;
		const writes = (client.batchUpdate as any).mock;
		expect(writes.calls).toHaveLength(1);
		expect(reads.invocationCallOrder[0]).toBeLessThan(writes.invocationCallOrder[0]);
		expect(reads.invocationCallOrder[1]).toBeLessThan(writes.invocationCallOrder[0]);
		expect(reads.calls.slice(0, 2).map((c: unknown[]) => c[1])).toEqual(["FORMULA", "UNFORMATTED_VALUE"]);
		expect(r).toMatchObject({ tab: "11 月", rateRow: 23 });
		expect(r.before.本月美金超支).toBe(-99.99);
		expect(r.before.本月匯率).toBe(32.4607);
		expect(r.after.本月美金超支).toBe(-99.99);
		expect(r.after.本月匯率).toBe(32.54);
	});

	it("a second run refuses and writes nothing", async () => {
		const client = migrationClient([budgetGrid(), budgetGrid()]);
		await expect(migrateBudgetSplit(client, "11 月")).rejects.toThrow(/already uses per-currency/);
		expect(client.batchUpdate).not.toHaveBeenCalled();
	});

	it("a rejected batch reports that nothing was written", async () => {
		const client = migrationClient([legacyBudgetGrid(), legacyBudgetGrid()]);
		(client.batchUpdate as any).mockRejectedValueOnce(new Error("Sheets API error (400): You must select all cells in a merged range"));
		await expect(migrateBudgetSplit(client, "11 月")).rejects.toThrow(/Migrating 11 月 failed and nothing was written: .*merged range/);
	});
});
