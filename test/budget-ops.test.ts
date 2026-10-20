import { describe, expect, it, vi } from "vitest";
import { dateSerial } from "../src/conventions";
import { addExpense, cellData } from "../src/finance-ops";
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
