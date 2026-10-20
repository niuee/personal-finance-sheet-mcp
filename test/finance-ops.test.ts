import { describe, expect, it, vi } from "vitest";
import {
	adaptRowFormula,
	addTransfer,
	addTripEntry,
	annotateRows,
	cellData,
	colIndex,
	colLetter,
	expandAnchorRange,
	findBrokenRefs,
	findCells,
	FIND_CELLS_CAP,
	findIncomeWindow,
	findLunchSection,
	findRowByLabels,
	findRowByValue,
	findTransferSection,
	JPY_TRANSFER_SECTION,
	findTripBlocks,
	findTripBudgetSection,
	FULL_GRID_READ,
	monthSummary,
	parseColumnBand,
	safeDeleteRows,
	safeUpdateRange,
	TRANSFER_JPY_GRID_READ,
	TRIP_BUDGET_READ,
	tripBudgetStatus,
} from "../src/finance-ops";
import { dateSerial } from "../src/conventions";
import type { SheetsClient } from "../src/sheets-client";

describe("formula surgery", () => {
	it("does not touch digit-bearing function names when re-targeting rows", () => {
		expect(adaptRowFormula("=LOG10(E5)", 10, 99)).toBe("=LOG10(E5)");
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
		expect(colLetter(25)).toBe("Z");
		expect(colLetter(31)).toBe("AF");
	});
});

/** Legacy-layout grid (6月 2026 and earlier): no 總預算/income anchors here, a 剩餘 bottom line, no 銀行餘額 block (FORMULA render). Row = index+1. */
function monthGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["9 月花費"];
	g[1] = ["日期", "項目", "類別", "美金", "新臺幣"];
	g[2] = [46266, "上月透支", "透支", "", "=IF(-'8 月'!D32 > 0, -'8 月'!D32, 0)"];
	g[3] = ["", "Google Cloud", "訂閱", 11.53, '=D4*GOOGLEFINANCE("CURRENCY:USDTWD")'];
	g[4] = ["", "ElevenLabs", "訂閱", 6, '=D5*GOOGLEFINANCE("CURRENCY:USDTWD")'];
	g[5] = ["", "iCloud", "訂閱", 9.99, '=D6*GOOGLEFINANCE("CURRENCY:USDTWD")'];
	g[6] = ["", "電話費", "生活用品", "", 1261];
	g[7] = [dateSerial(2026, 9, 1), "近鐵 80000系", "購物", "", "='火車模型'!D4"];
	// rows 9-10 (indices 8-9) empty inside the window
	g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)"];
	g[12] = ["", "沛還", "", 20500];
	g[13] = ["", "薪水", "", 63913];
	g[14] = ["", "剩餘", "", "=sum(D13:D14)-E11"];
	g[15] = ["", "美金支付", "", 640.42];
	return g;
}

/** Old-layout grid (6月 2026 and earlier): 總預算 header, plain 收入 cells, 剩餘 + 美金支付/新臺幣支付 — frozen history the tools refuse to write into. Row = index+1. */
function oldLayoutGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["9 月花費"];
	g[1] = ["日期", "項目", "類別", "美金", "新臺幣"];
	g[2] = [46266, "上月透支", "透支", "", "=IF(-'8 月'!D32 > 0, -'8 月'!D32, 0)"];
	g[3] = ["", "Google Cloud", "訂閱", 11.53, '=D4*GOOGLEFINANCE("CURRENCY:USDTWD")'];
	g[4] = ["", "電話費", "生活用品", "", 1261];
	// rows 6-10 empty inside the window
	g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)"];
	g[12] = ["", "總預算"];
	g[13] = ["", "沛還", "", 20500];
	g[14] = ["", "薪水", "", 63913];
	g[15] = ["", "剩餘", "", "=sum(D14:D15)-E11"];
	g[17] = ["", "美金支付", "", "=SUM(D4:D6)"];
	g[18] = ["", "新臺幣支付", "", "=E5"];
	g[20] = ["", "銀行餘額"];
	g[21] = ["", "美金收入", "", 0];
	g[22] = ["", "美金支出", "", "=SUM(D3:D10)"];
	g[23] = ["", "上月美金餘額", "", "='8 月'!D25"];
	g[24] = ["", "美金餘額", "", "=D24+D22-D23"];
	g[25] = ["", "新臺幣收入", "", 0];
	g[26] = ["", "新臺幣支出", "", '=SUMIF(D3:D10,"",E3:E10)'];
	g[27] = ["", "上月新臺幣餘額", "", "='8 月'!D29"];
	g[28] = ["", "新臺幣餘額", "", "=D28+D26-D27"];
	return g;
}

/** Grid mirroring the real monthly layout from 7月 2026 on (9月 flavour): split carries, 項目/幣別/金額 income header, 本月…收支狀況 rows, 本月初/本月底 ledgers. Row = index+1. */
function currentMonthGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["9 月花費"];
	g[1] = ["日期", "項目", "類別", "美金", "新臺幣", "支付幣別", "支付方式"];
	g[2] = ["", "上月美金透支", "透支", "=IF(-('8 月'!D19) > 0, -('8 月'!D19), 0)", '=D3*GOOGLEFINANCE("CURRENCY:USDTWD")', "USD"];
	g[3] = ["", "上月新臺幣透支", "透支", "", "=IF(-('8 月'!D20) > 0, -('8 月'!D20), 0)", "TWD"];
	g[4] = ["", "Google Cloud", "訂閱", 11.53, '=D5*GOOGLEFINANCE("CURRENCY:USDTWD")', "USD"];
	g[5] = [dateSerial(2026, 7, 1), "電話費", "生活用品", "", 1261, "TWD"];
	// rows 7-10 empty inside the window
	g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)"];
	g[12] = ["", "總預算"];
	g[13] = ["", "項目", "幣別", "金額"];
	g[14] = ["", "沛還", "USD", 600];
	g[15] = ["", "薪水", "TWD", 68587];
	g[16] = ["", "多一個月薪水", "TWD", 68587];
	// row 18 blank — the gap between the income list and the 收支狀況 rows
	g[18] = ["", "本月美金收支狀況", "", "=D23-D24"];
	g[19] = ["", "本月新臺幣收支狀況", "", "=D27-D28+D29"];
	g[21] = ["", "銀行餘額"];
	g[22] = ["", "本月美金收入", "", '=SUMIF(C14:C17,"USD",D14:D17)'];
	g[23] = ["", "本月美金支出", "", '=SUMIF(F3:F10,"USD",D3:D10)'];
	g[24] = ["", "本月初美金餘額", "", 0];
	g[25] = ["", "本月底美金餘額", "", "=D25+D23-D24+K36"];
	g[26] = ["", "本月新臺幣收入", "", '=SUMIF(C14:C17,"TWD",D14:D17)'];
	g[27] = ["", "本月新臺幣支出", "", '=SUMIF(F3:F10,"TWD",E3:E10)+N36'];
	g[28] = ["", "午餐超支或回補", "", "=R35"];
	g[29] = ["", "本月初新臺幣餘額", "", "='8 月'!D32"];
	g[30] = ["", "保守預計本月底新臺幣餘額", "", "=D30+D27-D28-I36+IF(R35>0, 0, R35)"];
	g[31] = ["", "本月底新臺幣餘額", "", "=D30+D27-D28-I36+D29"];
	return g;
}

