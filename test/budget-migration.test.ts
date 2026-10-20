import { describe, expect, it } from "vitest";
import { NTD_DISPLAY_PATTERN, planBudgetSplit, USD_DISPLAY_PATTERN } from "../src/budget-migration";
import { budgetGrid, legacyBudgetGrid, oldMonthGrid } from "./budget-fixtures";
import { applyRequests, normalize } from "./sheet-sim";

const SHEET_ID = 111;
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
			g[15] = g[14]!.slice(0, 5); // rate row → 16
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

		it("anything in the rows the list grows into", () => {
			const g = legacyBudgetGrid();
			(g[19] ??= [])[1] = "note"; // B20
			expect(() => planBudgetSplit(g, "11 月", SHEET_ID)).toThrow(/B20/);
		});
	});
});
