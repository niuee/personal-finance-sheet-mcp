import { describe, expect, it, vi } from "vitest";
import { dateSerial } from "../src/conventions";
import type { BudgetMonthSummary } from "../src/budget-ops";
import {
	addExpense,
	addLunch,
	addTransfer,
	adjustBalance,
	cellData,
	deleteExpense,
	getCategories,
	monthSummary,
	setExpenseDate,
	setIncome,
	startMonth,
} from "../src/finance-ops";
import type { SheetsClient } from "../src/sheets-client";
import { rateFormula } from "../src/budget-layout";
import { budgetGrid, oldMonthGrid } from "./budget-fixtures";

/** Tab name out of an A1 range like "'11 月'!A1:BJ". */
function tabOf(range: string): string {
	const m = range.match(/^'((?:[^']|'')*)'!/);
	return m ? m[1]!.replace(/''/g, "'") : range;
}

/** Fake client: reads are keyed by tab, the duplicate call answers with sheetId 555. */
function budgetClient(grids: Record<string, unknown[][]>, tabs?: string[]): SheetsClient {
	return {
		readRange: vi.fn(async (range: string) => ({ range, values: grids[tabOf(range)] ?? [], truncated: false })),
		getSheetId: vi.fn(async (title: string) => ({ "Budget Based": 900 })[title] ?? 111),
		batchUpdate: vi.fn(async (reqs: any[]) =>
			reqs[0]?.duplicateSheet ? { replies: [{ duplicateSheet: { properties: { sheetId: 555 } } }] } : { replies: [{}] },
		),
		listTabs: vi.fn(async () => (tabs ?? Object.keys(grids)).map((title) => ({ title, rowCount: 1000, columnCount: 62 }))),
	} as unknown as SheetsClient;
}

describe("addExpense on budget months", () => {
	it("writes a TWD expense into its block's first empty row, with a mm/dd date", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		const r = await addExpense(client, { item: "Kato 500系", amount: 8940, currency: "TWD", tag: "購物", date: "2026-11-05", month: 11 });
		expect((client.readRange as any).mock.calls[1]).toEqual(["'11 月'!A1:BJ", "FORMULA"]);
		const reqs = (client.batchUpdate as any).mock.calls[0][0];
		expect(reqs).toContainEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 6, columnIndex: 13 },
				rows: [{ values: [cellData("Kato 500系"), cellData(8940), cellData("TWD")] }],
				fields: "userEnteredValue",
			},
		});
		expect(reqs).toContainEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 6, columnIndex: 12 },
				rows: [
					{
						values: [
							{
								userEnteredValue: { numberValue: dateSerial(2026, 11, 5) },
								userEnteredFormat: { numberFormat: { type: "DATE", pattern: "mm/dd" } },
							},
						],
					},
				],
				fields: "userEnteredValue,userEnteredFormat.numberFormat",
			},
		});
		expect(r).toMatchObject({ layout: "budget", category: "購物", row: 7, currency: "TWD", convertedAtMonthRate: false });
	});

	it("writes a USD-priced, NTD-paid expense as TWD at the month rate", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		const r = await addExpense(client, { item: "GTA 6", amount: 99.99, currency: "USD", paidWith: "TWD", tag: "娛樂", month: 11 });
		expect((client.batchUpdate as any).mock.calls[0][0]).toContainEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 6, columnIndex: 38 },
				rows: [{ values: [cellData("GTA 6"), cellData("=99.99*$C$15"), cellData("TWD")] }],
				fields: "userEnteredValue",
			},
		});
		expect(r).toMatchObject({ currency: "TWD", amount: "=99.99*$C$15", convertedAtMonthRate: true, date: null });
	});

	it("writes a USD expense paid in USD as USD", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		await addExpense(client, { item: "Steam", amount: 12.5, currency: "USD", tag: "其他", month: 11 });
		// 其他 already holds 每月銀行管理 in row 7 → row 8
		expect((client.batchUpdate as any).mock.calls[0][0]).toContainEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 7, columnIndex: 48 },
				rows: [{ values: [cellData("Steam"), cellData(12.5), cellData("USD")] }],
				fields: "userEnteredValue",
			},
		});
	});

	it("refuses card and a missing tag on budget months, writing nothing", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		await expect(addExpense(client, { item: "x", amount: 1, currency: "TWD", tag: "購物", card: "現金", month: 11 })).rejects.toThrow(
			/budget month/,
		);
		await expect(addExpense(client, { item: "x", amount: 1, currency: "TWD", month: 11 })).rejects.toThrow(/tag.*中餐/);
		expect(client.batchUpdate).not.toHaveBeenCalled();
	});

	it("refuses when the wide read is truncated", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		(client.readRange as any)
			.mockResolvedValueOnce({ range: "x", values: budgetGrid(), truncated: false })
			.mockResolvedValueOnce({ range: "x", values: budgetGrid(), truncated: true });
		await expect(addExpense(client, { item: "x", amount: 1, currency: "TWD", tag: "購物", month: 11 })).rejects.toThrow(/truncated/);
		expect(client.batchUpdate).not.toHaveBeenCalled();
	});
});