/** currentMonthGrid + a 乾坤大挪移 transfer block at H33:N36 (data slot row 35 empty). */
function transferGrid(): unknown[][] {
	const g = currentMonthGrid();
	g[32] = ["", "", "", "", "", "", "", "乾坤大挪移"];
	g[33] = ["", "", "", "", "", "", "", "日期", "新臺幣", "當下美金", "實際美金", "匯差", "手續費", "當筆總額外花費"];
	// row 35 empty — the first data slot
	g[35] = ["", "", "", "", "", "", "", "總和", "=sum(I35)", "=sum(J35)", "=sum(K35)", "=sum(L35)", "=sum(M35)", "=sum(N35)"];
	return g;
}

/** transferGrid + a 午餐預算 lunch block at P33:R38 (data slot row 37 empty). */
function lunchGrid(): unknown[][] {
	const g = transferGrid();
	const put = (idx: number, col: number, v: unknown) => {
		(g[idx] ??= [])[col] = v;
	};
	put(32, 15, "午餐預算");
	put(33, 15, "編列預算");
	put(33, 17, "剩餘 (負數會加回去支出）");
	put(34, 15, "=E5"); // 編列預算 ← the 中餐 expense cell
	put(34, 17, "=P35-R38"); // 剩餘 = 編列預算 − 總和
	put(35, 15, "日期");
	put(35, 16, "項目");
	put(35, 17, "金額");
	put(35, 18, "支付方式");
	// row 37 (index 36) empty — the first data slot
	put(37, 16, "總和");
	put(37, 17, "=sum(R37)");
	return g;
}

function fakeClient(grid: unknown[][]): SheetsClient {
	return {
		readRange: vi.fn(async () => ({ range: "x", values: grid, truncated: false })),
		getSheetId: vi.fn(async () => 111),
		batchUpdate: vi.fn(async () => ({ replies: [{}] })),
	} as unknown as SheetsClient;
}

describe("window helpers", () => {
	it("findRowByLabels prefers earlier labels and falls back", () => {
		const values = [["", "新臺幣餘額"], ["", "總美金餘額"]];
		expect(findRowByLabels(values, 1, ["總美金餘額", "美金餘額"])).toBe(2);
		expect(findRowByLabels(values, 1, ["總新臺幣餘額", "新臺幣餘額"])).toBe(1);
		expect(findRowByLabels(values, 1, ["missing", "also missing"])).toBeNull();
	});

	it("findIncomeWindow detects current and old layouts, skips the 項目 header, null without anchors", () => {
		expect(findIncomeWindow(currentMonthGrid())).toEqual({ start: 15, end: 18, current: true });
		expect(findIncomeWindow(oldLayoutGrid())).toEqual({ start: 14, end: 15, current: false });
		expect(findIncomeWindow(monthGrid())).toBeNull(); // no 總預算 header
		expect(findIncomeWindow([["x"]])).toBeNull();
	});
});

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
		const s = findTransferSection(jpyTransferGrid(), "2026/07/25 京都東京", JPY_TRANSFER_SECTION);
		expect(s).toEqual({ headerRow: 70, totalRow: 72 });
	});

	it("throws the trip-tab hint when the section is missing", () => {
		expect(() => findTransferSection([[]], "2026/07/25 京都東京", JPY_TRANSFER_SECTION)).toThrow(
			/乾坤大挪移.*trip tab/,
		);
	});
});

describe("findLunchSection", () => {
	it("locates the budget, header and 總和 rows from the anchor", () => {
		expect(findLunchSection(lunchGrid(), "9 月")).toEqual({ budgetRow: 35, headerRow: 36, totalRow: 38 });
	});

	it("accepts the legacy 中餐預算 anchor title", () => {
		const g = lunchGrid();
		(g[32] as unknown[])[15] = "中餐預算";
		expect(findLunchSection(g, "9 月")).toEqual({ budgetRow: 35, headerRow: 36, totalRow: 38 });
	});

	it("throws when the tab has no 午餐預算 section", () => {
		expect(() => findLunchSection(transferGrid(), "6 月")).toThrow("午餐預算");
	});

	it("throws when the header row under the anchor is missing", () => {
		const g = lunchGrid();
		(g[35] as unknown[])[15] = "";
		expect(() => findLunchSection(g, "9 月")).toThrow("日期");
	});

	it("throws when there is no 總和 row", () => {
		const g = lunchGrid();
		(g[37] as unknown[])[16] = "";
		expect(() => findLunchSection(g, "9 月")).toThrow("總和");
	});

	it("scans past a blank row that a transfer insert opened between the labels and values rows", () => {
		const g = lunchGrid();
		// simulate one add_transfer full-section insert landing between the
		// labels row (idx 33) and the values row (idx 34): values row shifts to
		// idx 35, header to idx 36, data slot to idx 37, 總和 to idx 38.
		g.splice(34, 0, []);
		expect(findLunchSection(g, "9 月")).toEqual({ budgetRow: 36, headerRow: 37, totalRow: 39 });
	});

	it("finds a header pushed further down than any fixed row cap would allow", () => {
		const g = lunchGrid();
		// ten rows opened between the 午餐預算 title and its 日期 header — the
		// finder used to give up after eight.
		g.splice(33, 0, ...Array.from({ length: 10 }, () => [] as unknown[]));
		expect(findLunchSection(g, "9 月")).toEqual({ budgetRow: 45, headerRow: 46, totalRow: 48 });
	});

	it("scans past a blank row that a whole-sheet-row insert opened between the values row and the header", () => {
		const g = lunchGrid();
		// live July 2026: a row inserted by hand into the income list (same
		// sheet rows as the lunch block) landed between the values row
		// (idx 34) and the header (idx 35) — values stay glued to the label.
		g.splice(35, 0, []);
		expect(findLunchSection(g, "9 月")).toEqual({ budgetRow: 35, headerRow: 37, totalRow: 39 });
	});
});

