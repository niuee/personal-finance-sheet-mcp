import { describe, expect, it } from "vitest";
import {
	blockEntries,
	findBudgetBlocks,
	findBudgetIncomeSumifWindow,
	findBudgetTransferSection,
	findRateRow,
	firstEmptyEntryRow,
	isBudgetMonth,
	rateFormula,
	rateYear,
	resolveBudgetBlock,
} from "../src/budget-layout";
import { budgetGrid, legacyBudgetGrid, oldMonthGrid } from "./budget-fixtures";

describe("budget-month layout", () => {
	it("isBudgetMonth: true on the template, false on an old month", () => {
		expect(isBudgetMonth(budgetGrid())).toBe(true);
		expect(isBudgetMonth(oldMonthGrid())).toBe(false);
	});

	it("findBudgetBlocks finds all nine blocks in column order, 午餐支出 as 中餐", () => {
		const blocks = findBudgetBlocks(budgetGrid(), "11 月");
		expect(blocks.map((b) => b.category)).toEqual(["中餐", "購物", "吃喝", "生活用品", "訂閱", "交通", "娛樂", "學貸", "其他"]);
		expect(blocks[4]).toEqual({ category: "訂閱", title: "訂閱支出", startCol: 27, usdRow: 4, ntdRow: 5, headerRow: 6 });
	});

	it("findBudgetBlocks throws when a block lost its 美金 row label", () => {
		const g = budgetGrid();
		g[3]![27] = "";
		expect(() => findBudgetBlocks(g, "11 月")).toThrow(/AB6.*美金|美金.*AB6/);
	});

	it("findBudgetBlocks refuses an old-shape tab without pointing at the removed migration tool", () => {
		expect(() => findBudgetBlocks(legacyBudgetGrid(), "11 月")).toThrow(/old single-currency budget blocks, which the tools no longer read/);
		expect(() => findBudgetBlocks(legacyBudgetGrid(), "11 月")).not.toThrow(/migrate_budget_split/);
	});

	it("resolveBudgetBlock: alias, trim, unknown tag lists categories", () => {
		const blocks = findBudgetBlocks(budgetGrid(), "11 月");
		expect(resolveBudgetBlock(blocks, " 午餐 ", "11 月").startCol).toBe(7);
		expect(resolveBudgetBlock(blocks, "中餐", "11 月").startCol).toBe(7);
		expect(() => resolveBudgetBlock(blocks, "旅遊", "11 月")).toThrow(/中餐.*購物.*其他/);
	});

	it("firstEmptyEntryRow ignores the pre-typed TWD and fills gaps", () => {
		const g = budgetGrid();
		const blocks = findBudgetBlocks(g, "11 月");
		expect(firstEmptyEntryRow(g, blocks[1]!)).toBe(7); // 購物: rows 7-8 hold only "TWD"
		expect(firstEmptyEntryRow(g, blocks[4]!)).toBe(13); // 訂閱: entries in 7-12
		g[8]![28] = "";
		g[8]![29] = ""; // blank iCloud (row 9) by hand
		expect(firstEmptyEntryRow(g, blocks[4]!)).toBe(9);
	});

	it("blockEntries lists 訂閱's six starting entries", () => {
		const g = budgetGrid();
		const entries = blockEntries(g, findBudgetBlocks(g, "11 月")[4]!);
		expect(entries.map((e) => e.item)).toEqual(["ElevenLabs", "iCloud", "Google One", "Netflix", "ChatGPT", "Claude"]);
		expect(entries[5]).toEqual({ row: 12, date: undefined, item: "Claude", amount: "=200*$C$23", currency: "TWD" });
	});

	it("findBudgetTransferSection: 總和 above the header", () => {
		expect(findBudgetTransferSection(budgetGrid(), "11 月")).toEqual({ dateCol: 52, totalRow: 5, headerRow: 6 });
	});

	it("findBudgetIncomeSumifWindow reads C28:C31 from 本月美金收支狀況", () => {
		expect(findBudgetIncomeSumifWindow(budgetGrid(), "11 月")).toEqual({ start: 28, end: 31 });
	});

	it("findRateRow finds 本月匯率", () => {
		expect(findRateRow(budgetGrid(), "11 月")).toBe(23);
	});

	it("rateYear: this year from the current month on, next year before it (Taipei)", () => {
		const oct20 = new Date("2026-10-20T04:00:00Z");
		expect(rateYear(11, oct20)).toBe(2026);
		expect(rateYear(10, oct20)).toBe(2026);
		expect(rateYear(1, new Date("2026-12-15T04:00:00Z"))).toBe(2027);
		expect(rateYear(1, new Date("2026-12-31T17:00:00Z"))).toBe(2027); // already 2027-01-01 in Taipei → current month
	});

	it("rateYear picks the nearest occurrence, so rebuilding a just-ended month keeps its year", () => {
		expect(rateYear(11, new Date("2026-12-15T04:00:00Z"))).toBe(2026); // November built late, in December
		expect(rateYear(12, new Date("2027-01-10T04:00:00Z"))).toBe(2026);
		expect(rateYear(4, new Date("2026-10-20T04:00:00Z"))).toBe(2027); // six months either way → the coming one
	});

	it("rateFormula is the exact self-locking formula", () => {
		expect(rateFormula(2026, 11)).toBe(
			'=IF(TODAY()<=DATE(2026,11,1),GOOGLEFINANCE("CURRENCY:USDTWD"),INDEX(GOOGLEFINANCE("CURRENCY:USDTWD","price",DATE(2026,11,1)),2,2))',
		);
	});
});