describe("deleteExpense on budget months", () => {
	it("deletes a block-scoped range so only that block's entries shift up", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		const r = await deleteExpense(client, { item: "iCloud", month: 11 });
		expect((client.batchUpdate as any).mock.calls[0][0]).toEqual([
			{
				deleteRange: {
					range: { sheetId: 111, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 27, endColumnIndex: 31 },
					shiftDimension: "ROWS",
				},
			},
		]);
		expect(r).toMatchObject({ layout: "budget", category: "訂閱", row: 8, item: "iCloud", deleted: [undefined, "iCloud", 9.99, "USD"] });
	});

	it("refuses an item found in two blocks unless tag picks one", async () => {
		const g = budgetGrid();
		g[6]![48] = "Claude"; // a second "Claude" in 其他 (row 7)
		g[6]![49] = 100;
		const client = budgetClient({ "11 月": g });
		await expect(deleteExpense(client, { item: "Claude", month: 11 })).rejects.toThrow(/訂閱.*12.*其他.*7|其他.*7.*訂閱.*12/);
		expect(client.batchUpdate).not.toHaveBeenCalled();
		await deleteExpense(client, { item: "Claude", tag: "其他", month: 11 });
		expect((client.batchUpdate as any).mock.calls[0][0][0].deleteRange.range).toMatchObject({ startRowIndex: 6, startColumnIndex: 47 });
	});

	it("throws when no entry matches", async () => {
		await expect(deleteExpense(budgetClient({ "11 月": budgetGrid() }), { item: "Nope", month: 11 })).rejects.toThrow(/No "Nope"/);
	});
});