/** Like fakeClient, but the single-cell scratch read returns `rate` instead of the grid. */
function transferClient(grid: unknown[][], rate: unknown = 29.85): SheetsClient {
	return {
		readRange: vi.fn(async (range: string) =>
			range.includes(":")
				? { range, values: grid, truncated: false }
				: { range, values: [[rate]], truncated: false },
		),
		getSheetId: vi.fn(async () => 111),
		batchUpdate: vi.fn(async () => ({ replies: [{}] })),
	} as unknown as SheetsClient;
}

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

		expect((client.readRange as any).mock.calls[0]).toEqual([`'${TRIP}'!${TRANSFER_JPY_GRID_READ}`, "FORMULA"]);
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

	it("never reads or writes a month tab, whatever month the date falls in", async () => {
		for (const date of ["7/10", "2026-11-02"]) {
			const client = transferClient(jpyTransferGrid(), 0.208);
			const result = await addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 100, jpy: 470, fee: 0, date });
			const reads = (client.readRange as any).mock.calls.map((c: any) => c[0] as string);
			expect(reads.every((r: string) => r.startsWith(`'${TRIP}'!`))).toBe(true);
			expect((client.batchUpdate as any).mock.calls).toHaveLength(2); // scratch rate + the entry, nothing else
			expect(result).not.toHaveProperty("wiredMonthTab");
			expect(result).not.toHaveProperty("wiringNote");
		}
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

describe("monthSummary", () => {
	it("returns unformatted numbers keyed to the sheet's own labels", async () => {
		// UNFORMATTED render: numbers where the sheet computes values
		const grid = monthGrid();
		grid[2] = ["", "上月透支", "透支", "", 13603.67];
		grid[3] = ["", "Google Cloud", "訂閱", 11.53, 368.44];
		grid[4] = ["", "ElevenLabs", "訂閱", 6, 191.43];
		grid[5] = ["", "iCloud", "訂閱", 9.99, 319.23];
		grid[6] = ["", "電話費", "生活用品", "", 1261];
		grid[7] = ["", "近鐵 80000系", "購物", "", 5690.37];
		grid[10] = ["", "", "", "花費總額", 72127.21];
		grid[14] = ["", "剩餘", "", 12285.79];

		const client = fakeClient(grid);
		const result = await monthSummary(client, 9);

		expect((client.readRange as any).mock.calls[0]).toEqual([`'9 月'!${FULL_GRID_READ}`, "UNFORMATTED_VALUE"]);
		expect(result).toEqual({
			tab: "9 月",
			花費總額: 72127.21,
			上月透支: 13603.67,
			上月美金透支: null,
			上月新臺幣透支: null,
			午餐預算: null,
			午餐超支或回補: null,
			tags: { 透支: 13603.67, 訂閱: 368.44 + 191.43 + 319.23, 生活用品: 1261, 購物: 5690.37 },
			incomes: [],
			薪水: 63913,
			沛還: 20500,
			剩餘: 12285.79,
			本月美金收支狀況: null,
			本月新臺幣收支狀況: null,
			本月美金收入: null,
			本月美金支出: null,
			本月初美金餘額: null,
			本月底美金餘額: null,
			本月新臺幣收入: null,
			本月新臺幣支出: null,
			本月初新臺幣餘額: null,
			保守預計本月底新臺幣餘額: null,
			本月底新臺幣餘額: null,
		});
	});

	it("reports the current layout: split carries, incomes list (header skipped), 收支狀況 and 銀行餘額 keys", async () => {
		const grid = currentMonthGrid();
		// UNFORMATTED render: formulas come back as computed numbers
		grid[2] = ["", "上月美金透支", "透支", 20.5, 612.05, "USD"];
		grid[3] = ["", "上月新臺幣透支", "透支", "", 968.57, "TWD"];
		grid[4] = ["", "Google Cloud", "訂閱", 11.53, 368.44, "USD"];
		grid[5] = ["", "電話費", "生活用品", "", 1261, "TWD"];
		grid[10] = ["", "", "", "花費總額", 15233.11];
		grid[18] = ["", "本月美金收支狀況", "", -11.53];
		grid[19] = ["", "本月新臺幣收支狀況", "", 133296.33];
		grid[22] = ["", "本月美金收入", "", 600];
		grid[23] = ["", "本月美金支出", "", 611.53];
		grid[24] = ["", "本月初美金餘額", "", 0];
		grid[25] = ["", "本月底美金餘額", "", -11.53];
		grid[26] = ["", "本月新臺幣收入", "", 137174];
		grid[27] = ["", "本月新臺幣支出", "", 3877.67];
		grid[28] = ["", "午餐超支或回補", "", 3468];
		grid[29] = ["", "本月初新臺幣餘額", "", 5000];
		grid[30] = ["", "保守預計本月底新臺幣餘額", "", 138296.33];
		grid[31] = ["", "本月底新臺幣餘額", "", 141764.33];
		const client = fakeClient(grid);

		const result = await monthSummary(client, 9);

		expect(result).toEqual({
			tab: "9 月",
			花費總額: 15233.11,
			上月透支: null,
			上月美金透支: 20.5,
			上月新臺幣透支: 968.57,
			午餐預算: null,
			午餐超支或回補: 3468,
			// both carry rows are tagged 透支; the USD row's E holds the converted view
			tags: { 透支: 612.05 + 968.57, 訂閱: 368.44, 生活用品: 1261 },
			incomes: [
				{ item: "沛還", currency: "USD", amount: 600 },
				{ item: "薪水", currency: "TWD", amount: 68587 },
				{ item: "多一個月薪水", currency: "TWD", amount: 68587 },
			],
			薪水: 68587,
			沛還: 600,
			剩餘: null,
			本月美金收支狀況: -11.53,
			本月新臺幣收支狀況: 133296.33,
			本月美金收入: 600,
			本月美金支出: 611.53,
			本月初美金餘額: 0,
			本月底美金餘額: -11.53,
			本月新臺幣收入: 137174,
			本月新臺幣支出: 3877.67,
			本月初新臺幣餘額: 5000,
			保守預計本月底新臺幣餘額: 138296.33,
			本月底新臺幣餘額: 141764.33,
		});
	});

	it("reports the 午餐預算 section and 午餐超支或回補", async () => {
		const grid = lunchGrid();
		// UNFORMATTED render: formulas come back as computed numbers
		(grid[34] as unknown[])[15] = 3900; // 編列預算
		(grid[34] as unknown[])[17] = 3547; // 剩餘
		(grid[36] ??= [])[15] = 46204;
		(grid[36] as unknown[])[16] = "中餐";
		(grid[36] as unknown[])[17] = 353;
		(grid[37] as unknown[])[17] = 353; // 總和
		grid[28] = ["", "午餐超支或回補", "", 3547];
		const client = fakeClient(grid);

		const result = await monthSummary(client, 9);

		expect(result.午餐預算).toEqual({ 編列預算: 3900, 總和: 353, 剩餘: 3547 });
		expect(result.午餐超支或回補).toBe(3547);
	});

	it("resolves with 午餐預算 null when the lunch section is torn beyond recognition", async () => {
		const g = lunchGrid();
		(g[35] as unknown[])[15] = ""; // no 日期 header within 8 rows of the anchor
		const client = fakeClient(g);

		const result = await monthSummary(client, 9);

		expect(result.午餐預算).toBeNull();
	});

});

