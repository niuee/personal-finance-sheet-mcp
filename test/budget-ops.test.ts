import { describe, expect, it, vi } from "vitest";
import { dateSerial } from "../src/conventions";
import type { BudgetMonthSummary } from "../src/budget-ops";
import {
	addExpense,
	addTransfer,
	cellData,
	deleteExpense,
	getCategories,
	monthSummary,
	setIncome,
	startMonth,
} from "../src/finance-ops";
import type { SheetsClient } from "../src/sheets-client";
import { rateFormula } from "../src/budget-layout";
import { budgetGrid, legacyBudgetGrid, oldMonthGrid } from "./budget-fixtures";

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
		dataValidationCells: vi.fn(async () => []),
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
				rows: [{ values: [cellData("GTA 6"), cellData("=99.99*$C$23"), cellData("TWD")] }],
				fields: "userEnteredValue",
			},
		});
		expect(r).toMatchObject({ currency: "TWD", amount: "=99.99*$C$23", convertedAtMonthRate: true, date: null });
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

	it("copies the 幣別 dropdown from the nearest entry above, filling the rows added without it", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		// 訂閱 (幣別 in AE = col 30) holds entries in rows 7-12; only the template's rows 7-10 carry the dropdown.
		// 中餐's K7 has one too, but the block's own dropdown wins.
		(client.dataValidationCells as any).mockResolvedValueOnce([7, 8, 9, 10].map((row) => ({ row, col: 30 })).concat([{ row: 7, col: 10 }]));
		const r = await addExpense(client, { item: "Spotify", amount: 149, currency: "TWD", tag: "訂閱", month: 11 });
		expect(r).toMatchObject({ row: 13 });
		// One read over every block's 幣別 column (K…AY), from the first entry row to the tab's last row.
		expect(client.dataValidationCells).toHaveBeenCalledWith("11 月", "K7:AY40");
		expect((client.batchUpdate as any).mock.calls[0][0]).toContainEqual({
			copyPaste: {
				source: { sheetId: 111, startRowIndex: 9, endRowIndex: 10, startColumnIndex: 30, endColumnIndex: 31 },
				destination: { sheetId: 111, startRowIndex: 10, endRowIndex: 13, startColumnIndex: 30, endColumnIndex: 31 },
				pasteType: "PASTE_DATA_VALIDATION",
			},
		});
	});

	it("with no dropdown above in its own block, copies one from another block's 幣別", async () => {
		// 娛樂 (幣別 in AO = col 40) is empty, so its first entry lands on row 7; 訂閱's AE7 and AE12 carry the dropdown.
		const client = budgetClient({ "11 月": budgetGrid() });
		(client.dataValidationCells as any).mockResolvedValueOnce([
			{ row: 7, col: 30 },
			{ row: 12, col: 30 },
		]);
		await addExpense(client, { item: "Switch 遊戲", amount: 1490, currency: "TWD", tag: "娛樂", month: 11 });
		expect((client.batchUpdate as any).mock.calls[0][0]).toContainEqual({
			copyPaste: {
				source: { sheetId: 111, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 30, endColumnIndex: 31 },
				destination: { sheetId: 111, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 40, endColumnIndex: 41 },
				pasteType: "PASTE_DATA_VALIDATION",
			},
		});
	});

	it("a block with no dropdown at all gets one from another block on every row down to the new entry", async () => {
		// 訂閱's rows 7-12 have none; only 其他's AY7 (col 50) does → AE7:AE13 all get it.
		const client = budgetClient({ "11 月": budgetGrid() });
		(client.dataValidationCells as any).mockResolvedValueOnce([{ row: 7, col: 50 }]);
		await addExpense(client, { item: "Spotify", amount: 149, currency: "TWD", tag: "訂閱", month: 11 });
		expect((client.batchUpdate as any).mock.calls[0][0]).toContainEqual({
			copyPaste: {
				source: { sheetId: 111, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 50, endColumnIndex: 51 },
				destination: { sheetId: 111, startRowIndex: 6, endRowIndex: 13, startColumnIndex: 30, endColumnIndex: 31 },
				pasteType: "PASTE_DATA_VALIDATION",
			},
		});
	});

	it("leaves the 幣別 dropdown alone when the target row already has it, or when the block has none", async () => {
		const withRule = budgetClient({ "11 月": budgetGrid() });
		(withRule.dataValidationCells as any).mockResolvedValueOnce([
			{ row: 7, col: 15 },
			{ row: 8, col: 15 },
		]);
		await addExpense(withRule, { item: "Kato 500系", amount: 8940, currency: "TWD", tag: "購物", month: 11 });
		expect(JSON.stringify((withRule.batchUpdate as any).mock.calls[0][0])).not.toContain("copyPaste");

		const noRule = budgetClient({ "11 月": budgetGrid() });
		await addExpense(noRule, { item: "Kato 500系", amount: 8940, currency: "TWD", tag: "購物", month: 11 });
		expect(JSON.stringify((noRule.batchUpdate as any).mock.calls[0][0])).not.toContain("copyPaste");
	});

	it("refuses a missing tag on budget months, writing nothing", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		await expect(addExpense(client, { item: "x", amount: 1, currency: "TWD", month: 11 })).rejects.toThrow(/tag.*中餐/);
		expect(client.batchUpdate).not.toHaveBeenCalled();
	});

	it("rejects a TWD-priced expense paid in USD before reading or writing anything", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		await expect(
			addExpense(client, { item: "x", amount: 100, currency: "TWD", paidWith: "USD", tag: "購物", month: 11 }),
		).rejects.toThrow("not representable");
		expect(client.readRange).not.toHaveBeenCalled();
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

	it.each(["本月新臺幣超支", "本月美金超支", "本月美金超支（加上回補）", "本月新臺幣超支（加上回補）"])("refuses %s as an income item", async (item) => {
		await expect(setIncome(budgetClient({ "11 月": budgetGrid() }), { item, amount: 1, currency: "TWD", month: 11 })).rejects.toThrow(
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
	it("month_summary reports each block's 美金 and 新臺幣 money and the split 超支 rows", async () => {
		const g = budgetGrid();
		g[3]![28] = 71.37; // 訂閱 美金: 編列預算 AC4, 總和 AD4, 剩餘 AE4
		g[3]![29] = 71.37;
		g[3]![30] = 0;
		g[4]![28] = 10700; // 訂閱 新臺幣: AC5, AD5, AE5
		g[4]![29] = 6508;
		g[4]![30] = 4192;
		g[2]![3] = 0;
		g[2]![4] = 0;
		g[3]![4] = 19281.68;
		g[22]![4] = 63661.4;
		g[31]![3] = 83.71;
		g[32]![3] = -6624.21;
		g[33]![3] = -99.99; // 本月美金超支 (D34)
		g[34]![3] = -25034.21; // 本月新臺幣超支 (D35)
		g[35]![3] = -99.99; // 本月美金超支（加上回補） (D36)
		g[36]![3] = -16942.21; // 本月新臺幣超支（加上回補） (D37)
		g[39]![3] = 83857.28;
		g[4]![53] = 0; // 乾坤大挪移 總和: 新臺幣 BB, 實際美金 BD, 手續費 BF, 當筆總額外花費 BG
		g[4]![55] = 0;
		g[4]![57] = 0;
		g[4]![58] = 0;
		const s = (await monthSummary(budgetClient({ "11 月": g }), 11)) as unknown as BudgetMonthSummary;
		expect(s).toMatchObject({
			layout: "budget",
			本月匯率: 32.4607,
			上月新臺幣透支: 19281.68,
			預算總額: 63661.4,
			本月美金收支狀況: 83.71,
			本月新臺幣收支狀況: -6624.21,
			本月美金超支: -99.99,
			本月新臺幣超支: -25034.21,
			"本月美金超支（加上回補）": -99.99,
			"本月新臺幣超支（加上回補）": -16942.21,
			總支出: 83857.28,
			incomes: [
				{ item: "薪水", currency: "TWD", amount: 65271 },
				{ item: "沛還", currency: "USD", amount: 700 },
			],
			乾坤大挪移: { 新臺幣: 0, 實際美金: 0, 手續費: 0, 當筆總額外花費: 0 },
		});
		expect(s.budgets[4]).toEqual({
			category: "訂閱",
			美金: { 編列預算: 71.37, 總和: 71.37, 剩餘: 0 },
			新臺幣: { 編列預算: 10700, 總和: 6508, 剩餘: 4192 },
		});
		expect(s).not.toHaveProperty("本月超支");
		expect(s).not.toHaveProperty("本月超支（加上回補）");
	});

	it("month_summary returns null for summary rows the tab doesn't have", async () => {
		const g = budgetGrid();
		g[35] = [];
		g[36] = [];
		const s = (await monthSummary(budgetClient({ "11 月": g }), 11)) as unknown as BudgetMonthSummary;
		expect(s["本月美金超支（加上回補）"]).toBeNull();
		expect(s["本月新臺幣超支（加上回補）"]).toBeNull();
	});

	it("add_expense, delete_expense and month_summary refuse an old-shape tab", async () => {
		const adding = budgetClient({ "11 月": legacyBudgetGrid() });
		await expect(addExpense(adding, { item: "x", amount: 1, currency: "TWD", tag: "購物", month: 11 })).rejects.toThrow(/old single-currency/);
		const deleting = budgetClient({ "11 月": legacyBudgetGrid() });
		await expect(deleteExpense(deleting, { item: "Claude", month: 11 })).rejects.toThrow(/old single-currency/);
		await expect(monthSummary(budgetClient({ "11 月": legacyBudgetGrid() }), 11)).rejects.toThrow(/old single-currency/);
		expect(adding.batchUpdate).not.toHaveBeenCalled();
		expect(deleting.batchUpdate).not.toHaveBeenCalled();
	});

	it("get_categories lists the blocks on a budget month", async () => {
		const client = budgetClient({ "11 月": budgetGrid() });
		expect(await getCategories(client, 11)).toEqual({
			tab: "11 月",
			source: "BUDGET_BLOCKS",
			categories: ["中餐", "購物", "吃喝", "生活用品", "訂閱", "交通", "娛樂", "學貸", "其他"],
		});
	});

	it("set_income, delete_expense and get_categories refuse a truncated read, writing nothing", async () => {
		const truncated = () => {
			const client = budgetClient({ "11 月": budgetGrid() });
			(client.readRange as any).mockResolvedValue({ range: "x", values: budgetGrid(), truncated: true });
			return client;
		};
		const ops: Array<(c: SheetsClient) => Promise<unknown>> = [
			(c) => setIncome(c, { item: "沛還", amount: 700, currency: "USD", month: 11 }),
			(c) => deleteExpense(c, { item: "Claude", month: 11 }),
			(c) => getCategories(c, 11),
		];
		for (const op of ops) {
			const client = truncated();
			await expect(op(client)).rejects.toThrow(/truncated/);
			expect(client.batchUpdate).not.toHaveBeenCalled();
		}
	});
});

describe("old-layout months are read-only", () => {
	const READ_ONLY = "9 月 is on the old layout, which is read-only now — month_summary still reads it; no tool writes to it.";
	const oldClient = () => budgetClient({ "9 月": oldMonthGrid() });

	it("add_expense refuses and writes nothing", async () => {
		const client = oldClient();
		await expect(addExpense(client, { item: "晚餐", amount: 200, currency: "TWD", tag: "吃喝", month: 9 })).rejects.toThrow(READ_ONLY);
		expect(client.batchUpdate).not.toHaveBeenCalled();
	});

	it("delete_expense refuses and writes nothing", async () => {
		const client = oldClient();
		await expect(deleteExpense(client, { item: "Google Cloud", month: 9 })).rejects.toThrow(READ_ONLY);
		expect(client.batchUpdate).not.toHaveBeenCalled();
	});

	it("set_income refuses a month on the 本月…收支狀況 layout it used to accept, writing nothing", async () => {
		const client = oldClient();
		await expect(setIncome(client, { item: "沛還", amount: 700, currency: "USD", month: 9 })).rejects.toThrow(READ_ONLY);
		expect(client.batchUpdate).not.toHaveBeenCalled();
	});

	it("add_transfer (usd) refuses and writes nothing", async () => {
		const client = oldClient();
		await expect(addTransfer(client, { ntd: 30000, usd: 900, fee: 15, month: 9 })).rejects.toThrow(READ_ONLY);
		expect(client.batchUpdate).not.toHaveBeenCalled();
	});

	it("get_categories refuses after the one layout read", async () => {
		const client = oldClient();
		await expect(getCategories(client, 9)).rejects.toThrow(READ_ONLY);
		expect(client.readRange).toHaveBeenCalledTimes(1);
	});

	it("month_summary still reads an old-layout month", async () => {
		const s = (await monthSummary(budgetClient({ "9 月": oldMonthGrid() }), 9)) as any;
		expect(s.layout).toBeUndefined();
		expect(s.tab).toBe("9 月");
		expect(s.incomes).toEqual([
			{ item: "沛還", currency: "USD", amount: 700 },
			{ item: "薪水", currency: "TWD", amount: 65271 },
		]);
	});
});

describe("startMonth from the Budget Based template", () => {
	const NOW = { now: new Date("2026-10-20T04:00:00Z"), newSheetId: 555 };
	const write = (rowIndex: number, columnIndex: number, v: string | number) => ({
		updateCells: { start: { sheetId: 555, rowIndex, columnIndex }, rows: [{ values: [cellData(v)] }], fields: "userEnteredValue" },
	});

	it("builds 11 月 from the template with carries to 10 月 and the locked-rate formula", async () => {
		// '11 月' has a grid (what the duplicate will read back) but isn't in listTabs yet.
		const client = budgetClient({ "Budget Based": budgetGrid(), "10 月": oldMonthGrid(), "11 月": budgetGrid() }, ["Budget Based", "10 月"]);
		const r = await startMonth(client, 11, NOW);
		const calls = (client.batchUpdate as any).mock.calls.map((c: any) => c[0]);
		// One atomic batch: the duplicate (with a pre-chosen sheetId) and every write into the copy.
		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual([
			{ duplicateSheet: { sourceSheetId: 900, insertSheetIndex: 0, newSheetName: "11 月", newSheetId: 555 } },
			write(0, 0, "11 月花費"),
			write(2, 3, "=IF(-('10 月'!D43) > 0, -('10 月'!D43), 0)"),
			write(3, 4, "=IF(-('10 月'!D44) > 0, -('10 月'!D44), 0)"),
			write(22, 2, rateFormula(2026, 11)),
		]);
		expect(r).toMatchObject({ tab: "11 月", layout: "budget", template: "Budget Based", carriesFrom: "10 月" });
		expect(r).not.toHaveProperty("replacedTab");
		expect((r as any).startingEntries["訂閱"]).toEqual(["ElevenLabs", "iCloud", "Google One", "Netflix", "ChatGPT", "Claude"]);
	});

	it("a failed read writes nothing — no half-built month", async () => {
		const client = budgetClient({ "Budget Based": budgetGrid(), "10 月": oldMonthGrid() }, ["Budget Based", "10 月"]);
		const real = (client.readRange as any).getMockImplementation();
		(client.readRange as any).mockImplementation(async (range: string) => {
			if (range.startsWith("'10 月'")) throw new Error("Sheets API error (503)");
			return real(range);
		});
		await expect(startMonth(client, 11, NOW)).rejects.toThrow(/503/);
		expect(client.batchUpdate).not.toHaveBeenCalled();
	});

	it("missing previous month → both carries 0", async () => {
		const client = budgetClient({ "Budget Based": budgetGrid(), "11 月": budgetGrid() }, ["Budget Based"]);
		const r = await startMonth(client, 11, NOW);
		const final = (client.batchUpdate as any).mock.calls[0][0];
		expect(final).toEqual(expect.arrayContaining([write(2, 3, 0), write(3, 4, 0)]));
		expect(r).toMatchObject({ carriesFrom: null });
	});

	it("start_month(1) in December locks to DATE(2027,1,1)", async () => {
		const client = budgetClient({ "Budget Based": budgetGrid(), "12 月": oldMonthGrid(), "1 月": budgetGrid() }, ["Budget Based", "12 月"]);
		await startMonth(client, 1, { now: new Date("2026-12-15T04:00:00Z"), newSheetId: 555 });
		expect((client.batchUpdate as any).mock.calls[0][0]).toEqual(expect.arrayContaining([write(22, 2, rateFormula(2027, 1))]));
	});

	it("refuses an existing month, old layout or budget, writing nothing", async () => {
		for (const existing of [oldMonthGrid(), budgetGrid()]) {
			const client = budgetClient({ "Budget Based": budgetGrid(), "10 月": oldMonthGrid(), "11 月": existing }, ["Budget Based", "10 月", "11 月"]);
			await expect(startMonth(client, 11, NOW)).rejects.toThrow('Tab "11 月" already exists — refusing to overwrite it.');
			expect(client.batchUpdate).not.toHaveBeenCalled();
		}
	});

	it("refuses without the Budget Based template instead of duplicating the previous month, writing nothing", async () => {
		const client = budgetClient({ "9 月": oldMonthGrid(), "10 月": oldMonthGrid() }, ["9 月"]);
		await expect(startMonth(client, 10)).rejects.toThrow('No "Budget Based" template tab — start_month builds every month from it.');
		expect(client.batchUpdate).not.toHaveBeenCalled();
	});
});