describe("setIncome on budget months", () => {
	it("updates 沛還 in place on a budget month", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		const r = await setIncome(client, { item: "沛還", amount: 800, currency: "USD", month: 11 });
		expect((client.batchUpdate as any).mock.calls[0][0]).toEqual([
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 28, columnIndex: 2 },
					rows: [{ values: [cellData("USD"), cellData(800)] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(r).toMatchObject({ row: 29, action: "updated" });
	});

	it("fills the first empty income row, then grows B–D only when the window is full", async () => {
		const g = budgetGrid();
		g[29] = ["", "獎金", "TWD", 1000];
		g[30] = ["", "股息", "USD", 5];
		const client = budgetClient({ "11 月": g });
		await setIncome(client, { item: "發票中獎", amount: 200, currency: "TWD", month: 11 });
		expect((client.batchUpdate as any).mock.calls[0][0][0]).toEqual({
			insertRange: {
				range: { sheetId: 111, startRowIndex: 30, endRowIndex: 31, startColumnIndex: 1, endColumnIndex: 4 },
				shiftDimension: "ROWS",
			},
		});
	});

	it("writes a new income into the first empty row of the window", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		const r = await setIncome(client, { item: "獎金", amount: 1000, currency: "TWD", month: 11 });
		expect((client.batchUpdate as any).mock.calls[0][0]).toEqual([
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 29, columnIndex: 1 },
					rows: [{ values: [cellData("獎金"), cellData("TWD"), cellData(1000)] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(r).toMatchObject({ row: 30, action: "inserted" });
	});

	it("refuses layout labels like 本月匯率", async () => {
		await expect(setIncome(budgetClient({ "11 月": budgetGrid() }), { item: "本月匯率", amount: 1, currency: "TWD", month: 11 })).rejects.toThrow(
			/layout label/,
		);
	});
});

describe("addTransfer on budget months", () => {
	it("writes the first empty 乾坤大挪移 row on a budget month and never rewrites 總和", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		(client.readRange as any)
			.mockResolvedValueOnce({ range: "x", values: budgetGrid(), truncated: false })
			.mockResolvedValueOnce({ range: "x", values: budgetGrid(), truncated: false })
			.mockResolvedValueOnce({ range: "x", values: [[32.5]], truncated: false });
		const r = await addTransfer(client, { ntd: 32000, usd: 980, fee: 15, date: "2026-11-03", month: 11 });
		const [scratch, write] = (client.batchUpdate as any).mock.calls.map((c: any) => c[0]);
		expect(scratch).toEqual([
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 6, columnIndex: 54 },
					rows: [{ values: [cellData('=GOOGLEFINANCE("CURRENCY:USDTWD")')] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(write).toContainEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 6, columnIndex: 53 },
				rows: [
					{
						values: [cellData(32000), cellData("=BB7/32.5"), cellData(980), cellData("=(BC7-BD7)*32.5"), cellData(15), cellData("=BE7+BF7")],
					},
				],
				fields: "userEnteredValue",
			},
		});
		expect(JSON.stringify(write)).not.toContain('"rowIndex":4'); // 總和 row untouched
		expect(r).toMatchObject({ layout: "budget", row: 7, usd: 980, rate: 32.5 });
	});
});

describe("monthSummary and getCategories on budget months", () => {
	it("month_summary reports budgets per block and both 收支狀況 lines", async () => {
		const g = budgetGrid();
		g[3]![7] = 3900; // 午餐 編列預算 (H4)
		g[4]![9] = 0; // 午餐 總和 (J5)
		g[3]![9] = 3900; // 午餐 剩餘 (J4)
		g[3]![27] = 13016.72; // 訂閱 編列預算
		g[4]![29] = 8808.86; // 訂閱 總和
		g[3]![29] = 4207.86; // 訂閱 剩餘
		g[2]![3] = 0;
		g[2]![4] = 0;
		g[3]![4] = 19281.68;
		g[14]![4] = 63619.74;
		g[31]![3] = 183.7;
		g[32]![3] = -883.62;
		g[34] = ["", "本月超支", "", 0];
		g[39] = ["", "總支出", "", 55512.6];
		g[4]![53] = 0; // 乾坤大挪移 總和: 新臺幣 BB, 實際美金 BD, 手續費 BF, 當筆總額外花費 BG
		g[4]![55] = 0;
		g[4]![57] = 0;
		g[4]![58] = 0;
		const s = (await monthSummary(budgetClient({ "11 月": g }), 11)) as unknown as BudgetMonthSummary;
		expect(s).toMatchObject({
			layout: "budget",
			本月匯率: 32.4607,
			上月新臺幣透支: 19281.68,
			預算總額: 63619.74,
			本月美金收支狀況: 183.7,
			本月新臺幣收支狀況: -883.62,
			本月超支: 0,
			總支出: 55512.6,
			incomes: [
				{ item: "薪水", currency: "TWD", amount: 65271 },
				{ item: "沛還", currency: "USD", amount: 700 },
			],
			乾坤大挪移: { 新臺幣: 0, 實際美金: 0, 手續費: 0, 當筆總額外花費: 0 },
		});
		expect(s.budgets[0]).toEqual({ category: "中餐", 編列預算: 3900, 總和: 0, 剩餘: 3900 });
		expect(s.budgets[4]).toEqual({ category: "訂閱", 編列預算: 13016.72, 總和: 8808.86, 剩餘: 4207.86 });
	});

	it("get_categories lists the blocks on a budget month", async () => {
		const client = { ...budgetClient({ "11 月": budgetGrid() }), getDataValidation: vi.fn() } as unknown as SheetsClient;
		expect(await getCategories(client, 11)).toEqual({
			tab: "11 月",
			source: "BUDGET_BLOCKS",
			categories: ["中餐", "購物", "吃喝", "生活用品", "訂閱", "交通", "娛樂", "學貸", "其他"],
		});
		expect((client as any).getDataValidation).not.toHaveBeenCalled();
	});
});

describe("old-layout-only tools refuse budget months", () => {
	it("add_lunch points at add_expense with tag 中餐", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		await expect(addLunch(client, { amount: 120, month: 11 })).rejects.toThrow("11 月 is a budget month — lunches are entries in the 午餐 block");
		expect(client.batchUpdate).not.toHaveBeenCalled();
	});

	it("set_expense_date has no card buckets to date into", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		await expect(setExpenseDate(client, { item: "Netflix", date: "11/2", month: 11 })).rejects.toThrow(
			"11 月 is a budget month — it has no card statement buckets",
		);
		expect(client.batchUpdate).not.toHaveBeenCalled();
	});

	it("adjust_balance has no bank-balance sections", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		await expect(adjustBalance(client, { currency: "TWD", actual: 1000, month: 11 })).rejects.toThrow(
			"11 月 is a budget month — it has no bank-balance sections to reconcile.",
		);
		expect(client.batchUpdate).not.toHaveBeenCalled();
	});
});