function tripClient(grid: unknown[][]): SheetsClient {
	return {
		readRange: vi.fn(async () => ({ range: "x", values: grid, truncated: false })),
		getSheetId: vi.fn(async () => 111),
		batchUpdate: vi.fn(async () => ({ replies: [{}] })),
		updateRange: vi.fn(async () => ({ updatedRange: "written", updatedCells: 7 })),
	} as unknown as SheetsClient;
}

/** The copyPaste request that carries the 支付方式 dropdown from an existing entry onto the new cell. */
function payValidationCopy(srcRow: number, destRow: number, payCol: number) {
	return {
		copyPaste: {
			source: { sheetId: 111, startRowIndex: srcRow - 1, endRowIndex: srcRow, startColumnIndex: payCol, endColumnIndex: payCol + 1 },
			destination: { sheetId: 111, startRowIndex: destRow - 1, endRowIndex: destRow, startColumnIndex: payCol, endColumnIndex: payCol + 1 },
			pasteType: "PASTE_DATA_VALIDATION",
		},
	};
}

/** The repeatCell that resets an inserted row's inherited cell fill back to default. */
function tripClearFill(row: number, startCol: number) {
	return {
		repeatCell: {
			range: { sheetId: 111, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: startCol, endColumnIndex: startCol + 7 },
			cell: {},
			fields: "userEnteredFormat.backgroundColor,userEnteredFormat.backgroundColorStyle",
		},
	};
}

/** The repeatCell requests that stamp the band's canonical formats onto the written row. */
function tripFormats(row: number, startCol: number) {
	const cell = (col: number, format: object, fields: string, width = 1) => ({
		repeatCell: {
			range: { sheetId: 111, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: col, endColumnIndex: col + width },
			cell: { userEnteredFormat: format },
			fields,
		},
	});
	return [
		cell(startCol, { numberFormat: { type: "DATE_TIME", pattern: 'mm"/"dd" "hh":"mm' } }, "userEnteredFormat.numberFormat"),
		cell(startCol + 1, { horizontalAlignment: "CENTER" }, "userEnteredFormat.horizontalAlignment", 2),
		cell(startCol + 4, { numberFormat: { type: "CURRENCY", pattern: "[$¥]#,##0" } }, "userEnteredFormat.numberFormat"),
		cell(startCol + 5, { numberFormat: { type: "CURRENCY", pattern: "[$NTD ]#,##0.00" } }, "userEnteredFormat.numberFormat", 2),
	];
}

