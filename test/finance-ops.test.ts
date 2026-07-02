import { describe, expect, it, vi } from "vitest";
import {
	adaptRowFormula,
	adjustColumnRefsForInsert,
	addExpense,
	addTripEntry,
	cellData,
	colLetter,
	findRowByValue,
	monthSummary,
	spliceIntoSum,
	startMonth,
	stripRefErrors,
} from "../src/finance-ops";
import type { SheetsClient } from "../src/sheets-client";

describe("formula surgery", () => {
	it("splices a cell ref into a sum formula", () => {
		expect(spliceIntoSum("=sum(C22,C3)", "C24")).toBe("=sum(C22,C3,C24)");
		expect(spliceIntoSum("=sum(C4,C5,C6,C7,C8,C9,C10,C11,C12,C18,C20,C16)", "C23")).toBe(
			"=sum(C4,C5,C6,C7,C8,C9,C10,C11,C12,C18,C20,C16,C23)",
		);
		expect(spliceIntoSum("=SUM(C13,C14)", "C15")).toBe("=SUM(C13,C14,C15)");
	});

	it("refuses to splice into a non-sum formula", () => {
		expect(() => spliceIntoSum("=20000", "C9")).toThrow("not a sum");
	});

	it("refuses to splice into nested or non-flat formulas (fail-closed)", () => {
		expect(() => spliceIntoSum("=ROUND(SUM(C1:C10),2)", "C24")).toThrow("not a sum");
		expect(() => spliceIntoSum('=SUM(A1:A10)+SUMIF(B:B,"x",C:C)', "C24")).toThrow("not a sum");
	});

	it("does not touch digit-bearing function names when re-targeting rows", () => {
		expect(adaptRowFormula("=LOG10(E5)", 10, 99)).toBe("=LOG10(E5)");
	});

	it("shifts C-refs at/below the insertion row down by one", () => {
		expect(adjustColumnRefsForInsert("=sum(C22,C3)", "C", 24)).toBe("=sum(C22,C3)");
		expect(adjustColumnRefsForInsert("=sum(C22,C3)", "C", 22)).toBe("=sum(C23,C3)");
		expect(adjustColumnRefsForInsert("=SUM(C3:C24)", "C", 10)).toBe("=SUM(C3:C25)");
	});

	it("strips #REF! entries left by row deletions", () => {
		expect(stripRefErrors("=sum(#REF!,C3)")).toBe("=sum(C3)");
		expect(stripRefErrors("=sum(C4,#REF!,C6)")).toBe("=sum(C4,C6)");
		expect(stripRefErrors("=sum(C4,#REF!)")).toBe("=sum(C4)");
	});

	it("re-targets a single-row formula to another row", () => {
		expect(adaptRowFormula("=E5*0.22", 5, 9)).toBe("=E9*0.22");
		expect(adaptRowFormula("=CEILING(F12)", 12, 30)).toBe("=CEILING(F30)");
		// must not touch a different row number that merely contains the digits
		expect(adaptRowFormula("=E5*105", 5, 9)).toBe("=E9*105");
	});
});

describe("grid helpers", () => {
	it("findRowByValue returns the 1-indexed row of an exact match", () => {
		const values = [["9 月花費"], ["", "美金"], ["上月透支", "", "13,603.67"], ["", "花費總額", "72,127.21"]];
		expect(findRowByValue(values, 1, "花費總額")).toBe(4);
		expect(findRowByValue(values, 0, "上月透支")).toBe(3);
		expect(findRowByValue(values, 0, "missing")).toBeNull();
	});

	it("cellData picks the right CellData variant", () => {
		expect(cellData("中餐")).toEqual({ userEnteredValue: { stringValue: "中餐" } });
		expect(cellData(250)).toEqual({ userEnteredValue: { numberValue: 250 } });
		expect(cellData("=B4*2")).toEqual({ userEnteredValue: { formulaValue: "=B4*2" } });
		expect(cellData(null)).toEqual({});
	});

	it("colLetter converts 0-indexed columns", () => {
		expect(colLetter(0)).toBe("A");
		expect(colLetter(8)).toBe("I");
		expect(colLetter(26)).toBe("AA");
	});
});

