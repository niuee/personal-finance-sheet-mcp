import { describe, expect, it, vi } from "vitest";
import {
	adaptRowFormula,
	addExpense,
	addLunch,
	addTransfer,
	addTripEntry,
	annotateRows,
	cellData,
	colIndex,
	colLetter,
	expandAnchorRange,
	findCells,
	FIND_CELLS_CAP,
	findExpenseWindow,
	findIncomeWindow,
	findLunchSection,
	findRowByLabels,
	findRowByValue,
	findTransferSection,
	findTripBlocks,
	getCategories,
	LUNCH_GRID_READ,
	migrateIncomeLayout,
	monthSummary,
	safeUpdateRange,
	setIncome,
	startMonth,
} from "../src/finance-ops";
import { currentMonthTab, MONTH_COLS, todaySerial } from "../src/conventions";
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

/** Grid mirroring the real monthly layout after the 類別 column (FORMULA render). Row = index+1. */
function monthGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["9 月花費"];
	g[1] = ["日期", "項目", "類別", "美金", "新臺幣"];
	g[2] = [46266, "上月透支", "透支", "", "=IF(-'8 月'!D32 > 0, -'8 月'!D32, 0)"];
	g[3] = ["", "Google Cloud", "訂閱", 11.53, '=D4*GOOGLEFINANCE("CURRENCY:USDTWD")'];
	g[4] = ["", "ElevenLabs", "訂閱", 6, '=D5*GOOGLEFINANCE("CURRENCY:USDTWD")'];
	g[5] = ["", "iCloud", "訂閱", 9.99, '=D6*GOOGLEFINANCE("CURRENCY:USDTWD")'];
	g[6] = ["", "電話費", "生活用品", "", 1261];
	g[7] = ["", "近鐵 80000系", "購物", "", "='火車模型'!D4"];
	// rows 9-10 (indices 8-9) empty inside the window
	g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)"];
	g[12] = ["", "沛還", "", 20500];
	g[13] = ["", "薪水", "", 63913];
	g[14] = ["", "剩餘", "", "=sum(D13:D14)-E11"];
	g[15] = ["", "美金支付", "", 640.42];
	// 銀行餘額 running-balance block (labels col B, values col D).
	g[17] = ["", "銀行餘額", "", ""];
	g[18] = ["", "美金收入", "", 0];
	g[19] = ["", "美金支出", "", "=SUM(D4:D10)"];
	g[20] = ["", "上月美金餘額", "", "='8 月'!D22"];
	g[21] = ["", "美金餘額", "", "=D21+D19-D20"];
	g[22] = ["", "新臺幣收入", "", 0];
	g[23] = ["", "新臺幣支出", "", '=SUMIF(D4:D10,"",E4:E10)'];
	g[24] = ["", "上月新臺幣餘額", "", "='8 月'!D26"];
	g[25] = ["", "新臺幣餘額", "", "=D25+D23-D24"];
	return g;
}

/** Old-layout grid mirroring real 7 月 2026 before migration: 總預算 header, plain 收入 cells, 剩餘 + 美金支付/新臺幣支付. Row = index+1. */
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

/** Post-migration grid: 支付幣別 in F, income 幣別 in C, 月 rows, SUMIF 收入/支出, 總…餘額 names. Row = index+1. */
function migratedMonthGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["9 月花費"];
	g[1] = ["日期", "項目", "類別", "美金", "新臺幣", "支付幣別"];
	g[2] = [46266, "上月透支", "透支", "", "=IF(-'8 月'!D32 > 0, -'8 月'!D32, 0)", "TWD"];
	g[3] = ["", "Google Cloud", "訂閱", 11.53, '=D4*GOOGLEFINANCE("CURRENCY:USDTWD")', "USD"];
	g[4] = ["", "電話費", "生活用品", "", 1261, "TWD"];
	// rows 6-10 empty inside the window
	g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)"];
	g[12] = ["", "總預算"];
	g[13] = ["", "沛還", "TWD", 20500];
	g[14] = ["", "薪水", "TWD", 63913];
	g[15] = ["", "多一個月薪水", "TWD", 63913];
	g[16] = ["", "月美金餘額", "", "=D24-D25"];
	g[17] = ["", "美金透支沖銷", "", "=IF(AND(D17<0,D27>=0),-D17,0)"];
	g[18] = ["", "月新臺幣餘額", "", "=D28-D29"];
	g[19] = ["", "新臺幣透支沖銷", "", "=IF(AND(D19<0,D31>=0),-D19,0)"];
	g[20] = ["", "月剩餘", "", '=(D17+D18)*GOOGLEFINANCE("CURRENCY:USDTWD")+D19+D20'];
	g[22] = ["", "銀行餘額"];
	g[23] = ["", "美金收入", "", '=SUMIF(C14:C16,"USD",D14:D16)'];
	g[24] = ["", "美金支出", "", '=SUMIF(F3:F10,"USD",D3:D10)'];
	g[25] = ["", "上月美金餘額", "", "='8 月'!D27"];
	g[26] = ["", "總美金餘額", "", "=D26+D24-D25"];
	g[27] = ["", "新臺幣收入", "", '=SUMIF(C14:C16,"TWD",D14:D16)'];
	g[28] = ["", "新臺幣支出", "", '=SUMIF(F3:F10,"TWD",E3:E10)'];
	g[29] = ["", "上月新臺幣餘額", "", "='8 月'!D31"];
	g[30] = ["", "總新臺幣餘額", "", "=D30+D28-D29"];
	return g;
}

/** migratedMonthGrid + a 乾坤大挪移 transfer block at G33:M36 (data slot row 35 empty). */
function transferGrid(): unknown[][] {
	const g = migratedMonthGrid();
	g[32] = ["", "", "", "", "", "", "乾坤大挪移"];
	g[33] = ["", "", "", "", "", "", "日期", "新臺幣", "當下美金", "實際美金", "匯差", "手續費", "當筆總額外花費"];
	// row 35 empty — the first data slot
	g[35] = ["", "", "", "", "", "", "總和", "=sum(H35)", "=sum(I35)", "=sum(J35)", "=sum(K35)", "=sum(L35)", "=sum(M35)"];
	return g;
}