describe("addTripEntry (mosaic)", () => {
	it("stamps the canonical formats (datetime with HH:mm, centered 店鋪/品項, ¥/NTD currency) onto the written row", async () => {
		const client = tripClient(mosaicGrid());

		await addTripEntry(client, {
			tab: "京都",
			category: "模型",
			date: "10/10 16:03",
			shop: "Volks",
			item: "N規小物",
			paymentMethod: "Suica",
			jpy: 2200,
		});

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests.slice(-4)).toEqual(tripFormats(4, 0));
	});

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

		// row 4 is the first empty band-A row; totals =SUM(E3:E5)/=SUM(G3:G5) already cover it,
		// so the batch is just the 支付方式 dropdown copy from the row-3 entry plus the row formats.
		expect((client.batchUpdate as any).mock.calls[0][0]).toEqual([payValidationCopy(3, 4, 3), ...tripFormats(4, 0)]);
		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!A4:G4",
			[["10/10", "Volks", "N規小物", "Suica", 2200, "=E4*0.22", "=CEILING(F4)"]],
		]);
		expect(result).toMatchObject({ category: "模型", row: 4, currency: "JPY" });
	});

	it("skips the dropdown copy when the block has no existing entry to copy from", async () => {
		const g: unknown[][] = [];
		g[0] = ["日期", "店鋪", "品項", "支付方式", "日幣原價", "臺幣", "臺幣進位"];
		g[1] = ["模型"];
		// rows 3-4 empty; total already covers them
		g[4] = ["", "", "", "分類總花費", "=SUM(E3:E4)", "", "=SUM(G3:G4)"];
		const client = tripClient(g);

		const result = await addTripEntry(client, {
			tab: "京都",
			category: "模型",
			date: "10/10",
			shop: "Volks",
			item: "N規小物",
			paymentMethod: "Suica",
			jpy: 2200,
		});

		// No prior entry to source the 支付方式 dropdown from → the batch is formats only.
		expect((client.batchUpdate as any).mock.calls[0][0]).toEqual(tripFormats(3, 0));
		expect((client.updateRange as any).mock.calls[0][0]).toBe("'京都'!A3:G3");
		expect(result).toMatchObject({ category: "模型", row: 3 });
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

		expect((client.batchUpdate as any).mock.calls[0][0]).toEqual([payValidationCopy(3, 5, 11), ...tripFormats(5, 8)]);
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
			payValidationCopy(3, 4, 3),
			...tripFormats(4, 0),
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
			payValidationCopy(10, 11, 11),
			...tripFormats(11, 8),
			tripClearFill(11, 8),
		]);
		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!I11:O11",
			[["10/10", "Sofmap", "SSD", "Suica", 9800, "=M11*0.22", "=CEILING(N11)"]],
		]);
		expect(result).toMatchObject({ category: "電子產品", row: 11, currency: "JPY" });
	});

	it("extends a single-cell =SUM(E37)-style total when inserting into a full block", async () => {
		const g = mosaicGrid();
		g[10] = ["", "", "", "", "", "", "", "", "", "", "", "分類總花費", "=SUM(M10)", "", "=SUM(O10)"];
		const client = tripClient(g);

		await addTripEntry(client, {
			tab: "京都",
			category: "電子產品",
			date: "x",
			shop: "x",
			item: "x",
			paymentMethod: "x",
			jpy: 1,
		});

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[1].updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: "=SUM(M10:M11)" } },
		]);
		expect(requests[2].updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: "=SUM(O10:O11)" } },
		]);
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

	it("writes into a 交通-style block by inserting above its untitled summary and extending its SUM", async () => {
		const g: unknown[][] = [];
		g[0] = ["日期", "店鋪", "品項", "支付方式", "日幣原價", "臺幣", "臺幣進位"];
		g[1] = ["交通"];
		g[2] = ["07/25", "", "新幹線", "已算在預算", 14500, "=E3*0.22", "=CEILING(F3)"];
		g[3] = ["07/25", "", "Haruka", "已算在預算", 2200, "=E4*0.22", "=CEILING(F4)"];
		g[4] = ["", "", "", "", "", "交通", "=SUM(G3:G4)"];
		const client = tripClient(g);

		const result = await addTripEntry(client, {
			tab: "京都",
			category: "交通",
			date: "07/26",
			shop: "",
			item: "Suica 儲值",
			paymentMethod: "現金",
			jpy: 3000,
		});

		expect((client.batchUpdate as any).mock.calls[0][0]).toEqual([
			{
				insertRange: {
					range: { sheetId: 111, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 7 },
					shiftDimension: "ROWS",
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 5, columnIndex: 6 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=SUM(G3:G5)" } }] }],
					fields: "userEnteredValue",
				},
			},
			payValidationCopy(3, 5, 3),
			...tripFormats(5, 0),
			tripClearFill(5, 0),
		]);
		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!A5:G5",
			[["07/26", "", "Suica 儲值", "現金", 3000, "=E5*0.22", "=CEILING(F5)"]],
		]);
		expect(result).toMatchObject({ category: "交通", row: 5 });
	});

	it("inserts into a 32-row 食-style block whose 食總花費 total sits beyond the fallback depth", async () => {
		const client = tripClient(fullFoodBlockGrid());

		const result = await addTripEntry(client, {
			tab: "京都",
			category: "餐(當下吃的)",
			date: "07/27 12:00",
			shop: "松屋",
			item: "牛丼",
			paymentMethod: "Suica",
			jpy: 680,
		});

		// Band-scoped Q-W cell insert above the 食總花費 row — never a whole
		// sheet row, which would cut across the other column bands.
		expect((client.batchUpdate as any).mock.calls[0][0]).toEqual([
			{
				insertRange: {
					range: { sheetId: 111, startRowIndex: 34, endRowIndex: 35, startColumnIndex: 16, endColumnIndex: 23 },
					shiftDimension: "ROWS",
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 35, columnIndex: 20 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=SUM(U3:U35)" } }] }],
					fields: "userEnteredValue",
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 35, columnIndex: 22 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=SUM(W3:W35)" } }] }],
					fields: "userEnteredValue",
				},
			},
			payValidationCopy(3, 35, 19),
			...tripFormats(35, 16),
			tripClearFill(35, 16),
		]);
		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!Q35:W35",
			[["07/27 12:00", "松屋", "牛丼", "Suica", 680, "=U35*0.22", "=CEILING(V35)"]],
		]);
		expect(result).toMatchObject({ category: "餐(當下吃的)", row: 35, currency: "JPY" });
	});

	it("falls back to default conversion formulas when the previous row has plain numbers", async () => {
		const client = tripClient(mosaicGrid());

		const result = await addTripEntry(client, {
			tab: "京都",
			category: "機票住宿",
			date: "07/27",
			shop: "",
			item: "追加住宿",
			paymentMethod: "信用卡",
			jpy: 12000,
		});

		expect((client.batchUpdate as any).mock.calls[0][0]).toEqual([payValidationCopy(3, 5, 11), ...tripFormats(5, 8)]);
		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!I5:O5",
			[["07/27", "", "追加住宿", "信用卡", 12000, "=M5*0.22", "=CEILING(N5)"]],
		]);
		expect(result).toMatchObject({ row: 5, currency: "JPY" });
	});
});

/**
 * The real 餐(當下吃的) shape (2026/07/25 京都東京): band Q-W (cols 16-22),
 * 32 full data rows — more than TRIP_MAX_BLOCK_ROWS — and the 食總花費 total
 * row at row 35, past the fallback depth. Row = index+1.
 */
function fullFoodBlockGrid(): unknown[][] {
	const g: unknown[][] = [];
	const at = (r: number, c: number, ...vals: unknown[]) => {
		g[r - 1] ??= [];
		vals.forEach((v, i) => ((g[r - 1] as unknown[])[c + i] = v));
	};
	at(1, 16, "日期", "店鋪", "品項", "支付方式", "日幣原價", "臺幣 即時匯率", "臺幣進位");
	at(2, 16, "餐(當下吃的)");
	for (let r = 3; r <= 34; r++) {
		at(r, 16, "07/25", "LAWSON", `品項${r}`, "現金", 100, `=U${r}*0.22`, `=CEILING(V${r})`);
	}
	at(35, 16, "", "", "", "食總花費", "=SUM(U3:U34)", "", "=SUM(W3:W34)");
	return g;
}

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

	it("finds a category-named …總花費 terminator beyond the fallback depth", () => {
		const [block] = findTripBlocks(fullFoodBlockGrid());
		expect(block).toEqual({ category: "餐(當下吃的)", headerRow: 1, startCol: 16, firstDataRow: 3, endRow: 35 });
	});

	it("bounds a block at a …總花費 label row even when its cells hold no =SUM", () => {
		const g: unknown[][] = [];
		g[0] = ["日期", "店鋪", "品項", "支付方式", "日幣原價", "臺幣", "臺幣進位"];
		g[1] = ["食"];
		g[2] = ["07/25", "", "牛丼", "現金", 680, 149.6, 150];
		g[3] = ["", "", "", "食總花費", 149.6, "", 150];
		const [block] = findTripBlocks(g);
		expect(block).toEqual({ category: "食", headerRow: 1, startCol: 0, firstDataRow: 3, endRow: 4 });
	});

	it("bounds a block at an untitled =SUM summary row (交通-style)", () => {
		const g: unknown[][] = [];
		g[0] = ["日期", "店鋪", "品項", "支付方式", "日幣原價", "臺幣", "臺幣進位"];
		g[1] = ["交通"];
		g[2] = ["07/25", "", "新幹線", "已算在預算", 14500, "=E3*0.22", "=CEILING(F3)"];
		g[3] = ["07/25", "", "Haruka", "已算在預算", 2200, "=E4*0.22", "=CEILING(F4)"];
		g[4] = ["", "", "", "", "", "交通", "=SUM(G3:G4)"];
		const [block] = findTripBlocks(g);
		expect(block).toEqual({ category: "交通", headerRow: 1, startCol: 0, firstDataRow: 3, endRow: 5 });
	});
});