/** Grid mirroring the real 9月 layout (FORMULA render). Row = index+1. */
function monthGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["9 月花費"];
	g[1] = ["", "美金", "新臺幣"];
	g[2] = ["上月透支", "", "=IF(-'8 月'!B32 > 0, -'8 月'!B32, 0)"];
	g[3] = ["Google Cloud", 11.53, '=B4*GOOGLEFINANCE("CURRENCY:USDTWD")'];
	g[4] = ["ElevenLabs", 6, '=B5*GOOGLEFINANCE("CURRENCY:USDTWD")', "", "訂閱費", "=sum(C4,C5)"];
	g[5] = ["iCloud", 9.99, '=B6*GOOGLEFINANCE("CURRENCY:USDTWD")', "", "基本房租生活費", "=20000"];
	g[6] = ["電話費", "", 1261, "", "交通中餐等等雜支", "=sum(C7)"];
	g[7] = ["近鐵 80000系", "", "='火車模型'!C4", "", "本月額外雜支", "=sum(C8,C3)"];
	// rows 9-10 (indices 8-9) empty inside the window
	g[10] = ["", "花費總額", "=SUM(C3:C10)"];
	g[12] = ["沛還", 20500];
	g[13] = ["薪水", 63913];
	g[14] = ["剩餘", "=sum(B13:B14)-C11"];
	g[15] = ["美金支付", 640.42];
	return g;
}

function fakeClient(grid: unknown[][]): SheetsClient {
	return {
		readRange: vi.fn(async () => ({ range: "x", values: grid, truncated: false })),
		getSheetId: vi.fn(async () => 111),
		batchUpdate: vi.fn(async () => ({ replies: [{}] })),
	} as unknown as SheetsClient;
}

