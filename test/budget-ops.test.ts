import { describe, expect, it, vi } from "vitest";
import { dateSerial } from "../src/conventions";
import { addExpense, cellData, deleteExpense, setIncome } from "../src/finance-ops";
import type { SheetsClient } from "../src/sheets-client";
import { budgetGrid } from "./budget-fixtures";

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