/** The 目前實際開銷 summary as an UNFORMATTED_VALUE grid, offset like the live sheet (title at I5). Row = index+1. */
function tripBudgetGrid(): unknown[][] {
	const g: unknown[][] = [];
	const at = (r: number, c: number, ...vals: unknown[]) => {
		g[r - 1] ??= [];
		vals.forEach((v, i) => ((g[r - 1] as unknown[])[c + i] = v));
	};
	at(5, 8, "目前實際開銷");
	at(6, 8, "分類", "金額", "預算", "預算餘額", "餘額 JP");
	at(7, 8, "鐵道模型", 6861, 14000, 7139, 35970.27);
	at(8, 8, "衣服", 0, 10000, 10000, 50385.58);
	at(9, 8, "雜支", 5605, 5605, 0, 0);
	// The sheet's own =SUM total row (分類 blank) ends the list…
	at(10, 10, 29605);
	// …and the hand subtotal two rows below sits in the 分類 column as a NUMBER.
	at(12, 8, 24000);
	return g;
}

describe("tripBudgetStatus", () => {
	it("locates the section by its title with the 分類 header directly below", () => {
		expect(findTripBudgetSection(tripBudgetGrid(), "京都")).toEqual({ anchorRow: 5, headerRow: 6, startCol: 8 });
	});

	it("throws when the tab has no summary (or a title with no header under it)", () => {
		expect(() => findTripBudgetSection([], "京都")).toThrow("目前實際開銷");
		const stray: unknown[][] = [["目前實際開銷"], ["not a header"]];
		expect(() => findTripBudgetSection(stray, "京都")).toThrow("目前實際開銷");
	});

	it("reports each category's spent/budget/remaining and stops at the total row", async () => {
		const client = tripClient(tripBudgetGrid());

		const result = await tripBudgetStatus(client, { tab: "京都" });

		expect((client.readRange as any).mock.calls[0]).toEqual([`'京都'!${TRIP_BUDGET_READ}`, "UNFORMATTED_VALUE"]);
		expect(result.categories).toEqual([
			{ 分類: "鐵道模型", 金額: 6861, 預算: 14000, 預算餘額: 7139, "餘額 JP": 35970.27 },
			{ 分類: "衣服", 金額: 0, 預算: 10000, 預算餘額: 10000, "餘額 JP": 50385.58 },
			{ 分類: "雜支", 金額: 5605, 預算: 5605, 預算餘額: 0, "餘額 JP": 0 },
		]);
		// Neither the =SUM total row nor the numeric hand subtotal is a category.
		expect(result.totals).toEqual({ 金額: 12466, 預算: 29605, 預算餘額: 17139 });
	});

	it("returns null for cells that did not evaluate to a number", async () => {
		const g = tripBudgetGrid();
		(g[6] as unknown[])[12] = "#DIV/0!";
		const client = tripClient(g);

		const result = await tripBudgetStatus(client, { tab: "京都" });

		expect(result.categories[0]["餘額 JP"]).toBeNull();
		expect(result.totals.預算餘額).toBe(17139);
	});

	it("refuses a truncated read — row positions cannot be trusted", async () => {
		const client = {
			readRange: vi.fn(async () => ({ range: "x", values: tripBudgetGrid(), truncated: true })),
		} as unknown as SheetsClient;
		await expect(tripBudgetStatus(client, { tab: "京都" })).rejects.toThrow("truncated");
	});
});

describe("annotateRows", () => {
	it("derives the start row from the echoed range and numbers rows", () => {
		const result = annotateRows("'9 月'!A3:F60", [["a"], [], ["c", 5]]);
		expect(result).toEqual({
			startRow: 3,
			rows: [
				{ row: 3, values: ["a"] },
				{ row: 5, values: ["c", 5] },
			],
		});
	});

	it("defaults to row 1 for bare tab names and column-only ranges", () => {
		expect(annotateRows("Transactions", [["x"]]).startRow).toBe(1);
		expect(annotateRows("'9 月'!A:F", [["x"]]).startRow).toBe(1);
	});

	it("omits rows whose cells are all empty", () => {
		const result = annotateRows("'T'!B10:D12", [["", "", ""], ["v"]]);
		expect(result.rows).toEqual([{ row: 11, values: ["v"] }]);
	});
});

describe("colIndex", () => {
	it("inverts colLetter", () => {
		expect(colIndex("A")).toBe(0);
		expect(colIndex("I")).toBe(8);
		expect(colIndex("Z")).toBe(25);
		expect(colIndex("AA")).toBe(26);
		expect(colIndex("AF")).toBe(31);
	});
});

describe("expandAnchorRange", () => {
	it("expands a single-cell anchor to the rectangle the values will cover", () => {
		expect(expandAnchorRange("'9 月'!A22", [["item", 120, 3600]])).toBe("'9 月'!A22:C22");
		expect(expandAnchorRange("B5", [[1], [2], [3]])).toBe("B5:B7");
	});

	it("leaves rectangles, open-ended ranges, and 1x1 anchors alone", () => {
		expect(expandAnchorRange("'T'!A22:C23", [["x", "y"]])).toBe("'T'!A22:C23");
		expect(expandAnchorRange("'T'!A22:F", [["x"]])).toBe("'T'!A22:F");
		expect(expandAnchorRange("'T'!A22", [["x"]])).toBe("'T'!A22");
	});
});