describe("addExpense", () => {
	it("writes a TWD expense into the first empty window row and splices the category formula", async () => {
		const client = fakeClient(monthGrid());

		const result = await addExpense(client, { item: "晚餐", amount: 250, currency: "TWD", month: 9 });

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:F60", "FORMULA"]);
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toEqual([
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 8, columnIndex: 0 },
					rows: [{ values: [
						{ userEnteredValue: { stringValue: "晚餐" } },
						{},
						{ userEnteredValue: { numberValue: 250 } },
					] }],
					fields: "userEnteredValue",
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 7, columnIndex: 5 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=sum(C8,C3,C9)" } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(result).toMatchObject({ tab: "9 月", row: 9, inserted: false, category: "額外雜支", categoryFormula: "=sum(C8,C3,C9)" });
	});

	it("writes a USD expense with the GOOGLEFINANCE conversion formula", async () => {
		const client = fakeClient(monthGrid());

		await addExpense(client, { item: "API credits", amount: 30, currency: "USD", category: "訂閱費", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toEqual([
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 8, columnIndex: 0 },
					rows: [
						{
							values: [
								{ userEnteredValue: { stringValue: "API credits" } },
								{ userEnteredValue: { numberValue: 30 } },
								{ userEnteredValue: { formulaValue: '=B9*GOOGLEFINANCE("CURRENCY:USDTWD")' } },
							],
						},
					],
					fields: "userEnteredValue",
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 4, columnIndex: 5 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=sum(C4,C5,C9)" } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
	});

	it("inserts a row inside the SUM window when no empty row exists, adjusting formula refs", async () => {
		const grid = monthGrid();
		grid[8] = ["already", "", 1];
		grid[9] = ["full", "", 2];

		const client = fakeClient(grid);
		const result = await addExpense(client, { item: "加購", amount: 100, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// new row is 10 (1-indexed); category 額外雜支 formula refs C8,C3 (< 10) stay put
		expect(requests).toEqual([
			{
				insertDimension: {
					range: { sheetId: 111, dimension: "ROWS", startIndex: 9, endIndex: 10 },
					inheritFromBefore: true,
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 9, columnIndex: 0 },
					rows: [
						{
							values: [
								{ userEnteredValue: { stringValue: "加購" } },
								{},
								{ userEnteredValue: { numberValue: 100 } },
							],
						},
					],
					fields: "userEnteredValue",
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 7, columnIndex: 5 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=sum(C8,C3,C10)" } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(result).toMatchObject({ row: 10, inserted: true });
	});

	it("shifts the category formula row when it sits at/below the insertion point", async () => {
		const g: unknown[][] = [];
		g[0] = ["title"];
		g[2] = ["a", "", 1];
		g[3] = ["b", "", 2];
		g[4] = ["c", "", 3, "", "本月額外雜支", "=sum(C3)"];
		g[5] = ["", "花費總額", "=SUM(C3:C5)"];
		const client = fakeClient(g);

		const result = await addExpense(client, { item: "x", amount: 5, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].insertDimension.range).toEqual({
			sheetId: 111,
			dimension: "ROWS",
			startIndex: 4,
			endIndex: 5,
		});
		expect(requests[2].updateCells.start).toEqual({ sheetId: 111, rowIndex: 5, columnIndex: 5 });
		expect(requests[2].updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: "=sum(C3,C5)" } },
		]);
		expect(result).toMatchObject({ row: 5, inserted: true });
	});

	it("rejects unknown categories and missing anchors without writing", async () => {
		const client = fakeClient(monthGrid());
		await expect(addExpense(client, { item: "x", amount: 1, currency: "TWD", category: "咖啡", month: 9 })).rejects.toThrow(
			'Unknown category "咖啡"',
		);

		const noTotal = fakeClient([["nothing here"]]);
		await expect(addExpense(noTotal, { item: "x", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("花費總額");
		expect((noTotal.batchUpdate as any).mock.calls.length).toBe(0);
	});
});

describe("monthSummary", () => {
	it("returns unformatted numbers keyed to the sheet's own labels", async () => {
		// UNFORMATTED render: numbers where the sheet computes values
		const grid = monthGrid();
		grid[2] = ["上月透支", "", 13603.67];
		grid[4] = ["ElevenLabs", 6, 191.43, "", "訂閱費", 26843.6];
		grid[6] = ["電話費", "", 1261, "", "交通中餐等等雜支", 5511];
		grid[7] = ["近鐵 80000系", "", 5690.37, "", "本月額外雜支", 19294.03];
		grid[10] = ["", "花費總額", 72127.21];
		grid[14] = ["剩餘", 12285.79];

		const client = fakeClient(grid);
		const result = await monthSummary(client, 9);

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:F60", "UNFORMATTED_VALUE"]);
		expect(result).toEqual({
			tab: "9 月",
			花費總額: 72127.21,
			上月透支: 13603.67,
			categories: { 訂閱費: 26843.6, 交通中餐雜支: 5511, 額外雜支: 19294.03 },
			薪水: 63913,
			沛還: 20500,
			剩餘: 12285.79,
			美金支付: 640.42,
		});
	});
});

describe("startMonth", () => {
	function startMonthClient(grid: unknown[][], tabs: string[]) {
		const batchUpdate = vi
			.fn()
			.mockResolvedValueOnce({ replies: [{ duplicateSheet: { properties: { sheetId: 555 } } }] })
			.mockResolvedValue({ replies: [{}] });
		return {
			listTabs: vi.fn(async () => tabs.map((title) => ({ title, rowCount: 1000, columnCount: 26 }))),
			getSheetId: vi.fn(async () => 111),
			readRange: vi.fn(async () => ({ range: "x", values: grid, truncated: false })),
			batchUpdate,
		} as unknown as SheetsClient;
	}

	it("duplicates the previous month, rewires 上月透支, and deletes one-off rows bottom-up", async () => {
		const client = startMonthClient(monthGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		const batch = (client.batchUpdate as any).mock.calls;
		expect(batch[0][0]).toEqual([
			{ duplicateSheet: { sourceSheetId: 111, insertSheetIndex: 0, newSheetName: "10 月" } },
		]);
		const requests = batch[1][0];
		expect(requests[0]).toEqual({
			updateCells: {
				start: { sheetId: 555, rowIndex: 0, columnIndex: 0 },
				rows: [{ values: [{ userEnteredValue: { stringValue: "10 月花費" } }] }],
				fields: "userEnteredValue",
			},
		});
		expect(requests[1]).toEqual({
			updateCells: {
				start: { sheetId: 555, rowIndex: 2, columnIndex: 2 },
				rows: [{ values: [{ userEnteredValue: { formulaValue: "=IF(-'9 月'!B32 > 0, -'9 月'!B32, 0)" } }] }],
				fields: "userEnteredValue",
			},
		});
		// 近鐵 80000系 (row 8) is the only non-recurring item in the fixture
		expect(requests[2]).toEqual({
			deleteDimension: { range: { sheetId: 555, dimension: "ROWS", startIndex: 7, endIndex: 8 } },
		});
		expect(result).toEqual({
			tab: "10 月",
			duplicatedFrom: "9 月",
			kept: ["上月透支", "Google Cloud", "ElevenLabs", "iCloud", "電話費"],
			cleared: ["近鐵 80000系"],
		});
	});

	it("scrubs #REF! from category formulas after deletions", async () => {
		const grid = monthGrid();
		const client = startMonthClient(grid, ["9 月", "8 月"]);
		// After the deletion batch, the re-read returns a grid whose 額外雜支 formula has a #REF!
		(client.readRange as any)
			.mockResolvedValueOnce({ range: "x", values: grid, truncated: false })
			.mockResolvedValueOnce({
				range: "x",
				values: (() => {
					const g = monthGrid();
					g[7] = ["", "", "", "", "本月額外雜支", "=sum(#REF!,C3)"];
					return g;
				})(),
				truncated: false,
			});

		await startMonth(client, 10);

		const batch = (client.batchUpdate as any).mock.calls;
		const scrub = batch[2][0];
		expect(scrub).toEqual([
			{
				updateCells: {
					start: { sheetId: 555, rowIndex: 7, columnIndex: 5 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=sum(C3)" } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
	});

	it("refuses to overwrite an existing tab and requires the previous month", async () => {
		const exists = startMonthClient(monthGrid(), ["10 月", "9 月"]);
		await expect(startMonth(exists, 10)).rejects.toThrow('"10 月" already exists');

		const noPrev = startMonthClient(monthGrid(), ["7 月"]);
		await expect(startMonth(noPrev, 10)).rejects.toThrow('"9 月" not found');
		expect((noPrev.batchUpdate as any).mock.calls.length).toBe(0);
	});
});

describe("addTripEntry", () => {
	/** Trip grid: 模型 block at cols A-G (0-6), 書 block at I-O (8-14). */
	function tripGrid(): unknown[][] {
		const g: unknown[][] = [];
		g[0] = ["日期", "店鋪", "品項", "支付方式", "日幣原價", "臺幣 0.22 匯率", "臺幣 進位", "", "日期", "店鋪", "品項", "支付方式", "日幣原價"];
		g[1] = ["模型", "", "", "", "", "", "", "", "書"];
		g[2] = ["10/08 16:03", "Yodobashi 京都", "鑷子", "Suica", 1373, "=E3*0.22", "=CEILING(F3)"];
		return g;
	}

	function tripClient(grid: unknown[][]): SheetsClient {
		return {
			readRange: vi.fn(async () => ({ range: "x", values: grid, truncated: false })),
			updateRange: vi.fn(async () => ({ updatedRange: "'京都'!A4:G4", updatedCells: 7 })),
		} as unknown as SheetsClient;
	}

	it("appends to the first empty row of the category block, adapting the previous row's formulas", async () => {
		const client = tripClient(tripGrid());

		const result = await addTripEntry(client, {
			tab: "京都",
			category: "模型",
			date: "10/09 11:00",
			shop: "Volks",
			item: "N規小物",
			paymentMethod: "Suica",
			jpy: 2200,
		});

		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!A4:G4",
			[["10/09 11:00", "Volks", "N規小物", "Suica", 2200, "=E4*0.22", "=CEILING(F4)"]],
		]);
		expect(result).toMatchObject({ row: 4, category: "模型" });
	});

	it("uses the 0.22 fallback when the block has no data rows, offset to the block's columns", async () => {
		const client = tripClient(tripGrid());

		await addTripEntry(client, {
			tab: "京都",
			category: "書",
			date: "10/09",
			shop: "京都鐵道博物館",
			item: "Guide Book",
			paymentMethod: "Suica",
			jpy: 1100,
		});

		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!I3:O3",
			[["10/09", "京都鐵道博物館", "Guide Book", "Suica", 1100, "=M3*0.22", "=CEILING(N3)"]],
		]);
	});

	it("names the available blocks when the category is missing", async () => {
		const client = tripClient(tripGrid());
		await expect(
			addTripEntry(client, { tab: "京都", category: "食物", date: "x", shop: "x", item: "x", paymentMethod: "x", jpy: 1 }),
		).rejects.toThrow("模型, 書");
	});
});