/** transferGrid + a 中餐預算 lunch block at O33:Q38 (data slot row 37 empty). */
function lunchGrid(): unknown[][] {
	const g = transferGrid();
	const put = (idx: number, col: number, v: unknown) => {
		(g[idx] ??= [])[col] = v;
	};
	put(32, 14, "中餐預算");
	put(33, 14, "編列預算");
	put(33, 16, "剩餘 (負數會加回去支出）");
	put(34, 14, "=E5"); // 編列預算 ← the 中餐 expense cell
	put(34, 16, "=O35-Q38"); // 剩餘 = 編列預算 − 總和
	put(35, 14, "日期");
	put(35, 15, "項目");
	put(35, 16, "金額");
	// row 37 (index 36) empty — the first data slot
	put(37, 15, "總和");
	put(37, 16, "=sum(Q37)");
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

	it("findExpenseWindow reads the window from the 花費總額 SUM formula", () => {
		expect(findExpenseWindow(monthGrid(), "9 月")).toEqual({ totalRow: 11, start: 3, end: 10 });
	});

	it("findExpenseWindow fails closed on a missing anchor or a non-SUM total", () => {
		expect(() => findExpenseWindow([["nothing"]], "9 月")).toThrow("花費總額");
		const g = monthGrid();
		g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)+E2"];
		expect(() => findExpenseWindow(g, "9 月")).toThrow("expense window");
	});

	it("findIncomeWindow detects migrated and old layouts, null without anchors", () => {
		expect(findIncomeWindow(migratedMonthGrid())).toEqual({ start: 14, end: 16, migrated: true });
		expect(findIncomeWindow(oldLayoutGrid())).toEqual({ start: 14, end: 15, migrated: false });
		expect(findIncomeWindow(monthGrid())).toBeNull(); // no 總預算 header
		expect(findIncomeWindow([["x"]])).toBeNull();
	});
});

describe("migrateIncomeLayout", () => {
	it("migrates an old-layout tab in one batch: structure ops first, then label-anchored writes", async () => {
		const client = fakeClient(oldLayoutGrid());

		const result = await migrateIncomeLayout(client, "9 月", oldLayoutGrid(), 111);

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// 1) insert three rows after 剩餘 (row 16) for the extra 月 rows
		expect(requests[0]).toEqual({
			insertDimension: {
				range: { sheetId: 111, dimension: "ROWS", startIndex: 16, endIndex: 20 },
				inheritFromBefore: true,
			},
		});
		// 2) delete 新臺幣支付 (19→22) then 美金支付 (18→21), bottom-up at post-insert positions
		expect(requests[1]).toEqual({
			deleteDimension: { range: { sheetId: 111, dimension: "ROWS", startIndex: 22, endIndex: 23 } },
		});
		expect(requests[2]).toEqual({
			deleteDimension: { range: { sheetId: 111, dimension: "ROWS", startIndex: 21, endIndex: 22 } },
		});
		// 3) F2 支付幣別 header
		expect(requests[3]).toEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 1, columnIndex: 5 },
				rows: [{ values: [{ userEnteredValue: { stringValue: "支付幣別" } }] }],
				fields: "userEnteredValue",
			},
		});
		// 4) back-tag expense rows 3-10: D non-blank → USD, else TWD; empty rows untouched
		expect(requests[4]).toEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 2, columnIndex: 5 },
				rows: [
					{ values: [{ userEnteredValue: { stringValue: "TWD" } }] },
					{ values: [{ userEnteredValue: { stringValue: "USD" } }] },
					{ values: [{ userEnteredValue: { stringValue: "TWD" } }] },
					{ values: [{}] },
					{ values: [{}] },
					{ values: [{}] },
					{ values: [{}] },
					{ values: [{}] },
				],
				fields: "userEnteredValue",
			},
		});
		// 5) income rows 14-15 tagged TWD in C
		expect(requests[5]).toEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 13, columnIndex: 2 },
				rows: [
					{ values: [{ userEnteredValue: { stringValue: "TWD" } }] },
					{ values: [{ userEnteredValue: { stringValue: "TWD" } }] },
				],
				fields: "userEnteredValue",
			},
		});
		// 6) 剩餘 row becomes 月美金餘額 and the three inserted rows get 月新臺幣餘額 / 透支沖銷 / 月剩餘
		expect(requests[6]).toEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 15, columnIndex: 1 },
				rows: [
					{ values: [{ userEnteredValue: { stringValue: "月美金餘額" } }, {}, { userEnteredValue: { formulaValue: "=D24-D25" } }] },
					{ values: [{ userEnteredValue: { stringValue: "美金透支沖銷" } }, {}, { userEnteredValue: { formulaValue: "=IF(AND(D16<0,D27>=0),-D16,0)" } }] },
					{ values: [{ userEnteredValue: { stringValue: "月新臺幣餘額" } }, {}, { userEnteredValue: { formulaValue: "=D28-D29" } }] },
					{ values: [{ userEnteredValue: { stringValue: "新臺幣透支沖銷" } }, {}, { userEnteredValue: { formulaValue: "=IF(AND(D18<0,D31>=0),-D18,0)" } }] },
					{ values: [{ userEnteredValue: { stringValue: "月剩餘" } }, {}, { userEnteredValue: { formulaValue: '=(D16+D17)*GOOGLEFINANCE("CURRENCY:USDTWD")+D18+D19' } }] },
				],
				fields: "userEnteredValue",
			},
		});
		// 7) 收入 cells become income-window SUMIFs; 支出 cells become 支付幣別 SUMIFs
		expect(requests[7].updateCells).toMatchObject({
			start: { sheetId: 111, rowIndex: 23, columnIndex: 3 },
			rows: [{ values: [{ userEnteredValue: { formulaValue: '=SUMIF(C14:C15,"USD",D14:D15)' } }] }],
		});
		expect(requests[8].updateCells).toMatchObject({
			start: { sheetId: 111, rowIndex: 24, columnIndex: 3 },
			rows: [{ values: [{ userEnteredValue: { formulaValue: '=SUMIF(F3:F10,"USD",D3:D10)' } }] }],
		});
		expect(requests[9].updateCells).toMatchObject({
			start: { sheetId: 111, rowIndex: 27, columnIndex: 3 },
			rows: [{ values: [{ userEnteredValue: { formulaValue: '=SUMIF(C14:C15,"TWD",D14:D15)' } }] }],
		});
		expect(requests[10].updateCells).toMatchObject({
			start: { sheetId: 111, rowIndex: 28, columnIndex: 3 },
			rows: [{ values: [{ userEnteredValue: { formulaValue: '=SUMIF(F3:F10,"TWD",E3:E10)' } }] }],
		});
		// 8) running balances renamed
		expect(requests[11].updateCells).toMatchObject({
			start: { sheetId: 111, rowIndex: 26, columnIndex: 1 },
			rows: [{ values: [{ userEnteredValue: { stringValue: "總美金餘額" } }] }],
		});
		expect(requests[12].updateCells).toMatchObject({
			start: { sheetId: 111, rowIndex: 30, columnIndex: 1 },
			rows: [{ values: [{ userEnteredValue: { stringValue: "總新臺幣餘額" } }] }],
		});
		expect(requests).toHaveLength(13);
		expect((client.batchUpdate as any).mock.calls).toHaveLength(1);

		// the report names what changed and what was deleted, with previous contents
		expect(result.deletedRows).toEqual([
			{ row: 19, item: "新臺幣支付", values: ["", "新臺幣支付", "", "=E5"] },
			{ row: 18, item: "美金支付", values: ["", "美金支付", "", "=SUM(D4:D6)"] },
		]);
		expect(result.changes).toContainEqual({ cell: "D24", before: "0", after: '=SUMIF(C14:C15,"USD",D14:D15)' });
		expect(result.changes).toContainEqual({ cell: "B27", before: "美金餘額", after: "總美金餘額" });
		expect(result.changes).toContainEqual({ cell: "D16", before: "=sum(D14:D15)-E11", after: "=D24-D25" });
	});

	it("preserves an existing 支付幣別 cell instead of re-deriving it", async () => {
		const g = oldLayoutGrid();
		g[3] = ["", "Google Cloud", "訂閱", 11.53, '=D4*GOOGLEFINANCE("CURRENCY:USDTWD")', "TWD"];
		const client = fakeClient(g);

		const result = await migrateIncomeLayout(client, "9 月", g, 111);

		const backTag = (client.batchUpdate as any).mock.calls[0][0][4];
		// row 4 already says TWD (explicit paid_with) — written back verbatim, not overwritten
		// with USD (updateCells would clear an omitted masked field, so it cannot be skipped)
		expect(backTag.updateCells.rows[1]).toEqual({ values: [{ userEnteredValue: { stringValue: "TWD" } }] });
		// and the write-back is not reported as a change — nothing changed
		expect(result.changes.filter((c) => c.cell === "F4")).toEqual([]);
	});

	it("refuses when the 銀行餘額 block is missing", async () => {
		const g = oldLayoutGrid();
		g.length = 20; // cut the bank block off
		const client = fakeClient(g);

		await expect(migrateIncomeLayout(client, "9 月", g, 111)).rejects.toThrow("銀行餘額");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("handles a tab that has only 美金支付 (no 新臺幣支付 row)", async () => {
		const g = oldLayoutGrid();
		g[18] = undefined as unknown as unknown[]; // drop 新臺幣支付
		const client = fakeClient(g);

		const result = await migrateIncomeLayout(client, "9 月", g, 111);

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// one delete (美金支付 at 18+3=21); bank rows land one lower than the 2-pay case
		expect(requests[1]).toEqual({
			deleteDimension: { range: { sheetId: 111, dimension: "ROWS", startIndex: 21, endIndex: 22 } },
		});
		// 美金收入 was row 22, final = 22 + 4 - 1 = 25
		expect(result.changes).toContainEqual({ cell: "D25", before: "0", after: '=SUMIF(C14:C15,"USD",D14:D15)' });
	});

	it("writes the same per-currency write-offs even when the tab has no 上月透支 row", async () => {
		const g = oldLayoutGrid();
		g[2] = ["", "普通支出", "其他", "", 500]; // no carry row
		const client = fakeClient(g);

		await migrateIncomeLayout(client, "9 月", g, 111);

		const monthRows = (client.batchUpdate as any).mock.calls[0][0][6];
		expect(monthRows.updateCells.rows[1]).toEqual({
			values: [{ userEnteredValue: { stringValue: "美金透支沖銷" } }, {}, { userEnteredValue: { formulaValue: "=IF(AND(D16<0,D27>=0),-D16,0)" } }],
		});
		expect(monthRows.updateCells.rows[3]).toEqual({
			values: [{ userEnteredValue: { stringValue: "新臺幣透支沖銷" } }, {}, { userEnteredValue: { formulaValue: "=IF(AND(D18<0,D31>=0),-D18,0)" } }],
		});
	});
});