describe("safeUpdateRange", () => {
	function updateClient(readResult: { range: string; values: unknown[][]; truncated?: boolean }): SheetsClient {
		return {
			readRange: vi.fn(async () => ({ truncated: false, ...readResult })),
			updateRange: vi.fn(async () => ({ updatedRange: readResult.range, updatedCells: 3 })),
		} as unknown as SheetsClient;
	}

	it("returns the previous values, row-annotated with formulas", async () => {
		const client = updateClient({ range: "'京都'!Q29:W29", values: [["Haruka", "", "=U29*0.22"]] });

		const result = await safeUpdateRange(client, "'京都'!Q29:W29", [["new", "", 1]]);

		expect((client.readRange as any).mock.calls[0]).toEqual(["'京都'!Q29:W29", "FORMULA"]);
		expect((client.updateRange as any).mock.calls[0]).toEqual(["'京都'!Q29:W29", [["new", "", 1]]]);
		expect(result).toEqual({
			updatedRange: "'京都'!Q29:W29",
			updatedCells: 3,
			previousValues: { startRow: 29, rows: [{ row: 29, values: ["Haruka", "", "=U29*0.22"] }] },
		});
	});

	it("expect_empty refuses when any target cell is occupied, naming the cells", async () => {
		const client = updateClient({ range: "'京都'!Q29:W29", values: [["Haruka", "", "=U29*0.22"]] });

		const promise = safeUpdateRange(client, "'京都'!Q29:W29", [["x"]], true);
		await expect(promise).rejects.toThrow("Q29=Haruka");
		await expect(promise).rejects.toThrow("S29==U29*0.22");
		expect((client.updateRange as any).mock.calls.length).toBe(0);
	});

	it("expect_empty writes when the target is genuinely empty", async () => {
		const client = updateClient({ range: "'京都'!Q30:W30", values: [] });

		const result = await safeUpdateRange(client, "'京都'!Q30:W30", [["x"]], true);

		expect((client.updateRange as any).mock.calls.length).toBe(1);
		expect(result.previousValues).toEqual({ startRow: 30, rows: [] });
	});

	it("refuses when the pre-write read was truncated", async () => {
		const client = updateClient({ range: "'T'!A1:Z999", values: [["x"]], truncated: true });

		await expect(safeUpdateRange(client, "'T'!A1:Z999", [["y"]])).rejects.toThrow("truncated");
		expect((client.updateRange as any).mock.calls.length).toBe(0);
	});

	it("expect_empty checks the FULL rectangle an anchor write will cover", async () => {
		// A22 is empty, but the write's 3 columns would clobber the 花費總額 cells in B/C
		const client = updateClient({ range: "'9 月'!A22:C22", values: [["", "花費總額", "=SUM(C3:C21)"]] });

		const promise = safeUpdateRange(client, "'9 月'!A22", [["item", 120, 3600]], true);
		await expect(promise).rejects.toThrow("B22=花費總額");
		expect((client.readRange as any).mock.calls[0][0]).toBe("'9 月'!A22:C22");
		expect((client.updateRange as any).mock.calls.length).toBe(0);
	});
});

describe("findCells", () => {
	function searchClient(tabGrids: Record<string, unknown[][]>): SheetsClient {
		return {
			listTabs: vi.fn(async () =>
				Object.keys(tabGrids).map((title) => ({ title, rowCount: 100, columnCount: 26 })),
			),
			readRange: vi.fn(async (range: string) => {
				const title = range.replace(/^'|'$/g, "").replace(/''/g, "'");
				return { range, values: tabGrids[title] ?? [], truncated: false };
			}),
		} as unknown as SheetsClient;
	}

	it("finds cells by case-insensitive substring with exact addresses", async () => {
		const client = searchClient({
			京都: [[], ["", "", "", "haruka 特急"], ["Haruka"]],
		});

		const result = await findCells(client, { query: "HARUKA", tab: "京都" });

		expect(result).toEqual({
			matches: [
				{ tab: "京都", cell: "D2", row: 2, column: "D", value: "haruka 特急" },
				{ tab: "京都", cell: "A3", row: 3, column: "A", value: "Haruka" },
			],
			truncated: false,
		});
		expect((client.readRange as any).mock.calls[0][0]).toBe("'京都'");
	});

	it("exact match trims and is case-sensitive", async () => {
		const client = searchClient({
			T: [["Haruka ", "haruka", "the Haruka train"]],
		});

		const result = await findCells(client, { query: "Haruka", tab: "T", match: "exact" });

		expect(result.matches).toEqual([{ tab: "T", cell: "A1", row: 1, column: "A", value: "Haruka " }]);
	});

	it("sweeps every tab when tab is omitted", async () => {
		const client = searchClient({
			"9 月": [["Netflix"]],
			京都: [["", "Netflix Store"]],
		});

		const result = await findCells(client, { query: "netflix" });

		expect(result.matches.map((m) => `${m.tab}!${m.cell}`)).toEqual(["9 月!A1", "京都!B1"]);
	});

	it("caps at FIND_CELLS_CAP and flags truncation", async () => {
		const grid = Array.from({ length: FIND_CELLS_CAP + 5 }, () => ["hit"]);
		const client = searchClient({ T: grid });

		const result = await findCells(client, { query: "hit", tab: "T" });

		expect(result.matches).toHaveLength(FIND_CELLS_CAP);
		expect(result.truncated).toBe(true);
	});

	it("flags truncation when a tab read was cut off", async () => {
		const client = {
			readRange: vi.fn(async (range: string) => ({ range, values: [["x"]], truncated: true })),
		} as unknown as SheetsClient;

		const result = await findCells(client, { query: "zzz", tab: "T" });

		expect(result.matches).toEqual([]);
		expect(result.truncated).toBe(true);
	});
});

describe("parseColumnBand", () => {
	it("parses a band and a single column into a 0-indexed half-open span", () => {
		expect(parseColumnBand("A:G")).toEqual({ startCol: 0, endCol: 7 });
		expect(parseColumnBand("P:S")).toEqual({ startCol: 15, endCol: 19 });
		expect(parseColumnBand("r")).toEqual({ startCol: 17, endCol: 18 });
		expect(parseColumnBand(" Z:AF ")).toEqual({ startCol: 25, endCol: 32 });
	});

	it("rejects anything that is not column letters, and backwards bands", () => {
		expect(() => parseColumnBand("A1:G9")).toThrow("Invalid columns");
		expect(() => parseColumnBand("A:")).toThrow("Invalid columns");
		expect(() => parseColumnBand("")).toThrow("Invalid columns");
		expect(() => parseColumnBand("G:A")).toThrow("left of its first");
	});
});