describe("startMonth from the Budget Based template", () => {
	const NOW = { now: new Date("2026-10-20T04:00:00Z") };
	const write = (rowIndex: number, columnIndex: number, v: string | number) => ({
		updateCells: { start: { sheetId: 555, rowIndex, columnIndex }, rows: [{ values: [cellData(v)] }], fields: "userEnteredValue" },
	});

	it("builds 11 月 from the template with carries to 10 月 and the locked-rate formula", async () => {
		// '11 月' has a grid (what the duplicate will read back) but isn't in listTabs yet.
		const client = budgetClient({ "Budget Based": budgetGrid(), "10 月": oldMonthGrid(), "11 月": budgetGrid() }, ["Budget Based", "10 月"]);
		const r = await startMonth(client, 11, NOW);
		const calls = (client.batchUpdate as any).mock.calls.map((c: any) => c[0]);
		expect(calls[0]).toEqual([{ duplicateSheet: { sourceSheetId: 900, insertSheetIndex: 0, newSheetName: "11 月" } }]);
		expect(calls[1]).toEqual(
			expect.arrayContaining([
				write(0, 0, "11 月花費"),
				write(2, 3, "=IF(-('10 月'!D43) > 0, -('10 月'!D43), 0)"),
				write(3, 4, "=IF(-('10 月'!D44) > 0, -('10 月'!D44), 0)"),
				write(14, 2, rateFormula(2026, 11)),
			]),
		);
		expect(calls).toHaveLength(2);
		expect(r).toMatchObject({ tab: "11 月", layout: "budget", template: "Budget Based", carriesFrom: "10 月", replacedTab: null });
		expect((r as any).startingEntries["訂閱"]).toEqual(["ElevenLabs", "iCloud", "Google One", "Netflix", "ChatGPT", "Claude"]);
	});

	it("missing previous month → both carries 0", async () => {
		const client = budgetClient({ "Budget Based": budgetGrid(), "11 月": budgetGrid() }, ["Budget Based"]);
		const r = await startMonth(client, 11, NOW);
		const final = (client.batchUpdate as any).mock.calls[1][0];
		expect(final).toEqual(expect.arrayContaining([write(2, 3, 0), write(3, 4, 0)]));
		expect(r).toMatchObject({ carriesFrom: null });
	});

	it("start_month(1) in December locks to DATE(2027,1,1)", async () => {
		const client = budgetClient({ "Budget Based": budgetGrid(), "12 月": oldMonthGrid(), "1 月": budgetGrid() }, ["Budget Based", "12 月"]);
		await startMonth(client, 1, { now: new Date("2026-12-15T04:00:00Z") });
		expect((client.batchUpdate as any).mock.calls[1][0]).toEqual(expect.arrayContaining([write(14, 2, rateFormula(2027, 1))]));
	});

	it("existing old-layout 11 月: refuses without the flag; renames to 11 月 DEP with it", async () => {
		const tabs = ["Budget Based", "10 月", "11 月"];
		const plain = budgetClient({ "Budget Based": budgetGrid(), "10 月": oldMonthGrid(), "11 月": budgetGrid() }, tabs);
		await expect(startMonth(plain, 11, NOW)).rejects.toThrow(/already exists/);
		expect(plain.batchUpdate).not.toHaveBeenCalled();

		const client = budgetClient({ "Budget Based": budgetGrid(), "10 月": oldMonthGrid(), "11 月": budgetGrid() }, tabs);
		(client.readRange as any).mockResolvedValueOnce({ range: "x", values: oldMonthGrid(), truncated: false }); // the old 11 月
		const r = await startMonth(client, 11, { ...NOW, replaceOldLayout: true });
		const calls = (client.batchUpdate as any).mock.calls.map((c: any) => c[0]);
		expect(calls[0]).toEqual([{ updateSheetProperties: { properties: { sheetId: 111, title: "11 月 DEP" }, fields: "title" } }]);
		expect(calls[1]).toEqual([{ duplicateSheet: { sourceSheetId: 900, insertSheetIndex: 0, newSheetName: "11 月" } }]);
		expect(r).toMatchObject({ replacedTab: "11 月 DEP" });
	});

	it("never replaces a budget month or an existing DEP", async () => {
		const budgetTwice = budgetClient({ "Budget Based": budgetGrid(), "11 月": budgetGrid() }, ["Budget Based", "11 月"]);
		await expect(startMonth(budgetTwice, 11, { ...NOW, replaceOldLayout: true })).rejects.toThrow(/already a budget month/);
		expect(budgetTwice.batchUpdate).not.toHaveBeenCalled();

		const withDep = budgetClient({ "Budget Based": budgetGrid(), "11 月": oldMonthGrid() }, ["Budget Based", "11 月", "11 月 DEP"]);
		await expect(startMonth(withDep, 11, { ...NOW, replaceOldLayout: true })).rejects.toThrow(/11 月 DEP/);
		expect(withDep.batchUpdate).not.toHaveBeenCalled();
	});

	it("old path still runs without the template; the flag without the template throws", async () => {
		const client = budgetClient({ "9 月": oldMonthGrid(), "8 月": [], "10 月": oldMonthGrid() }, ["9 月", "8 月"]);
		await startMonth(client, 10);
		expect((client.batchUpdate as any).mock.calls[0][0]).toEqual([
			{ duplicateSheet: { sourceSheetId: 111, insertSheetIndex: 0, newSheetName: "10 月" } },
		]);
		const flagged = budgetClient({ "9 月": oldMonthGrid() }, ["9 月", "8 月"]);
		await expect(startMonth(flagged, 10, { replaceOldLayout: true })).rejects.toThrow(/Budget Based/);
		expect(flagged.batchUpdate).not.toHaveBeenCalled();
	});
});