describe("findTransferSection", () => {
	it("locates the header and 總和 rows from the anchor", () => {
		expect(findTransferSection(transferGrid(), "9 月")).toEqual({ headerRow: 34, totalRow: 36 });
	});

	it("throws when the tab has no 乾坤大挪移 section", () => {
		expect(() => findTransferSection(migratedMonthGrid(), "6 月")).toThrow("乾坤大挪移");
	});

	it("throws when the header row under the anchor is missing", () => {
		const g = transferGrid();
		g[33] = [];
		expect(() => findTransferSection(g, "9 月")).toThrow("日期");
	});

	it("throws when there is no 總和 row", () => {
		const g = transferGrid();
		g[35] = [];
		expect(() => findTransferSection(g, "9 月")).toThrow("總和");
	});
});

describe("findLunchSection", () => {
	it("locates the budget, header and 總和 rows from the anchor", () => {
		expect(findLunchSection(lunchGrid(), "9 月")).toEqual({ budgetRow: 35, headerRow: 36, totalRow: 38 });
	});

	it("throws when the tab has no 中餐預算 section", () => {
		expect(() => findLunchSection(transferGrid(), "6 月")).toThrow("中餐預算");
	});

	it("throws when the header row under the anchor is missing", () => {
		const g = lunchGrid();
		(g[35] as unknown[])[14] = "";
		expect(() => findLunchSection(g, "9 月")).toThrow("日期");
	});

	it("throws when there is no 總和 row", () => {
		const g = lunchGrid();
		(g[37] as unknown[])[15] = "";
		expect(() => findLunchSection(g, "9 月")).toThrow("總和");
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

describe("addTransfer", () => {
	it("writes into the first empty row with the rate pinned", async () => {
		const client = transferClient(transferGrid());
		const result = await addTransfer(client, { ntd: 30000, usd: 1000, fee: 30, month: 9, date: "9/2" });

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:M60", "FORMULA"]);
		// batch 1: scratch GOOGLEFINANCE into I35, no insert needed
		const batch1 = (client.batchUpdate as any).mock.calls[0][0];
		expect(batch1).toHaveLength(1);
		expect(batch1[0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 34, columnIndex: 8 });
		expect(batch1[0].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			formulaValue: '=GOOGLEFINANCE("CURRENCY:USDTWD")',
		});
		expect((client.readRange as any).mock.calls[1]).toEqual(["'9 月'!I35", "UNFORMATTED_VALUE"]);

		// batch 2: 日期, the entry row, the 總和 rewrite
		const batch2 = (client.batchUpdate as any).mock.calls[1][0];
		const dateCell = batch2[0].updateCells;
		expect(dateCell.start).toEqual({ sheetId: 111, rowIndex: 34, columnIndex: 6 });
		expect(dateCell.rows[0].values[0].userEnteredFormat).toEqual({
			numberFormat: { type: "DATE", pattern: "mm/dd" },
		});
		const rowCells = batch2[1].updateCells;
		expect(rowCells.start).toEqual({ sheetId: 111, rowIndex: 34, columnIndex: 7 });
		expect(rowCells.rows[0].values.map((v: any) => v.userEnteredValue)).toEqual([
			{ numberValue: 30000 }, // H 新臺幣
			{ formulaValue: "=H35/29.85" }, // I 當下美金 (pinned)
			{ numberValue: 1000 }, // J 實際美金
			{ formulaValue: "=(I35-J35)*29.85" }, // K 匯差 (pinned)
			{ numberValue: 30 }, // L 手續費
			{ formulaValue: "=K35+L35" }, // M 當筆總額外花費
		]);
		const sums = batch2[2].updateCells;
		expect(sums.start).toEqual({ sheetId: 111, rowIndex: 35, columnIndex: 7 });
		expect(sums.rows[0].values.map((v: any) => v.userEnteredValue.formulaValue)).toEqual([
			"=SUM(H35:H35)",
			"=SUM(I35:I35)",
			"=SUM(J35:J35)",
			"=SUM(K35:K35)",
			"=SUM(L35:L35)",
			"=SUM(M35:M35)",
		]);

		// 30000 − 1000×29.85 = 150 spread; +30 fee = 180
		expect(result).toMatchObject({
			tab: "9 月",
			row: 35,
			inserted: false,
			date: "2026-09-02",
			ntd: 30000,
			usd: 1000,
			rate: 29.85,
			spread: 150,
			fee: 30,
			extraCost: 180,
		});
		expect(result.spotUsd).toBeCloseTo(1005.03, 2);
	});

	it("inserts a row above 總和 when the section is full and widens the sums", async () => {
		const grid = transferGrid();
		grid[34] = ["", "", "", "", "", "", 46266, 30000, "=H35/29.9", 1000, "=(I35-J35)*29.9", 30, "=K35+L35"];
		const client = transferClient(grid);
		const result = await addTransfer(client, { ntd: 15000, usd: 500, fee: 15, month: 9, date: "9/9" });

		const batch1 = (client.batchUpdate as any).mock.calls[0][0];
		expect(batch1[0].insertDimension.range).toEqual({
			sheetId: 111,
			dimension: "ROWS",
			startIndex: 35,
			endIndex: 36,
		});
		expect(batch1[1].updateCells.start).toEqual({ sheetId: 111, rowIndex: 35, columnIndex: 8 });
		expect((client.readRange as any).mock.calls[1]).toEqual(["'9 月'!I36", "UNFORMATTED_VALUE"]);

		const batch2 = (client.batchUpdate as any).mock.calls[1][0];
		expect(batch2[2].updateCells.start).toEqual({ sheetId: 111, rowIndex: 36, columnIndex: 7 });
		expect(batch2[2].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			formulaValue: "=SUM(H35:H36)",
		});
		expect(result).toMatchObject({ row: 36, inserted: true });
	});

	it("defaults 日期 to today in Taipei", async () => {
		const client = transferClient(transferGrid());
		await addTransfer(client, { ntd: 100, usd: 3, fee: 0, month: 9 });
		const dateCell = (client.batchUpdate as any).mock.calls[1][0][0].updateCells.rows[0].values[0];
		expect(dateCell.userEnteredValue.numberValue).toBe(todaySerial());
	});

	it("fails and clears the scratch cell when GOOGLEFINANCE is not numeric", async () => {
		const client = transferClient(transferGrid(), "#N/A");
		await expect(addTransfer(client, { ntd: 100, usd: 3, fee: 0, month: 9 })).rejects.toThrow("GOOGLEFINANCE");
		const calls = (client.batchUpdate as any).mock.calls;
		expect(calls).toHaveLength(2); // scratch write, then the clearing write
		expect(calls[1][0][0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 34, columnIndex: 8 });
		expect(calls[1][0][0].updateCells.rows[0].values).toEqual([{}]);
	});

	it("refuses when the tab has no 乾坤大挪移 section", async () => {
		const client = transferClient(migratedMonthGrid());
		await expect(addTransfer(client, { ntd: 100, usd: 3, fee: 0, month: 6 })).rejects.toThrow("乾坤大挪移");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("rejects a bad date before any read or write", async () => {
		const client = transferClient(transferGrid());
		await expect(
			addTransfer(client, { ntd: 100, usd: 3, fee: 0, month: 9, date: "not-a-date" }),
		).rejects.toThrow("Unrecognized date");
		expect((client.readRange as any).mock.calls).toHaveLength(0);
	});

	it("refuses when the grid read is truncated", async () => {
		const client = transferClient(transferGrid());
		(client.readRange as any).mockResolvedValue({ range: "x", values: transferGrid(), truncated: true });
		await expect(addTransfer(client, { ntd: 100, usd: 3, fee: 0, month: 9 })).rejects.toThrow("truncated");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});
});

/** Like fakeClient, but the post-write 編列預算/剩餘 read-back returns `budgetRow`. */
function lunchClient(grid: unknown[][], budgetRow: unknown[] = [3900, "", 3547]): SheetsClient {
	return {
		readRange: vi.fn(async (range: string) =>
			range.includes("A1:Q60")
				? { range, values: grid, truncated: false }
				: { range, values: [budgetRow], truncated: false },
		),
		getSheetId: vi.fn(async () => 111),
		batchUpdate: vi.fn(async () => ({ replies: [{}] })),
	} as unknown as SheetsClient;
}

describe("addLunch", () => {
	it("writes into the first empty row and rewrites 總和 over the data window", async () => {
		const client = lunchClient(lunchGrid());
		const result = await addLunch(client, { amount: 143, month: 9, date: "9/2" });

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:Q60", "FORMULA"]);
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toHaveLength(3); // date cell, item+amount, 總和 rewrite — no insert needed
		const dateCell = requests[0].updateCells;
		expect(dateCell.start).toEqual({ sheetId: 111, rowIndex: 36, columnIndex: 14 });
		expect(dateCell.rows[0].values[0].userEnteredFormat).toEqual({
			numberFormat: { type: "DATE", pattern: "mm/dd" },
		});
		const rowCells = requests[1].updateCells;
		expect(rowCells.start).toEqual({ sheetId: 111, rowIndex: 36, columnIndex: 15 });
		expect(rowCells.rows[0].values.map((v: any) => v.userEnteredValue)).toEqual([
			{ stringValue: "中餐" }, // P 項目 defaults
			{ numberValue: 143 }, // Q 金額
		]);
		const sum = requests[2].updateCells;
		expect(sum.start).toEqual({ sheetId: 111, rowIndex: 37, columnIndex: 16 });
		expect(sum.rows[0].values[0].userEnteredValue).toEqual({ formulaValue: "=SUM(Q37:Q37)" });

		// the 編列預算/剩餘 row is read back AFTER the write so the echo includes this entry
		expect((client.readRange as any).mock.calls[1]).toEqual(["'9 月'!O35:Q35", "UNFORMATTED_VALUE"]);
		expect(result).toEqual({
			tab: "9 月",
			row: 37,
			inserted: false,
			date: "2026-09-02",
			item: "中餐",
			amount: 143,
			budget: 3900,
			spent: 353, // 編列預算 − 剩餘
			leftover: 3547,
		});
	});

	it("inserts a row above 總和 when the section is full and widens the sum", async () => {
		const g = lunchGrid();
		(g[36] ??= [])[14] = 46266;
		(g[36] as unknown[])[15] = "中餐";
		(g[36] as unknown[])[16] = 143;
		const client = lunchClient(g);
		const result = await addLunch(client, { amount: 210, month: 9, date: "9/9" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].insertDimension).toEqual({
			range: { sheetId: 111, dimension: "ROWS", startIndex: 37, endIndex: 38 },
			inheritFromBefore: true,
		});
		expect(requests[1].updateCells.start).toEqual({ sheetId: 111, rowIndex: 37, columnIndex: 14 });
		expect(requests[3].updateCells.start).toEqual({ sheetId: 111, rowIndex: 38, columnIndex: 16 });
		expect(requests[3].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			formulaValue: "=SUM(Q37:Q38)",
		});
		expect(result).toMatchObject({ row: 38, inserted: true });
	});

	it("accepts a custom 項目 and defaults 日期 to today in Taipei", async () => {
		const client = lunchClient(lunchGrid());
		await addLunch(client, { amount: 95, item: "午餐咖啡", month: 9 });
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			numberValue: todaySerial(),
		});
		expect(requests[1].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			stringValue: "午餐咖啡",
		});
	});

	it("refuses when the tab has no 中餐預算 section", async () => {
		const client = lunchClient(transferGrid());
		await expect(addLunch(client, { amount: 100, month: 6 })).rejects.toThrow("中餐預算");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("rejects a bad date before any read or write", async () => {
		const client = lunchClient(lunchGrid());
		await expect(addLunch(client, { amount: 100, month: 9, date: "not-a-date" })).rejects.toThrow(
			"Unrecognized date",
		);
		expect((client.readRange as any).mock.calls).toHaveLength(0);
	});

	it("refuses when the grid read is truncated", async () => {
		const client = lunchClient(lunchGrid());
		(client.readRange as any).mockResolvedValue({ range: "x", values: lunchGrid(), truncated: true });
		await expect(addLunch(client, { amount: 100, month: 9 })).rejects.toThrow("truncated");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});
});

describe("addExpense", () => {
	it("writes a TWD expense into the first empty window row", async () => {
		const client = fakeClient(monthGrid());

		const result = await addExpense(client, { item: "晚餐", amount: 250, currency: "TWD", month: 9 });

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:H60", "FORMULA"]);
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toEqual([
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 8, columnIndex: 1 },
					rows: [{ values: [
						{ userEnteredValue: { stringValue: "晚餐" } },
						{},
						{},
						{ userEnteredValue: { numberValue: 250 } },
						{ userEnteredValue: { stringValue: "TWD" } },
					] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(result).toMatchObject({ tab: "9 月", row: 9, inserted: false, tag: null, paidWith: "TWD" });
	});

	it("writes the 類別 tag into the row when given", async () => {
		const client = fakeClient(monthGrid());

		const result = await addExpense(client, { item: "晚餐", amount: 250, currency: "TWD", month: 9, tag: "吃喝" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { stringValue: "晚餐" } },
			{ userEnteredValue: { stringValue: "吃喝" } },
			{},
			{ userEnteredValue: { numberValue: 250 } },
			{ userEnteredValue: { stringValue: "TWD" } },
		]);
		expect(result).toMatchObject({ row: 9, tag: "吃喝" });
	});

	it("writes a USD expense with the GOOGLEFINANCE conversion formula", async () => {
		const client = fakeClient(monthGrid());

		await addExpense(client, { item: "API credits", amount: 30, currency: "USD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toEqual([
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 8, columnIndex: 1 },
					rows: [
						{
							values: [
								{ userEnteredValue: { stringValue: "API credits" } },
								{},
								{ userEnteredValue: { numberValue: 30 } },
								{ userEnteredValue: { formulaValue: '=D9*GOOGLEFINANCE("CURRENCY:USDTWD")' } },
								{ userEnteredValue: { stringValue: "USD" } },
							],
						},
					],
					fields: "userEnteredValue",
				},
			},
		]);
	});

	it("inserts a row inside the SUM window when no empty row exists", async () => {
		const grid = monthGrid();
		grid[8] = ["", "already", "雜", "", 1];
		grid[9] = ["", "full", "雜", "", 2];

		const client = fakeClient(grid);
		const result = await addExpense(client, { item: "加購", amount: 100, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// window is full, so insert at its last row (10) — the =SUM(E3:E10) auto-extends
		expect(requests).toEqual([
			{
				insertDimension: {
					range: { sheetId: 111, dimension: "ROWS", startIndex: 9, endIndex: 10 },
					inheritFromBefore: true,
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 9, columnIndex: 1 },
					rows: [
						{
							values: [
								{ userEnteredValue: { stringValue: "加購" } },
								{},
								{},
								{ userEnteredValue: { numberValue: 100 } },
								{ userEnteredValue: { stringValue: "TWD" } },
							],
						},
					],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(result).toMatchObject({ row: 10, inserted: true });
	});

	it("writes an explicit paid_with that differs from the pricing currency", async () => {
		const client = fakeClient(monthGrid());

		const result = await addExpense(client, { item: "AWS", amount: 20, currency: "USD", month: 9, paidWith: "TWD" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { stringValue: "AWS" } },
			{},
			{ userEnteredValue: { numberValue: 20 } },
			{ userEnteredValue: { formulaValue: '=D9*GOOGLEFINANCE("CURRENCY:USDTWD")' } },
			{ userEnteredValue: { stringValue: "TWD" } },
		]);
		expect(result).toMatchObject({ paidWith: "TWD", currency: "USD" });
	});

	it("writes the date as a real date serial with mm/dd format when given", async () => {
		const client = fakeClient(monthGrid());

		const result = await addExpense(client, { item: "晚餐", amount: 250, currency: "TWD", month: 9, date: "2026/09/02" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toHaveLength(2);
		expect(requests[1]).toEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 8, columnIndex: 0 },
				rows: [
					{
						values: [
							{
								userEnteredValue: { numberValue: 46267 },
								userEnteredFormat: { numberFormat: { type: "DATE", pattern: "mm/dd" } },
							},
						],
					},
				],
				fields: "userEnteredValue,userEnteredFormat.numberFormat",
			},
		});
		expect(result).toMatchObject({ row: 9, date: "2026/09/02" });
	});

	it("leaves the date cell untouched when date is omitted", async () => {
		const client = fakeClient(monthGrid());

		const result = await addExpense(client, { item: "晚餐", amount: 250, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toHaveLength(1);
		expect(requests.every((r: any) => r.updateCells.start.columnIndex !== 0)).toBe(true);
		expect(result).toMatchObject({ date: null });
	});

	it("rejects an invalid date before reading or writing anything", async () => {
		const client = fakeClient(monthGrid());
		await expect(
			addExpense(client, { item: "x", amount: 1, currency: "TWD", month: 9, date: "not-a-date" }),
		).rejects.toThrow("Unrecognized date");
		expect((client.readRange as any).mock.calls.length).toBe(0);
		expect((client.batchUpdate as any).mock.calls.length).toBe(0);
	});

	it("rejects a missing 花費總額 anchor without writing", async () => {
		const noTotal = fakeClient([["nothing here"]]);
		await expect(addExpense(noTotal, { item: "x", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("花費總額");
		expect((noTotal.batchUpdate as any).mock.calls.length).toBe(0);
	});

	it("refuses to operate when the grid read was truncated", async () => {
		const client = fakeClient(monthGrid());
		(client.readRange as any).mockResolvedValue({ range: "x", values: monthGrid(), truncated: true });
		await expect(addExpense(client, { item: "x", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow(
			"truncated",
		);
		expect((client.batchUpdate as any).mock.calls.length).toBe(0);
	});

	it("fails closed when the 花費總額 cell is not a plain SUM range", async () => {
		const g = monthGrid();
		g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)+E2"];
		const client = fakeClient(g);
		await expect(addExpense(client, { item: "x", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow(
			"expense window",
		);
		expect((client.batchUpdate as any).mock.calls.length).toBe(0);
	});

	it("inserts inside the SUM window even when it ends above the total row", async () => {
		const g = monthGrid();
		g[10] = ["", "", "", "花費總額", "=SUM(E3:E8)"];
		const client = fakeClient(g);

		const result = await addExpense(client, { item: "gap", amount: 9, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].insertDimension.range).toEqual({
			sheetId: 111,
			dimension: "ROWS",
			startIndex: 7,
			endIndex: 8,
		});
		expect(requests[1].updateCells.start).toEqual({ sheetId: 111, rowIndex: 7, columnIndex: 1 });
		expect(result).toMatchObject({ row: 8, inserted: true });
	});

	it("rejects a TWD-priced expense paid in USD before reading or writing anything", async () => {
		const client = fakeClient(monthGrid());
		await expect(
			addExpense(client, { item: "x", amount: 1, currency: "TWD", month: 9, paidWith: "USD" }),
		).rejects.toThrow("not representable");
		expect((client.readRange as any).mock.calls.length).toBe(0);
		expect((client.batchUpdate as any).mock.calls.length).toBe(0);
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
		// UNFORMATTED render of the 銀行餘額 block: the sheet's computed numbers.
		grid[18] = ["", "美金收入", "", 500];
		grid[19] = ["", "美金支出", "", 640.42];
		grid[20] = ["", "上月美金餘額", "", 1000];
		grid[21] = ["", "美金餘額", "", 859.58];
		grid[22] = ["", "新臺幣收入", "", 63913];
		grid[23] = ["", "新臺幣支出", "", 20000];
		grid[24] = ["", "上月新臺幣餘額", "", 5000];
		grid[25] = ["", "新臺幣餘額", "", 48913];

		const client = fakeClient(grid);
		const result = await monthSummary(client, 9);

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:H60", "UNFORMATTED_VALUE"]);
		expect(result).toEqual({
			tab: "9 月",
			花費總額: 72127.21,
			上月透支: 13603.67,
			tags: { 透支: 13603.67, 訂閱: 368.44 + 191.43 + 319.23, 生活用品: 1261, 購物: 5690.37 },
			incomes: [],
			薪水: 63913,
			沛還: 20500,
			剩餘: 12285.79,
			月美金餘額: null,
			月新臺幣餘額: null,
			美金透支沖銷: null,
			新臺幣透支沖銷: null,
			月剩餘: null,
			美金收入: 500,
			美金支出: 640.42,
			上月美金餘額: 1000,
			總美金餘額: 859.58,
			新臺幣收入: 63913,
			新臺幣支出: 20000,
			上月新臺幣餘額: 5000,
			總新臺幣餘額: 48913,
		});
	});

	it("reports the migrated layout: incomes list, 月 fields, 總…餘額 keys", async () => {
		const grid = migratedMonthGrid();
		// UNFORMATTED render: formulas come back as computed numbers
		grid[2] = [46266, "上月透支", "透支", "", 13603.67, "TWD"];
		grid[3] = ["", "Google Cloud", "訂閱", 11.53, 368.44, "USD"];
		grid[4] = ["", "電話費", "生活用品", "", 1261, "TWD"];
		grid[10] = ["", "", "", "花費總額", 15233.11];
		grid[16] = ["", "月美金餘額", "", -11.53];
		grid[17] = ["", "美金透支沖銷", "", 11.53];
		grid[18] = ["", "月新臺幣餘額", "", 133296.33];
		grid[19] = ["", "新臺幣透支沖銷", "", 0];
		grid[20] = ["", "月剩餘", "", 133296.33];
		grid[23] = ["", "美金收入", "", 0];
		grid[24] = ["", "美金支出", "", 11.53];
		grid[25] = ["", "上月美金餘額", "", 1000];
		grid[26] = ["", "總美金餘額", "", 988.47];
		grid[27] = ["", "新臺幣收入", "", 148326];
		grid[28] = ["", "新臺幣支出", "", 15029.67];
		grid[29] = ["", "上月新臺幣餘額", "", 5000];
		grid[30] = ["", "總新臺幣餘額", "", 138296.33];
		const client = fakeClient(grid);

		const result = await monthSummary(client, 9);

		expect(result).toEqual({
			tab: "9 月",
			花費總額: 15233.11,
			上月透支: 13603.67,
			tags: { 透支: 13603.67, 訂閱: 368.44, 生活用品: 1261 },
			incomes: [
				{ item: "沛還", currency: "TWD", amount: 20500 },
				{ item: "薪水", currency: "TWD", amount: 63913 },
				{ item: "多一個月薪水", currency: "TWD", amount: 63913 },
			],
			薪水: 63913,
			沛還: 20500,
			剩餘: null,
			月美金餘額: -11.53,
			月新臺幣餘額: 133296.33,
			美金透支沖銷: 11.53,
			新臺幣透支沖銷: 0,
			月剩餘: 133296.33,
			美金收入: 0,
			美金支出: 11.53,
			上月美金餘額: 1000,
			總美金餘額: 988.47,
			新臺幣收入: 148326,
			新臺幣支出: 15029.67,
			上月新臺幣餘額: 5000,
			總新臺幣餘額: 138296.33,
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
				start: { sheetId: 555, rowIndex: 2, columnIndex: 4 },
				rows: [{ values: [{ userEnteredValue: { formulaValue: "=IF(-'9 月'!D15 > 0, -'9 月'!D15, 0)" } }] }],
				fields: "userEnteredValue",
			},
		});
		// fixture totalRow is 11 → the clear covers rows 3-10 (0-indexed 2..10 exclusive)
		expect(requests[2]).toEqual({
			repeatCell: {
				range: { sheetId: 555, startRowIndex: 2, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 1 },
				cell: {},
				fields: "userEnteredValue",
			},
		});
		// 銀行餘額 carry-over: 上月美金餘額 (row 21) ← 9 月's 美金餘額 (row 22); 上月新臺幣餘額 (row 25) ← 新臺幣餘額 (row 26).
		expect(requests[3]).toEqual({
			updateCells: {
				start: { sheetId: 555, rowIndex: 20, columnIndex: 3 },
				rows: [{ values: [{ userEnteredValue: { formulaValue: "='9 月'!D22" } }] }],
				fields: "userEnteredValue",
			},
		});
		expect(requests[4]).toEqual({
			updateCells: {
				start: { sheetId: 555, rowIndex: 24, columnIndex: 3 },
				rows: [{ values: [{ userEnteredValue: { formulaValue: "='9 月'!D26" } }] }],
				fields: "userEnteredValue",
			},
		});
		// 近鐵 80000系 (row 8) is the only non-recurring item in the fixture
		// Scoped to A–F: the 乾坤大挪移 / 中餐預算 sections share these sheet rows.
		expect(requests[5]).toEqual({
			deleteRange: {
				range: { sheetId: 555, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 0, endColumnIndex: 6 },
				shiftDimension: "ROWS",
			},
		});
		expect(result).toEqual({
			tab: "10 月",
			duplicatedFrom: "9 月",
			kept: ["上月透支", "Google Cloud", "ElevenLabs", "iCloud", "電話費"],
			cleared: ["近鐵 80000系"],
			clearedIncomes: [],
			lunchCleared: false,
		});
	});

	it("refuses to overwrite an existing tab and requires the previous month", async () => {
		const exists = startMonthClient(monthGrid(), ["10 月", "9 月"]);
		await expect(startMonth(exists, 10)).rejects.toThrow('"10 月" already exists');

		const noPrev = startMonthClient(monthGrid(), ["7 月"]);
		await expect(startMonth(noPrev, 10)).rejects.toThrow('"9 月" not found');
		expect((noPrev.batchUpdate as any).mock.calls.length).toBe(0);
	});

	it("deletes multiple one-off rows bottom-up", async () => {
		const grid = monthGrid();
		grid[8] = ["", "一次性A", "雜", "", 10];
		grid[9] = ["", "一次性B", "雜", "", 20];
		const client = startMonthClient(grid, ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		const deletes = requests.filter((r: any) => r.deleteRange);
		expect(deletes.map((r: any) => r.deleteRange.range.startRowIndex)).toEqual([9, 8, 7]);
		expect(result.cleared).toEqual(["近鐵 80000系", "一次性A", "一次性B"]);
	});

	it("skips the 銀行餘額 carry-over on tabs that predate the block", async () => {
		const stripped = monthGrid();
		stripped.length = 17; // drop the 銀行餘額 rows (indices 17+)
		const client = startMonthClient(stripped, ["9 月", "8 月"]);

		await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		// No 上月餘額 rows to rewire → nothing writes into the budget-value column (D).
		const carryWrites = requests.filter(
			(r: any) => r.updateCells && r.updateCells.start.columnIndex === MONTH_COLS.budgetValue,
		);
		expect(carryWrites).toEqual([]);
	});

	it("clears ad-hoc income rows but keeps 沛還/薪水, rewiring 上月餘額 to the 總…餘額 rows", async () => {
		const client = startMonthClient(migratedMonthGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		// carry-over: 上月美金餘額 (row 24) ← 9 月's 總美金餘額 (row 25); NTD likewise (28 ← 29)
		const carryWrites = requests.filter(
			(r: any) => r.updateCells && r.updateCells.start.columnIndex === MONTH_COLS.budgetValue,
		);
		expect(carryWrites).toEqual([
			{
				updateCells: {
					start: { sheetId: 555, rowIndex: 25, columnIndex: 3 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "='9 月'!D27" } }] }],
					fields: "userEnteredValue",
				},
			},
			{
				updateCells: {
					start: { sheetId: 555, rowIndex: 29, columnIndex: 3 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "='9 月'!D31" } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
		// overdraft carry rewires against 月剩餘 (row 20) on the migrated layout, not a stale row reference.
		const overdraftWrite = requests.find(
			(r: any) => r.updateCells && r.updateCells.start.rowIndex === 2 && r.updateCells.start.columnIndex === 4,
		);
		expect(overdraftWrite.updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: "=IF(-'9 月'!D21 > 0, -'9 月'!D21, 0)" } },
		]);
		// 多一個月薪水 (row 16) is the only ad-hoc income; expense rows are all recurring
		const deletes = requests.filter((r: any) => r.deleteRange);
		expect(deletes).toEqual([
			{
				deleteRange: {
					range: { sheetId: 555, startRowIndex: 15, endRowIndex: 16, startColumnIndex: 0, endColumnIndex: 6 },
					shiftDimension: "ROWS",
				},
			},
		]);
		expect(result.cleared).toEqual([]);
		expect(result.clearedIncomes).toEqual(["多一個月薪水"]);
	});

	it("clears the 中餐預算 data rows so the new month starts empty", async () => {
		const client = startMonthClient(lunchGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		expect((client.readRange as any).mock.calls[0]).toEqual(["'10 月'!A1:Q60", "FORMULA"]);
		const requests = (client.batchUpdate as any).mock.calls[1][0];
		// data rows 37..37 (0-indexed 36..37), columns O–Q (14..17) — cells cleared, nothing shifts
		const clear = requests.find((r: any) => r.repeatCell && r.repeatCell.range.startColumnIndex === 14);
		expect(clear).toEqual({
			repeatCell: {
				range: { sheetId: 555, startRowIndex: 36, endRowIndex: 37, startColumnIndex: 14, endColumnIndex: 17 },
				cell: {},
				fields: "userEnteredValue",
			},
		});
		expect(result.lunchCleared).toBe(true);
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

describe("addTripEntry (mosaic)", () => {
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

		// row 4 is the first empty band-A row; totals =SUM(E3:E5)/=SUM(G3:G5) already cover it
		expect((client.batchUpdate as any).mock.calls.length).toBe(0);
		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!A4:G4",
			[["10/10", "Volks", "N規小物", "Suica", 2200, "=E4*0.22", "=CEILING(F4)"]],
		]);
		expect(result).toMatchObject({ category: "模型", row: 4, currency: "JPY" });
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

		expect((client.batchUpdate as any).mock.calls.length).toBe(0);
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
		]);
		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!A5:G5",
			[["07/26", "", "Suica 儲值", "現金", 3000, "=E5*0.22", "=CEILING(F5)"]],
		]);
		expect(result).toMatchObject({ category: "交通", row: 5 });
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

		expect((client.batchUpdate as any).mock.calls.length).toBe(0);
		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!I5:O5",
			[["07/27", "", "追加住宿", "信用卡", 12000, "=M5*0.22", "=CEILING(N5)"]],
		]);
		expect(result).toMatchObject({ row: 5, currency: "JPY" });
	});
});

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

describe("getCategories", () => {
	function validationClient(rule: { type: string; values: string[] } | null, rangeValues?: unknown[][]) {
		return {
			getDataValidation: vi.fn(async () => rule),
			readRange: vi.fn(async () => ({ range: "x", values: rangeValues ?? [], truncated: false })),
		} as unknown as SheetsClient;
	}

	it("returns deduped ONE_OF_LIST values from the 類別 column probe", async () => {
		const client = validationClient({
			type: "ONE_OF_LIST",
			values: ["訂閱", "吃喝", "交通", "吃喝"],
		});

		const result = await getCategories(client, 7);

		expect((client.getDataValidation as any).mock.calls[0]).toEqual(["7 月", 3, 15, "C"]);
		expect(result).toEqual({ tab: "7 月", categories: ["訂閱", "吃喝", "交通"], source: "ONE_OF_LIST" });
		expect(client.readRange).not.toHaveBeenCalled();
	});

	it("follows a ONE_OF_RANGE rule and flattens non-empty string cells", async () => {
		const client = validationClient({ type: "ONE_OF_RANGE", values: ["=Settings!A1:A20"] }, [
			["訂閱"],
			["吃喝"],
			[""],
			["吃喝"],
			[42],
			["生活用品"],
		]);

		const result = await getCategories(client, 7);

		expect((client.readRange as any).mock.calls[0]).toEqual(["Settings!A1:A20"]);
		expect(result).toEqual({
			tab: "7 月",
			categories: ["訂閱", "吃喝", "生活用品"],
			source: "ONE_OF_RANGE",
		});
	});

	it("throws a tab-naming error when no rule exists", async () => {
		const client = validationClient(null);

		await expect(getCategories(client, 6)).rejects.toThrow(
			'No data validation found on the 類別 column of "6 月" — the tab may predate the 類別 dropdown.',
		);
	});

	it("throws on a rule type that is not a dropdown", async () => {
		const client = validationClient({ type: "NUMBER_GREATER", values: ["0"] });

		await expect(getCategories(client, 7)).rejects.toThrow(
			'類別 column validation on "7 月" is NUMBER_GREATER, not a dropdown list.',
		);
	});

	it("defaults to the current Taipei month when month is omitted", async () => {
		const client = validationClient({ type: "ONE_OF_LIST", values: ["訂閱"] });

		const result = await getCategories(client);

		expect(result.tab).toBe(currentMonthTab());
	});
});

describe("setIncome", () => {
	it("updates an existing income row's 幣別 and amount in place", async () => {
		const client = fakeClient(migratedMonthGrid());

		const result = await setIncome(client, { item: "薪水", amount: 68587, currency: "TWD", month: 9 });

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:H60", "FORMULA"]);
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toEqual([
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 14, columnIndex: 2 },
					rows: [{ values: [{ userEnteredValue: { stringValue: "TWD" } }, { userEnteredValue: { numberValue: 68587 } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(result).toEqual({
			tab: "9 月",
			row: 15,
			action: "updated",
			item: "薪水",
			amount: 68587,
			currency: "TWD",
			previous: { currency: "TWD", amount: "63913" },
			migration: null,
		});
	});

	it("inserts a new ad-hoc income row inside the window so the SUMIFs auto-extend", async () => {
		const client = fakeClient(migratedMonthGrid());

		const result = await setIncome(client, { item: "股息", amount: 120, currency: "USD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// window rows 14-16 are all occupied → insert at the window's LAST row
		// (16), strictly inside C14:C16 / D14:D16, so every SUMIF extends.
		expect(requests).toEqual([
			{
				insertDimension: {
					range: { sheetId: 111, dimension: "ROWS", startIndex: 15, endIndex: 16 },
					inheritFromBefore: true,
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 15, columnIndex: 1 },
					rows: [{ values: [
						{ userEnteredValue: { stringValue: "股息" } },
						{ userEnteredValue: { stringValue: "USD" } },
						{ userEnteredValue: { numberValue: 120 } },
					] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(result).toMatchObject({ row: 16, action: "inserted", previous: null, migration: null });
	});

	it("reuses an empty row inside the income window before inserting", async () => {
		const g = migratedMonthGrid();
		g[15] = ["", "", "", ""]; // row 16 empty (多一個月薪水 removed)
		const client = fakeClient(g);

		const result = await setIncome(client, { item: "獎金", amount: 5000, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toHaveLength(1);
		expect(requests[0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 15, columnIndex: 1 });
		expect(result).toMatchObject({ row: 16, action: "inserted" });
	});

	it("migrates an old-layout tab first, then applies the upsert to the re-read grid", async () => {
		const client = fakeClient(oldLayoutGrid());
		(client.readRange as any)
			.mockResolvedValueOnce({ range: "x", values: oldLayoutGrid(), truncated: false })
			.mockResolvedValueOnce({ range: "x", values: migratedMonthGrid(), truncated: false });

		const result = await setIncome(client, { item: "薪水", amount: 70000, currency: "TWD", month: 9 });

		// batch 1 = migration, batch 2 = the income write
		expect((client.batchUpdate as any).mock.calls).toHaveLength(2);
		expect((client.batchUpdate as any).mock.calls[0][0][0]).toHaveProperty("insertDimension");
		expect((client.batchUpdate as any).mock.calls[1][0][0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 14, columnIndex: 2 });
		expect(result.action).toBe("updated");
		expect(result.migration).not.toBeNull();
		expect(result.migration!.changes.length).toBeGreaterThan(0);
	});

	it("rejects layout labels as income items before touching the sheet", async () => {
		const client = fakeClient(migratedMonthGrid());
		await expect(setIncome(client, { item: "月剩餘", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		await expect(setIncome(client, { item: "花費總額", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		await expect(setIncome(client, { item: "美金透支沖銷", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		await expect(setIncome(client, { item: "新臺幣透支沖銷", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		expect((client.readRange as any).mock.calls).toHaveLength(0);
	});

	it("fails with a clear message when the tab has no income list anchors", async () => {
		const client = fakeClient(monthGrid()); // no 總預算 row
		await expect(setIncome(client, { item: "薪水", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("income list");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("refuses to operate on a truncated read", async () => {
		const client = fakeClient(migratedMonthGrid());
		(client.readRange as any).mockResolvedValue({ range: "x", values: migratedMonthGrid(), truncated: true });
		await expect(setIncome(client, { item: "薪水", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("truncated");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});
});