describe("findBrokenRefs", () => {
	/** An old month's expense list (A–G): the band the refs are checked against. */
	const EXPENSE_BAND = { startCol: 0, endCol: 7 };
	/** One formula in P35 (outside the A–G band) plus the 花費總額 SUM in E11. */
	function refGrid(formula: string): unknown[][] {
		const g: unknown[][] = [];
		g[34] = [];
		g[34][15] = formula;
		g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)"];
		return g;
	}

	it("flags a formula pointing straight at a deleted cell", () => {
		expect(findBrokenRefs(refGrid("=E5"), EXPENSE_BAND, 5, 5)).toEqual([
			{ cell: "P35", ref: "E5", formula: "=E5" },
		]);
		expect(findBrokenRefs(refGrid("=$E$5*2"), EXPENSE_BAND, 5, 5)).toMatchObject([{ cell: "P35", ref: "$E$5" }]);
	});

	it("leaves range references alone — they shrink with the delete", () => {
		expect(findBrokenRefs(refGrid("=SUM(E3:E10)"), EXPENSE_BAND, 5, 5)).toEqual([]);
		// the 花費總額 cell itself spans the row and must not be flagged
		expect(findBrokenRefs(refGrid("=D5+1"), EXPENSE_BAND, 11, 11)).toEqual([]);
	});

	it("ignores cross-tab references and quoted strings", () => {
		expect(findBrokenRefs(refGrid("='8 月'!E5"), EXPENSE_BAND, 5, 5)).toEqual([]);
		expect(findBrokenRefs(refGrid("=火車模型!E5"), EXPENSE_BAND, 5, 5)).toEqual([]);
		expect(findBrokenRefs(refGrid('=SUMIF(F3:F10,"E5",D3:D10)'), EXPENSE_BAND, 5, 5)).toEqual([]);
	});

	it("does not read digits inside a function name as a reference", () => {
		expect(findBrokenRefs(refGrid("=LOG10(P35)"), EXPENSE_BAND, 10, 10)).toEqual([]);
	});

	it("ignores references outside the deleted band or the deleted rows", () => {
		expect(findBrokenRefs(refGrid("=J5"), EXPENSE_BAND, 5, 5)).toEqual([]);
		expect(findBrokenRefs(refGrid("=E6"), EXPENSE_BAND, 5, 5)).toEqual([]);
		expect(findBrokenRefs(refGrid("=E5"), { startCol: 0, endCol: Number.MAX_SAFE_INTEGER }, 5, 5)).toHaveLength(1);
	});

	it("skips formulas that live inside the deleted cells themselves", () => {
		const g: unknown[][] = [];
		g[4] = ["", "", "", "", "=D5*2"]; // E5 points at D5, both being deleted
		expect(findBrokenRefs(g, EXPENSE_BAND, 5, 5)).toEqual([]);
	});
});

/** fakeClient + a deleteRows spy, for the raw delete path. */
function deleteClient(grid: unknown[][], truncated = false): SheetsClient {
	return {
		readRange: vi.fn(async (range: string) => ({
			range: range.includes("!") ? range : "'9 月'!A1:S60",
			values: grid,
			truncated,
		})),
		getSheetId: vi.fn(async () => 111),
		batchUpdate: vi.fn(async () => ({ replies: [{}] })),
		deleteRows: vi.fn(async (_tab: string, row: number, count: number) => ({ deletedAt: row, count })),
	} as unknown as SheetsClient;
}

describe("safeDeleteRows", () => {
	it("deletes whole rows and returns what was removed", async () => {
		const client = deleteClient(currentMonthGrid());

		const result = await safeDeleteRows(client, { tab: "9 月", row: 6, count: 1 });

		expect((client.deleteRows as any).mock.calls[0]).toEqual(["9 月", 6, 1, undefined]);
		expect(result).toMatchObject({ tab: "9 月", row: 6, count: 1, columns: null });
		expect(result.deletedValues.rows).toEqual([
			{ row: 6, values: [dateSerial(2026, 7, 1), "電話費", "生活用品", "", 1261, "TWD"] },
		]);
		expect(result.refWarning).toBeUndefined();
	});

	it("scopes the delete to a column band and slices the record to it", async () => {
		// two lunch rows under a =sum(R37:R38) 總和, so removing one leaves the range intact
		const g = lunchGrid();
		(g[36] ??= [])[15] = dateSerial(2026, 7, 2);
		g[36][16] = "中餐";
		g[36][17] = 120;
		(g[37] ??= [])[15] = dateSerial(2026, 7, 3);
		g[37][16] = "中餐";
		g[37][17] = 95;
		(g[38] ??= [])[16] = "總和";
		g[38][17] = "=sum(R37:R38)";

		const client = deleteClient(g);

		const result = await safeDeleteRows(client, { tab: "9 月", row: 37, count: 1, columns: "P:S" });

		expect((client.deleteRows as any).mock.calls[0]).toEqual(["9 月", 37, 1, { startCol: 15, endCol: 19 }]);
		expect(result.deletedValues.rows).toEqual([{ row: 37, values: [dateSerial(2026, 7, 2), "中餐", 120] }]);
	});

	it("refuses when a formula points straight at a deleted cell, and names it", async () => {
		// lunchGrid's 編列預算 (P35) is =E5 — the 中餐 budget pointing at an expense row
		const client = deleteClient(lunchGrid());

		await expect(safeDeleteRows(client, { tab: "9 月", row: 5, count: 1, columns: "A:G" })).rejects.toThrow(
			/#REF!.*P35 \(=E5\)/,
		);
		expect((client.deleteRows as any).mock.calls).toHaveLength(0);
	});

	it("force:true deletes anyway and reports the formulas it broke", async () => {
		const client = deleteClient(lunchGrid());

		const result = await safeDeleteRows(client, { tab: "9 月", row: 5, count: 1, columns: "A:G", force: true });

		expect((client.deleteRows as any).mock.calls).toHaveLength(1);
		expect(result.refWarning).toMatch(/force:true.*P35/);
	});

	it("falls back to a narrow read and warns when the tab is too big to scan", async () => {
		const client = deleteClient(currentMonthGrid(), true);
		(client.readRange as any).mockResolvedValueOnce({ range: "x", values: currentMonthGrid(), truncated: true });
		(client.readRange as any).mockResolvedValueOnce({
			range: "'9 月'!A6:G6",
			values: [[dateSerial(2026, 7, 1), "電話費"]],
			truncated: false,
		});

		const result = await safeDeleteRows(client, { tab: "9 月", row: 6, count: 1, columns: "A:G" });

		expect((client.readRange as any).mock.calls[1][0]).toBe("'9 月'!A6:G6");
		expect(result.refWarning).toMatch(/NOT checked/);
		expect(result.deletedValues.rows).toEqual([{ row: 6, values: [dateSerial(2026, 7, 1), "電話費"] }]);
	});

	it("refuses when even the narrow read comes back truncated", async () => {
		const client = deleteClient(currentMonthGrid(), true);

		await expect(safeDeleteRows(client, { tab: "9 月", row: 6, count: 1 })).rejects.toThrow("truncated");
		expect((client.deleteRows as any).mock.calls).toHaveLength(0);
	});
});
