import { describe, expect, it, vi } from "vitest";
import {
	adaptRowFormula,
	addExpense,
	addLunch,
	addTransfer,
	addTripEntry,
	adjustBalance,
	annotateRows,
	cellData,
	colIndex,
	colLetter,
	expandAnchorRange,
	expensePositionFor,
	findCells,
	FIND_CELLS_CAP,
	findCreditSection,
	findExpenseWindow,
	findIncomeSumifWindow,
	findIncomeWindow,
	findLunchSection,
	findRowByLabels,
	findRowByValue,
	findTransferSection,
	findTripBlocks,
	FULL_GRID_READ,
	getCategories,
	monthSummary,
	safeUpdateRange,
	setExpenseDate,
	setIncome,
	startMonth,
} from "../src/finance-ops";
import { currentMonthTab, dateSerial, MONTH_COLS, todaySerial } from "../src/conventions";
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

/** Old-layout monthGrid with the split carry rows but no 月 view — the degenerate rebuild case (剩餘 shifts to row 16). */
function splitCarryOldLayoutGrid(): unknown[][] {
	const g = monthGrid();
	g.splice(
		2,
		1,
		["", "上月美金透支", "透支", 0, '=D3*GOOGLEFINANCE("CURRENCY:USDTWD")', "USD"],
		["", "上月新臺幣透支", "透支", "", "=IF(-'8 月'!D15 > 0, -'8 月'!D15, 0)", "TWD"],
	);
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

	it("findExpenseWindow reads the window from the 花費總額 SUM formula", () => {
		expect(findExpenseWindow(monthGrid(), "9 月")).toEqual({ totalRow: 11, start: 3, end: 10 });
	});

	it("findExpenseWindow fails closed on a missing anchor or a non-SUM total", () => {
		expect(() => findExpenseWindow([["nothing"]], "9 月")).toThrow("花費總額");
		const g = monthGrid();
		g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)+E2"];
		expect(() => findExpenseWindow(g, "9 月")).toThrow("expense window");
	});

	it("findIncomeWindow detects current and old layouts, skips the 項目 header, null without anchors", () => {
		expect(findIncomeWindow(currentMonthGrid())).toEqual({ start: 15, end: 18, current: true });
		expect(findIncomeWindow(oldLayoutGrid())).toEqual({ start: 14, end: 15, current: false });
		expect(findIncomeWindow(monthGrid())).toBeNull(); // no 總預算 header
		expect(findIncomeWindow([["x"]])).toBeNull();
	});

	it("findIncomeSumifWindow reads the writable rows from the 本月美金收入 SUMIF, header excluded", () => {
		expect(findIncomeSumifWindow(currentMonthGrid(), "9 月")).toEqual({ start: 15, end: 17 });
	});

	it("findIncomeSumifWindow fails closed on a missing 本月美金收入 row or a non-SUMIF formula", () => {
		expect(() => findIncomeSumifWindow(monthGrid(), "9 月")).toThrow("本月美金收入");
		const g = currentMonthGrid();
		g[22] = ["", "本月美金收入", "", 600];
		expect(() => findIncomeSumifWindow(g, "9 月")).toThrow("income window");
	});
});

describe("expensePositionFor", () => {
	/** Window rows 3-10, 花費總額 at 11; carries dated 100, then 101 / 103 / dateless Netflix, empties 8-10. */
	function orderedGrid(): unknown[][] {
		const g: unknown[][] = [];
		g[2] = [100, "上月美金透支", "透支", 5, "", "USD"];
		g[3] = [100, "上月新臺幣透支", "透支", "", 5, "TWD"];
		g[4] = [101, "早餐", "吃喝", "", 80, "TWD"];
		g[5] = [103, "晚餐", "吃喝", "", 250, "TWD"];
		g[6] = ["", "Netflix", "訂閱", 26.99, "=D7*X", "USD"];
		g[10] = ["", "", "", "花費總額", "=SUM(E3:E10)"];
		return g;
	}

	it("places a dated row after the last not-later date, ties after", () => {
		expect(expensePositionFor(orderedGrid(), 3, 10, 11, 102)).toBe(6); // between 早餐(101) and 晚餐(103)
		expect(expensePositionFor(orderedGrid(), 3, 10, 11, 101)).toBe(6); // tie with 早餐 → after it
		expect(expensePositionFor(orderedGrid(), 3, 10, 11, 104)).toBe(7); // after 晚餐, before dateless Netflix
	});

	it("places a dateless row after every non-empty row", () => {
		expect(expensePositionFor(orderedGrid(), 3, 10, 11, null)).toBe(8);
	});

	it("clamps a backdated row below the carry rows", () => {
		expect(expensePositionFor(orderedGrid(), 3, 10, 11, 99)).toBe(5);
	});

	it("masks ignoreRow when repositioning an existing row", () => {
		// 晚餐 (row 6) redated between the carries and 早餐: without itself the last <= is 早餐 (row 5)
		expect(expensePositionFor(orderedGrid(), 3, 10, 11, 101, 6)).toBe(6);
	});

	it("scans only to the row above 花費總額 when the window reaches past it", () => {
		expect(expensePositionFor(orderedGrid(), 3, 15, 11, null)).toBe(8);
	});

	it("degrades gracefully on an unsorted list: after the LAST not-later row, not the max date", () => {
		const g = orderedGrid();
		// swap 早餐(101) and 晚餐(103) so dates are out of order
		const early = g[4];
		g[4] = g[5];
		g[5] = early;
		// 102: 晚餐(103, row 5) doesn't qualify; the LAST row dated <= 102 is 早餐(101) at row 6
		expect(expensePositionFor(g, 3, 10, 11, 102)).toBe(7);
	});
});

describe("findTransferSection", () => {
	it("locates the header and 總和 rows from the anchor", () => {
		expect(findTransferSection(transferGrid(), "9 月")).toEqual({ headerRow: 34, totalRow: 36 });
	});

	it("throws when the tab has no 乾坤大挪移 section", () => {
		expect(() => findTransferSection(currentMonthGrid(), "6 月")).toThrow("乾坤大挪移");
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
});

/**
 * lunchGrid + a 信用卡帳單對帳區 (anchor H40) with two card blocks:
 * 國泰 CUBE at H41 (values in J, lag 1) and CHASE Amazon at L41 (values in N,
 * lag 0). Rows: title 41, 結帳日 42, 繳款日 43, 本月需繳款 44, 結帳日前 45,
 * header 46, cushion 47-48, 小計 49, 結帳日後 51, header 52, cushion 53-54, 小計 55.
 * The 小計 label sits in the block's 2nd column (I/M), the value in the 3rd (J/N).
 */
function creditGrid(): unknown[][] {
	const g = lunchGrid();
	const put = (idx: number, col: number, v: unknown) => {
		(g[idx] ??= [])[col] = v;
	};
	put(39, 7, "信用卡帳單對帳區");
	// 國泰 CUBE — H/I/J (7/8/9)
	put(40, 7, "國泰 CUBE");
	put(41, 7, "本月結帳日");
	put(41, 9, dateSerial(2026, 7, 19));
	put(42, 7, "本月繳款日");
	put(42, 9, dateSerial(2026, 7, 6));
	put(43, 7, "本月需繳款");
	put(43, 9, 21500);
	put(44, 7, "結帳日前");
	put(45, 7, "日期");
	put(45, 8, "項目");
	put(45, 9, "金額");
	// rows 47-48 (idx 46-47) intentionally empty data cushion
	put(48, 8, "小計");
	put(48, 9, '=SUMIFS(E3:E,G3:G,"國泰 CUBE",A3:A,"<="&J43,A3:A,">0")');
	put(50, 7, "結帳日後");
	put(51, 7, "日期");
	put(51, 8, "項目");
	put(51, 9, "金額");
	// rows 53-54 (idx 52-53) intentionally empty data cushion
	put(54, 8, "小計");
	put(54, 9, '=SUMIFS(E3:E,G3:G,"國泰 CUBE",A3:A,">"&J43)');
	// CHASE Amazon — L/M/N (11/12/13)
	put(40, 11, "CHASE Amazon");
	put(41, 11, "本月結帳日");
	put(41, 13, dateSerial(2026, 7, 3));
	put(42, 11, "本月繳款日");
	put(42, 13, dateSerial(2026, 7, 28));
	put(43, 11, "本月需繳款");
	put(43, 13, "=N49+'6 月'!N55");
	put(44, 11, "結帳日前");
	put(45, 11, "日期");
	put(45, 12, "項目");
	put(45, 13, "金額");
	put(48, 12, "小計");
	put(48, 13, '=SUMIFS(D3:D,G3:G,"CHASE Amazon",A3:A,"<="&N43,A3:A,">0")');
	put(50, 11, "結帳日後");
	put(51, 11, "日期");
	put(51, 12, "項目");
	put(51, 13, "金額");
	put(54, 12, "小計");
	put(54, 13, '=SUMIFS(D3:D,G3:G,"CHASE Amazon",A3:A,">"&N43)');
	return g;
}

/** creditGrid + the 帳戶實際數字對應 block in B/D rows 34-43, below the 銀行餘額 block. */
function realBalanceGrid(): unknown[][] {
	const g = creditGrid();
	const put = (idx: number, col: number, v: unknown) => {
		(g[idx] ??= [])[col] = v;
	};
	put(33, 1, "帳戶實際數字對應");
	put(34, 1, "本月初新臺幣真實餘額");
	put(34, 3, "='8 月'!D38");
	put(35, 1, "本月新臺幣現金支出");
	put(35, 3, '=SUMIFS(E3:E10, F3:F10, "TWD", G3:G10, "現金") + M36');
	put(36, 1, "本月新臺幣信用卡繳費");
	put(36, 3, "=J44");
	put(37, 1, "本月底新臺幣真實餘額");
	put(37, 3, '=D35+SUMIF(C14:C17, "TWD", D14:D17) - D36 - D37 - I36');
	// row 39 blank — the gap between the two currency blocks
	put(39, 1, "本月初美金真實餘額");
	put(39, 3, "='8 月'!D43");
	put(40, 1, "本月美金現金支出");
	put(40, 3, '=SUMIFS(D3:D10, F3:F10, "USD", G3:G10, "現金")');
	put(41, 1, "本月美金信用卡繳費");
	put(41, 3, "=N44");
	put(42, 1, "本月底美金真實餘額");
	put(42, 3, '=D40+SUMIF(C14:C17, "USD", D14:D17) - D41 - D42 + K36');
	return g;
}

/**
 * realBalanceGrid + the 調整 layout (2026-07): a per-currency adjustment cell
 * shared by the 調整後 rows of both the 銀行餘額 and 真實餘額 views. Rows
 * 44-49 in B/D; the finders key on the labels, not the positions.
 */
function adjustedBalanceGrid(): unknown[][] {
	const g = realBalanceGrid();
	const put = (idx: number, col: number, v: unknown) => {
		(g[idx] ??= [])[col] = v;
	};
	put(43, 1, "新臺幣餘額調整");
	put(43, 3, 0);
	put(44, 1, "調整後本月底新臺幣真實餘額");
	put(44, 3, "=D38+D44");
	put(45, 1, "美金餘額調整");
	put(45, 3, 0);
	put(46, 1, "調整後本月底美金真實餘額");
	put(46, 3, "=D43+D46");
	put(47, 1, "調整後的本月底新臺幣餘額");
	put(47, 3, "=D32+D44");
	put(48, 1, "調整後本月底美金餘額");
	put(48, 3, "=D26+D46");
	return g;
}

describe("findCreditSection", () => {
	it("locates every card block present, skipping registry cards missing from the sheet", () => {
		const blocks = findCreditSection(creditGrid(), "9 月");
		expect(blocks.map((b) => [b.card.name, b.startCol])).toEqual([
			["國泰 CUBE", 7],
			["CHASE Amazon", 11],
		]);
		expect(blocks[0]).toMatchObject({
			titleRow: 41,
			closeDateRow: 42,
			payDateRow: 43,
			dueRow: 44,
			preLabelRow: 45,
			postLabelRow: 51,
			preSubtotalRow: 49,
			postSubtotalRow: 55,
		});
		expect(blocks[1]).toMatchObject({ titleRow: 41, startCol: 11, postSubtotalRow: 55 });
	});

	it("throws when the tab has no 信用卡帳單對帳區", () => {
		expect(() => findCreditSection(lunchGrid(), "6 月")).toThrow("信用卡帳單對帳區");
	});

	it("throws naming the card and the missing label when a block is torn", () => {
		const g = creditGrid();
		(g[43] as unknown[])[7] = ""; // CUBE loses its 本月需繳款 label
		expect(() => findCreditSection(g, "9 月")).toThrow(/國泰 CUBE.*本月需繳款/);
	});

	it("throws naming the card and 小計 when the bounded scan crosses into the next bucket", () => {
		const g = creditGrid();
		(g[48] as unknown[])[8] = ""; // CUBE loses its pre-小計 label
		expect(() => findCreditSection(g, "9 月")).toThrow(/國泰 CUBE.*小計/);
	});

	it("never adopts a 小計 from the next card block stacked below in the same column", () => {
		const g = creditGrid();
		(g[54] as unknown[])[8] = ""; // CUBE loses its post-小計 label
		(g[57] ??= [])[7] = "CHASE Freedom"; // ...and Freedom's block starts below
		(g[58] ??= [])[8] = "小計"; // a literal match a few rows below Freedom's title — must never be adopted
		expect(() => findCreditSection(g, "9 月")).toThrow(/國泰 CUBE.*小計/);
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

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:N60", "FORMULA"]);
		// batch 1: scratch GOOGLEFINANCE into J35, no insert needed
		const batch1 = (client.batchUpdate as any).mock.calls[0][0];
		expect(batch1).toHaveLength(1);
		expect(batch1[0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 34, columnIndex: 9 });
		expect(batch1[0].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			formulaValue: '=GOOGLEFINANCE("CURRENCY:USDTWD")',
		});
		expect((client.readRange as any).mock.calls[1]).toEqual(["'9 月'!J35", "UNFORMATTED_VALUE"]);

		// batch 2: 日期, the entry row, the 總和 rewrite
		const batch2 = (client.batchUpdate as any).mock.calls[1][0];
		const dateCell = batch2[0].updateCells;
		expect(dateCell.start).toEqual({ sheetId: 111, rowIndex: 34, columnIndex: 7 });
		expect(dateCell.rows[0].values[0].userEnteredFormat).toEqual({
			numberFormat: { type: "DATE", pattern: "mm/dd" },
		});
		const rowCells = batch2[1].updateCells;
		expect(rowCells.start).toEqual({ sheetId: 111, rowIndex: 34, columnIndex: 8 });
		expect(rowCells.rows[0].values.map((v: any) => v.userEnteredValue)).toEqual([
			{ numberValue: 30000 }, // I 新臺幣
			{ formulaValue: "=I35/29.85" }, // J 當下美金 (pinned)
			{ numberValue: 1000 }, // K 實際美金
			{ formulaValue: "=(J35-K35)*29.85" }, // L 匯差 (pinned)
			{ numberValue: 30 }, // M 手續費
			{ formulaValue: "=L35+M35" }, // N 當筆總額外花費
		]);
		const sums = batch2[2].updateCells;
		expect(sums.start).toEqual({ sheetId: 111, rowIndex: 35, columnIndex: 8 });
		expect(sums.rows[0].values.map((v: any) => v.userEnteredValue.formulaValue)).toEqual([
			"=SUM(I35:I35)",
			"=SUM(J35:J35)",
			"=SUM(K35:K35)",
			"=SUM(L35:L35)",
			"=SUM(M35:M35)",
			"=SUM(N35:N35)",
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
		grid[34] = ["", "", "", "", "", "", "", 46266, 30000, "=I35/29.9", 1000, "=(J35-K35)*29.9", 30, "=L35+M35"];
		const client = transferClient(grid);
		const result = await addTransfer(client, { ntd: 15000, usd: 500, fee: 15, month: 9, date: "9/9" });

		const batch1 = (client.batchUpdate as any).mock.calls[0][0];
		expect(batch1[0].insertDimension.range).toEqual({
			sheetId: 111,
			dimension: "ROWS",
			startIndex: 35,
			endIndex: 36,
		});
		expect(batch1[1].updateCells.start).toEqual({ sheetId: 111, rowIndex: 35, columnIndex: 9 });
		expect((client.readRange as any).mock.calls[1]).toEqual(["'9 月'!J36", "UNFORMATTED_VALUE"]);

		const batch2 = (client.batchUpdate as any).mock.calls[1][0];
		expect(batch2[2].updateCells.start).toEqual({ sheetId: 111, rowIndex: 36, columnIndex: 8 });
		expect(batch2[2].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			formulaValue: "=SUM(I35:I36)",
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
		expect(calls[1][0][0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 34, columnIndex: 9 });
		expect(calls[1][0][0].updateCells.rows[0].values).toEqual([{}]);
	});

	it("refuses when the tab has no 乾坤大挪移 section", async () => {
		const client = transferClient(currentMonthGrid());
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
			range.includes("A1:S160")
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

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:S160", "FORMULA"]);
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toHaveLength(3); // date cell, item+amount, 總和 rewrite — no insert needed
		const dateCell = requests[0].updateCells;
		expect(dateCell.start).toEqual({ sheetId: 111, rowIndex: 36, columnIndex: 15 });
		expect(dateCell.rows[0].values[0].userEnteredFormat).toEqual({
			numberFormat: { type: "DATE", pattern: "mm/dd" },
		});
		const rowCells = requests[1].updateCells;
		expect(rowCells.start).toEqual({ sheetId: 111, rowIndex: 36, columnIndex: 16 });
		expect(rowCells.rows[0].values.map((v: any) => v.userEnteredValue)).toEqual([
			{ stringValue: "中餐" }, // Q 項目 defaults
			{ numberValue: 143 }, // R 金額
			undefined, // S 支付方式 blank (cash)
		]);
		const sum = requests[2].updateCells;
		expect(sum.start).toEqual({ sheetId: 111, rowIndex: 37, columnIndex: 17 });
		expect(sum.rows[0].values[0].userEnteredValue).toEqual({ formulaValue: "=SUM(R37:R37)" });

		// the 編列預算/剩餘 row is read back AFTER the write so the echo includes this entry
		expect((client.readRange as any).mock.calls[1]).toEqual(["'9 月'!P35:R35", "UNFORMATTED_VALUE"]);
		expect(result).toEqual({
			tab: "9 月",
			row: 37,
			inserted: false,
			date: "2026-09-02",
			item: "中餐",
			amount: 143,
			card: null,
			budget: 3900,
			spent: 353, // 編列預算 − 剩餘
			leftover: 3547,
			bucket: null,
			bucketRowsAdded: 0,
			bucketWarning: undefined,
		});
	});

	it("inserts a row above 總和 when the section is full and widens the sum", async () => {
		const g = lunchGrid();
		(g[36] ??= [])[15] = 46266;
		(g[36] as unknown[])[16] = "中餐";
		(g[36] as unknown[])[17] = 143;
		const client = lunchClient(g);
		const result = await addLunch(client, { amount: 210, month: 9, date: "9/9" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toHaveLength(4);
		expect(requests[0].insertDimension).toEqual({
			range: { sheetId: 111, dimension: "ROWS", startIndex: 37, endIndex: 38 },
			inheritFromBefore: true,
		});
		expect(requests[1].updateCells.start).toEqual({ sheetId: 111, rowIndex: 37, columnIndex: 15 });
		expect(requests[3].updateCells.start).toEqual({ sheetId: 111, rowIndex: 38, columnIndex: 17 });
		expect(requests[3].updateCells.rows[0].values[0].userEnteredValue).toEqual({
			formulaValue: "=SUM(R37:R38)",
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
		await expect(addLunch(client, { amount: 100, month: 6 })).rejects.toThrow("午餐預算");
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

	it("writes the card into 支付方式 (S) and echoes it", async () => {
		const client = fakeClient(lunchGrid());
		const result = await addLunch(client, { amount: 143, month: 9, date: "9/2", card: "國泰 CUBE" });
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		const write = requests.find((r: any) => r.updateCells && r.updateCells.start.columnIndex === 16);
		expect(write.updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { stringValue: "中餐" } },
			{ userEnteredValue: { numberValue: 143 } },
			{ userEnteredValue: { stringValue: "國泰 CUBE" } },
		]);
		expect(result.card).toBe("國泰 CUBE");
	});

	it("rejects an unknown card before any read or write", async () => {
		const client = fakeClient(lunchGrid());
		await expect(addLunch(client, { amount: 100, month: 9, card: "玉山 Ubear" })).rejects.toThrow("國泰 CUBE");
		expect((client.readRange as any).mock.calls.length).toBe(0);
	});

	it("rejects a USD-billed card — lunches are NTD", async () => {
		const client = fakeClient(lunchGrid());
		await expect(addLunch(client, { amount: 100, month: 9, card: "Apple Card" })).rejects.toThrow("TWD");
		expect((client.readRange as any).mock.calls.length).toBe(0);
	});

	it("accepts 現金 as the lunch 支付方式 — no TWD-billing check, no bucket guard", async () => {
		const client = fakeClient(lunchGrid());
		const result = await addLunch(client, { amount: 90, month: 9, date: "9/2", card: "現金" });
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		const write = requests.find((r: any) => r.updateCells && r.updateCells.start.columnIndex === 16);
		expect(write.updateCells.rows[0].values[2]).toEqual({ userEnteredValue: { stringValue: "現金" } });
		expect(result.card).toBe("現金");
		expect(result.bucketWarning).toBeUndefined();
	});

	it("writes a blank 支付方式 when card is omitted", async () => {
		const client = fakeClient(lunchGrid());
		await addLunch(client, { amount: 55, month: 9, date: "9/2" });
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		const write = requests.find((r: any) => r.updateCells && r.updateCells.start.columnIndex === 16);
		expect(write.updateCells.rows[0].values[2]).toEqual({});
	});

	it("does not treat a row with only 支付方式 filled as an empty slot", async () => {
		const g = lunchGrid();
		(g[36] ??= [])[18] = "國泰 CUBE"; // the empty data slot (row 37) has a stray S value
		const client = fakeClient(g);
		const result = await addLunch(client, { amount: 55, month: 9, date: "9/2" });
		expect(result.inserted).toBe(true); // slot skipped → inserts above 總和
	});

	describe("bucket room guard", () => {
		it("grows the card's bucket when the lunch entry overflows its mirror", async () => {
			const g = creditGrid();
			g[4] = [dateSerial(2026, 7, 10), "既有1", "訂閱", "", 100, "TWD", "國泰 Cube"];
			g[5] = [dateSerial(2026, 7, 10), "既有2", "訂閱", "", 100, "TWD", "國泰 Cube"];
			const client = fakeClient(g);
			const result = await addLunch(client, { amount: 120, month: 9, date: "7/10", card: "國泰 CUBE" });
			expect(result.inserted).toBe(false);
			const requests = (client.batchUpdate as any).mock.calls[0][0];
			const insert = requests.find((r: any) => r.insertDimension);
			expect(insert.insertDimension).toEqual({
				range: { sheetId: 111, dimension: "ROWS", startIndex: 48, endIndex: 49 },
				inheritFromBefore: true,
			});
			expect(result).toMatchObject({ bucket: "結帳日前", bucketRowsAdded: 1 });
		});

		it("shifts the card bucket insert by the lunch section's own row insert", async () => {
			const g = creditGrid();
			g[4] = [dateSerial(2026, 7, 10), "既有1", "訂閱", "", 100, "TWD", "國泰 Cube"];
			g[5] = [dateSerial(2026, 7, 10), "既有2", "訂閱", "", 100, "TWD", "國泰 Cube"];
			(g[36] ??= [])[15] = dateSerial(2026, 7, 5);
			(g[36] as unknown[])[16] = "早餐";
			(g[36] as unknown[])[17] = 60;
			const client = fakeClient(g);
			const result = await addLunch(client, { amount: 120, month: 9, date: "7/10", card: "國泰 CUBE" });
			expect(result.inserted).toBe(true);
			const requests = (client.batchUpdate as any).mock.calls[0][0];
			const bucketInsert = requests.find((r: any) => r.insertDimension && r.insertDimension.range.startIndex === 49);
			expect(bucketInsert.insertDimension).toEqual({
				range: { sheetId: 111, dimension: "ROWS", startIndex: 49, endIndex: 50 },
				inheritFromBefore: true,
			});
			expect(result).toMatchObject({ bucketRowsAdded: 1 });
		});

		it("skips the guard when no card is given", async () => {
			const client = fakeClient(creditGrid());
			const result = await addLunch(client, { amount: 100, month: 9, date: "7/10" });
			expect(result.bucket).toBeNull();
			expect(result.bucketRowsAdded).toBe(0);
			expect(result.bucketWarning).toBeUndefined();
		});
	});
});

describe("addExpense", () => {
	it("writes a TWD expense into the first empty window row", async () => {
		const client = fakeClient(monthGrid());

		const result = await addExpense(client, { item: "晚餐", amount: 250, currency: "TWD", month: 9 });

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:S160", "FORMULA"]);
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
						{},
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
			{},
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
								{},
							],
						},
					],
					fields: "userEnteredValue",
				},
			},
		]);
	});

	it("inserts + moves below the last row when the window is full (dateless sorts last)", async () => {
		const grid = monthGrid();
		grid[8] = ["", "already", "雜", "", 1];
		grid[9] = ["", "full", "雜", "", 2];

		const client = fakeClient(grid);
		const result = await addExpense(client, { item: "加購", amount: 100, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0]).toEqual({
			insertDimension: {
				range: { sheetId: 111, dimension: "ROWS", startIndex: 9, endIndex: 10 },
				inheritFromBefore: true,
			},
		});
		expect(requests[1]).toEqual({
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
							{},
						],
					},
				],
				fields: "userEnteredValue",
			},
		});
		// pre-removal coordinates: one past the shifted old last row
		expect(requests.at(-1)).toEqual({
			moveDimension: {
				source: { sheetId: 111, dimension: "ROWS", startIndex: 9, endIndex: 10 },
				destinationIndex: 11,
			},
		});
		expect(result).toMatchObject({ row: 11, inserted: true });
	});

	it("inserts a backdated expense at its date-sorted position", async () => {
		const g = currentMonthGrid();
		g[6] = [dateSerial(2026, 7, 10), "晚餐", "吃喝", "", 300, "TWD"]; // row 7 dated 7/10
		const client = fakeClient(g);

		const result = await addExpense(client, { item: "早餐", amount: 80, currency: "TWD", month: 9, date: "7/3" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// after 電話費 (7/1, row 6), before 晚餐 (7/10, row 7)
		expect(requests[0]).toEqual({
			insertDimension: {
				range: { sheetId: 111, dimension: "ROWS", startIndex: 6, endIndex: 7 },
				inheritFromBefore: true,
			},
		});
		expect(requests[1].updateCells.start).toEqual({ sheetId: 111, rowIndex: 6, columnIndex: 1 });
		expect(requests.some((r: any) => r.moveDimension)).toBe(false);
		expect(result).toMatchObject({ row: 7, inserted: true });
	});

	it("moves a latest-dated expense below the shifted last row when the window is full", async () => {
		const g = monthGrid();
		g[8] = [dateSerial(2026, 9, 3), "已有", "吃喝", "", 120, "TWD"];
		g[9] = [dateSerial(2026, 9, 5), "最後", "吃喝", "", 90, "TWD"];
		const client = fakeClient(g);

		const result = await addExpense(client, { item: "宵夜", amount: 60, currency: "TWD", month: 9, date: "9/6" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].insertDimension.range).toEqual({ sheetId: 111, dimension: "ROWS", startIndex: 9, endIndex: 10 });
		expect(requests.at(-1)).toEqual({
			moveDimension: {
				source: { sheetId: 111, dimension: "ROWS", startIndex: 9, endIndex: 10 },
				destinationIndex: 11,
			},
		});
		expect(result).toMatchObject({ row: 11, inserted: true });
	});

	it("never inserts above the 上月透支 carry rows for a backdated expense", async () => {
		const client = fakeClient(currentMonthGrid());

		const result = await addExpense(client, { item: "補記", amount: 10, currency: "TWD", month: 9, date: "6/15" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// nothing dated <= 6/15 — clamped to right below the carry rows (3-4)
		expect(requests[0].insertDimension.range).toEqual({ sheetId: 111, dimension: "ROWS", startIndex: 4, endIndex: 5 });
		expect(result).toMatchObject({ row: 5, inserted: true });
	});

	it("reuses an empty row when it sits exactly at the sorted position", async () => {
		const g = currentMonthGrid(); // 電話費 dated 7/1 at row 6; rows 7-10 empty
		const client = fakeClient(g);

		const result = await addExpense(client, { item: "晚餐", amount: 250, currency: "TWD", month: 9, date: "7/5" });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests.some((r: any) => r.insertDimension)).toBe(false);
		expect(requests[0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 6, columnIndex: 1 });
		expect(result).toMatchObject({ row: 7, inserted: false });
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
			{},
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

	it("inserts inside the SUM window even when it ends above the total row, then moves below the last row (dateless sorts last)", async () => {
		const g = monthGrid();
		g[10] = ["", "", "", "花費總額", "=SUM(E3:E8)"];
		const client = fakeClient(g);

		const result = await addExpense(client, { item: "gap", amount: 9, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// window (rows 3-8) is entirely full — including 近鐵 dated 9/1 at row 8 —
		// so insert at row 8 to auto-extend the SUM, then move below the shifted 近鐵.
		expect(requests[0].insertDimension.range).toEqual({
			sheetId: 111,
			dimension: "ROWS",
			startIndex: 7,
			endIndex: 8,
		});
		expect(requests[1].updateCells.start).toEqual({ sheetId: 111, rowIndex: 7, columnIndex: 1 });
		expect(requests.at(-1)).toEqual({
			moveDimension: {
				source: { sheetId: 111, dimension: "ROWS", startIndex: 7, endIndex: 8 },
				destinationIndex: 9,
			},
		});
		expect(result).toMatchObject({ row: 9, inserted: true });
	});

	it("rejects a TWD-priced expense paid in USD before reading or writing anything", async () => {
		const client = fakeClient(monthGrid());
		await expect(
			addExpense(client, { item: "x", amount: 1, currency: "TWD", month: 9, paidWith: "USD" }),
		).rejects.toThrow("not representable");
		expect((client.readRange as any).mock.calls.length).toBe(0);
		expect((client.batchUpdate as any).mock.calls.length).toBe(0);
	});

	it("writes the card into 支付方式 (G) and defaults 支付幣別 to the card's billing currency", async () => {
		const client = fakeClient(monthGrid());
		await addExpense(client, { item: "Kindle 書", amount: 12.99, currency: "USD", month: 9, card: "CHASE Amazon" });
		const write = ((client.batchUpdate as any).mock.calls[0][0]).find((r: any) => r.updateCells);
		// B..G = item, 類別, 美金, 新臺幣, 支付幣別, 支付方式
		expect(write.updateCells.rows[0].values).toHaveLength(6);
		expect(write.updateCells.rows[0].values[4]).toEqual({ userEnteredValue: { stringValue: "USD" } });
		expect(write.updateCells.rows[0].values[5]).toEqual({ userEnteredValue: { stringValue: "CHASE Amazon" } });
	});

	it("a USD-priced expense on the TWD-billed 國泰 CUBE pays from the TWD account by default", async () => {
		const client = fakeClient(monthGrid());
		const result = await addExpense(client, { item: "Steam 遊戲", amount: 20, currency: "USD", month: 9, card: "國泰 CUBE" });
		expect(result.paidWith).toBe("TWD");
		const write = ((client.batchUpdate as any).mock.calls[0][0]).find((r: any) => r.updateCells);
		expect(write.updateCells.rows[0].values[4]).toEqual({ userEnteredValue: { stringValue: "TWD" } });
		expect(write.updateCells.rows[0].values[5]).toEqual({ userEnteredValue: { stringValue: "國泰 CUBE" } });
	});

	it("rejects an unknown card before any read or write", async () => {
		const client = fakeClient(monthGrid());
		await expect(
			addExpense(client, { item: "x", amount: 1, currency: "TWD", month: 9, card: "玉山 Ubear" }),
		).rejects.toThrow("國泰 CUBE"); // the error lists the valid names
		expect((client.readRange as any).mock.calls.length).toBe(0);
	});

	it("rejects a TWD-priced row on a USD-billed card (its 對帳區 pulls column D, blank on TWD rows)", async () => {
		const client = fakeClient(monthGrid());
		await expect(
			addExpense(client, { item: "x", amount: 100, currency: "TWD", month: 9, card: "Apple Card" }),
		).rejects.toThrow("USD");
		expect((client.readRange as any).mock.calls.length).toBe(0);
	});

	it("writes a blank 支付方式 when card is omitted", async () => {
		const client = fakeClient(monthGrid());
		await addExpense(client, { item: "咖啡", amount: 55, currency: "TWD", month: 9 });
		const write = ((client.batchUpdate as any).mock.calls[0][0]).find((r: any) => r.updateCells);
		expect(write.updateCells.rows[0].values[5]).toEqual({}); // cellData(null)
	});

	it("accepts 現金: writes it to 支付方式, keeps 支付幣別 = currency, and never runs the bucket guard", async () => {
		const client = fakeClient(creditGrid());
		const result = await addExpense(client, { item: "剪頭髮", amount: 810, currency: "TWD", month: 9, date: "7/5", card: "現金" });
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		const write = requests.find((r: any) => r.updateCells && r.updateCells.start.columnIndex === 1);
		expect(write.updateCells.rows[0].values[4]).toEqual({ userEnteredValue: { stringValue: "TWD" } });
		expect(write.updateCells.rows[0].values[5]).toEqual({ userEnteredValue: { stringValue: "現金" } });
		// dated 現金 rows have no 對帳區 bucket — no guard, no warning
		expect(requests.some((r: any) => r.insertDimension)).toBe(false);
		expect(result.bucket).toBeNull();
		expect(result.bucketWarning).toBeUndefined();
	});

	it("accepts 沛, and a USD-priced 現金 row skips the USD-billing restriction", async () => {
		const client = fakeClient(monthGrid());
		await addExpense(client, { item: "生魚片丼飯", amount: 235, currency: "TWD", month: 9, card: "沛" });
		await addExpense(client, { item: "ECSI Loan", amount: 148.5, currency: "USD", month: 9, card: "現金" });
		const writes = (client.batchUpdate as any).mock.calls.map((c: any) => c[0].find((r: any) => r.updateCells));
		expect(writes[0].updateCells.rows[0].values[5]).toEqual({ userEnteredValue: { stringValue: "沛" } });
		expect(writes[1].updateCells.rows[0].values[5]).toEqual({ userEnteredValue: { stringValue: "現金" } });
	});

	describe("bucket room guard", () => {
		it("reports the bucket with no growth needed when the mirror has room", async () => {
			const client = fakeClient(creditGrid());
			const result = await addExpense(client, {
				item: "Netflix",
				amount: 390,
				currency: "TWD",
				month: 9,
				date: "7/10",
				card: "國泰 CUBE",
			});
			const requests = (client.batchUpdate as any).mock.calls[0][0];
			expect(requests.some((r: any) => r.insertDimension)).toBe(false);
			expect(result).toMatchObject({ bucket: "結帳日前", bucketRowsAdded: 0 });
			expect(result.bucketWarning).toBeUndefined();
		});

		it("grows the bucket when the pending row overflows the mirror's spill area", async () => {
			const g = creditGrid();
			g[4] = [dateSerial(2026, 7, 10), "既有1", "訂閱", "", 100, "TWD", "國泰 Cube"];
			g[5] = [dateSerial(2026, 7, 10), "既有2", "訂閱", "", 100, "TWD", "國泰 Cube"];
			const client = fakeClient(g);
			const result = await addExpense(client, {
				item: "Netflix",
				amount: 390,
				currency: "TWD",
				month: 9,
				date: "7/10",
				card: "國泰 CUBE",
			});
			const requests = (client.batchUpdate as any).mock.calls[0][0];
			const insert = requests.find((r: any) => r.insertDimension);
			expect(insert.insertDimension).toEqual({
				range: { sheetId: 111, dimension: "ROWS", startIndex: 48, endIndex: 49 },
				inheritFromBefore: true,
			});
			expect(result).toMatchObject({ bucket: "結帳日前", bucketRowsAdded: 1 });
		});

		it("shifts the bucket-room insert by the write's own row insert when the expense window is full", async () => {
			const g = creditGrid();
			g[4] = [dateSerial(2026, 7, 10), "既有1", "訂閱", "", 100, "TWD", "國泰 Cube"];
			g[5] = [dateSerial(2026, 7, 10), "既有2", "訂閱", "", 100, "TWD", "國泰 Cube"];
			g[6] = ["", "filler1", "雜", "", 1];
			g[7] = ["", "filler2", "雜", "", 1];
			g[8] = ["", "filler3", "雜", "", 1];
			g[9] = ["", "filler4", "雜", "", 1];
			const client = fakeClient(g);
			const result = await addExpense(client, {
				item: "Netflix",
				amount: 390,
				currency: "TWD",
				month: 9,
				date: "7/10",
				card: "國泰 CUBE",
			});
			expect(result.inserted).toBe(true);
			const requests = (client.batchUpdate as any).mock.calls[0][0];
			const bucketInsert = requests.find((r: any) => r.insertDimension && r.insertDimension.range.startIndex === 49);
			expect(bucketInsert.insertDimension).toEqual({
				range: { sheetId: 111, dimension: "ROWS", startIndex: 49, endIndex: 50 },
				inheritFromBefore: true,
			});
			expect(result).toMatchObject({ bucketRowsAdded: 1 });
		});

		it("counts matching 午餐預算 rows toward the TWD-billed card's bucket", async () => {
			const g = creditGrid();
			g[4] = [dateSerial(2026, 7, 10), "既有1", "訂閱", "", 100, "TWD", "國泰 Cube"];
			(g[36] ??= [])[15] = dateSerial(2026, 7, 10);
			(g[36] as unknown[])[16] = "中餐";
			(g[36] as unknown[])[17] = 120;
			(g[36] as unknown[])[18] = "國泰 Cube";
			const client = fakeClient(g);
			const result = await addExpense(client, {
				item: "Netflix",
				amount: 390,
				currency: "TWD",
				month: 9,
				date: "7/10",
				card: "國泰 CUBE",
			});
			const requests = (client.batchUpdate as any).mock.calls[0][0];
			expect(requests.some((r: any) => r.insertDimension)).toBe(true);
			expect(result).toMatchObject({ bucketRowsAdded: 1 });
		});

		it("routes a post-close-date entry into 結帳日後 and grows it on overflow", async () => {
			const g = creditGrid();
			g[4] = [dateSerial(2026, 7, 25), "既有1", "訂閱", "", 100, "TWD", "國泰 Cube"];
			g[5] = [dateSerial(2026, 7, 25), "既有2", "訂閱", "", 100, "TWD", "國泰 Cube"];
			const client = fakeClient(g);
			const result = await addExpense(client, {
				item: "Netflix",
				amount: 390,
				currency: "TWD",
				month: 9,
				date: "7/25",
				card: "國泰 CUBE",
			});
			const requests = (client.batchUpdate as any).mock.calls[0][0];
			const insert = requests.find((r: any) => r.insertDimension);
			expect(insert.insertDimension).toEqual({
				range: { sheetId: 111, dimension: "ROWS", startIndex: 54, endIndex: 55 },
				inheritFromBefore: true,
			});
			expect(result).toMatchObject({ bucket: "結帳日後", bucketRowsAdded: 1 });
		});

		it("places an entry dated exactly ON the 結帳日 into 結帳日後 — it belongs to the next statement", async () => {
			const client = fakeClient(creditGrid());
			const result = await addExpense(client, {
				item: "Netflix",
				amount: 390,
				currency: "TWD",
				month: 9,
				date: "7/19", // the fixture's 國泰 CUBE 結帳日
				card: "國泰 CUBE",
			});
			expect(result).toMatchObject({ bucket: "結帳日後" });
		});

		it("never counts 午餐預算 rows for a USD-billed card", async () => {
			const g = creditGrid();
			g[4] = [dateSerial(2026, 7, 1), "既有", "訂閱", 5, "", "USD", "CHASE Amazon"];
			(g[36] ??= [])[15] = dateSerial(2026, 7, 1);
			(g[36] as unknown[])[16] = "中餐";
			(g[36] as unknown[])[17] = 120;
			(g[36] as unknown[])[18] = "CHASE Amazon";
			const client = fakeClient(g);
			const result = await addExpense(client, {
				item: "Kindle",
				amount: 9.99,
				currency: "USD",
				month: 9,
				date: "7/1",
				card: "CHASE Amazon",
			});
			const requests = (client.batchUpdate as any).mock.calls[0][0];
			expect(requests.some((r: any) => r.insertDimension)).toBe(false);
			expect(result).toMatchObject({ bucket: "結帳日前", bucketRowsAdded: 0 });
		});

		it("skips the guard for a dateless card row", async () => {
			const client = fakeClient(creditGrid());
			const result = await addExpense(client, {
				item: "Netflix",
				amount: 390,
				currency: "TWD",
				month: 9,
				card: "國泰 CUBE",
			});
			const requests = (client.batchUpdate as any).mock.calls[0][0];
			expect(requests.some((r: any) => r.insertDimension)).toBe(false);
			expect(result.bucket).toBeNull();
			expect(result.bucketRowsAdded).toBe(0);
			expect(result.bucketWarning).toBeUndefined();
		});

		it("writes the expense even when the tab has no 信用卡帳單對帳區 (pre-section tabs)", async () => {
			const client = fakeClient(lunchGrid());
			const result = await addExpense(client, {
				item: "Netflix",
				amount: 390,
				currency: "TWD",
				month: 9,
				date: "7/10",
				card: "國泰 CUBE",
			});
			expect((client.batchUpdate as any).mock.calls).toHaveLength(1);
			expect(result.bucket).toBeNull();
			expect(result.bucketWarning).toBeUndefined();
		});

		it("writes the expense and surfaces a warning when the credit section is torn", async () => {
			const g = creditGrid();
			(g[43] as unknown[])[7] = ""; // CUBE loses its 本月需繳款 label -> findCreditSection throws
			const client = fakeClient(g);
			const result = await addExpense(client, {
				item: "Netflix",
				amount: 390,
				currency: "TWD",
				month: 9,
				date: "7/10",
				card: "國泰 CUBE",
			});
			expect((client.batchUpdate as any).mock.calls).toHaveLength(1);
			expect(result.bucketWarning).toBeDefined();
			expect(result.bucket).toBeNull();
		});
	});
});

describe("setExpenseDate", () => {
	/** creditGrid() with a controlled dateless "Netflix" row at row 7 (idx 6), G blank. */
	function dateGrid(): unknown[][] {
		const g = creditGrid();
		g[6] = ["", "Netflix", "訂閱", "", 390, "TWD", ""];
		return g;
	}

	it("dates a dateless row and returns previousDate null", async () => {
		const client = fakeClient(dateGrid());
		const result = await setExpenseDate(client, { item: "Netflix", date: "7/10", month: 9 });

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:S160", "FORMULA"]);
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0]).toEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 6, columnIndex: 0 },
				rows: [
					{
						values: [
							{
								userEnteredValue: { numberValue: dateSerial(2026, 7, 10) },
								userEnteredFormat: { numberFormat: { type: "DATE", pattern: "mm/dd" } },
							},
						],
					},
				],
				fields: "userEnteredValue,userEnteredFormat.numberFormat",
			},
		});
		expect(result).toMatchObject({
			tab: "9 月",
			row: 7,
			item: "Netflix",
			date: "2026-07-10",
			previousDate: null,
			card: null,
			bucket: null,
			bucketRowsAdded: 0,
		});
	});

	it("changes an existing date and returns the previous ISO date", async () => {
		const g = dateGrid();
		(g[6] as unknown[])[0] = dateSerial(2026, 7, 1);
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/15", month: 9 });

		expect(result.previousDate).toBe("2026-07-01");
		expect(result.date).toBe("2026-07-15");
		expect(result.row).toBe(7);
	});

	it("prefers the single dateless row among duplicate 項目 names", async () => {
		const g = dateGrid();
		g[7] = [dateSerial(2026, 7, 3), "Netflix", "訂閱", "", 390, "TWD", ""]; // row 8, dated duplicate
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/20", month: 9 });

		expect(result.row).toBe(7);
	});

	it("throws listing the rows when every duplicate 項目 already has a date", async () => {
		const g = dateGrid();
		(g[6] as unknown[])[0] = dateSerial(2026, 7, 1);
		g[7] = [dateSerial(2026, 7, 3), "Netflix", "訂閱", "", 390, "TWD", ""];
		const client = fakeClient(g);

		await expect(setExpenseDate(client, { item: "Netflix", date: "7/20", month: 9 })).rejects.toThrow(
			/Multiple "Netflix" rows match \(rows 7, 8\)/,
		);
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("lets the row param disambiguate explicitly", async () => {
		const g = dateGrid();
		(g[6] as unknown[])[0] = dateSerial(2026, 7, 1);
		g[7] = [dateSerial(2026, 7, 3), "Netflix", "訂閱", "", 390, "TWD", ""];
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/20", month: 9, row: 8 });

		expect(result.row).toBe(8);
	});

	it("throws when row does not match the item", async () => {
		const client = fakeClient(dateGrid());
		await expect(setExpenseDate(client, { item: "Netflix", date: "7/20", month: 9, row: 5 })).rejects.toThrow(
			/Row 5 is not one of the "Netflix" rows/,
		);
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("throws naming the tab when the item is missing", async () => {
		const client = fakeClient(dateGrid());
		await expect(setExpenseDate(client, { item: "不存在", date: "7/20", month: 9 })).rejects.toThrow(
			/No "不存在" row inside the expense window of 9 月/,
		);
	});

	it("runs the bucket guard when the row's 支付方式 holds a known card", async () => {
		const g = dateGrid();
		(g[6] as unknown[])[6] = "國泰 CUBE";
		g[4] = [dateSerial(2026, 7, 12), "既有1", "訂閱", "", 100, "TWD", "國泰 Cube"];
		g[5] = [dateSerial(2026, 7, 12), "既有2", "訂閱", "", 100, "TWD", "國泰 Cube"];
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/10", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		const insert = requests.find((r: any) => r.insertDimension);
		expect(insert).toBeDefined();
		// Composed in one batch: the bucket-guard insert lands before the
		// trailing moveDimension that relocates the now-dated row — both
		// rows above it (既有1 dated 7/12, 既有2 dated 7/12) postdate 7/10,
		// so Netflix (row 7) sorts in right after the carry rows.
		expect(requests.at(-1)).toEqual({
			moveDimension: {
				source: { sheetId: 111, dimension: "ROWS", startIndex: 6, endIndex: 7 },
				destinationIndex: 4,
			},
		});
		expect(requests.indexOf(insert)).toBeLessThan(requests.length - 1);
		expect(result).toMatchObject({ card: "國泰 CUBE", bucket: "結帳日前", bucketRowsAdded: 1, movedToRow: 5 });
	});

	it("excludes the row being re-dated from its own bucket scan (no double count)", async () => {
		const g = dateGrid();
		g[6] = [dateSerial(2026, 7, 1), "Netflix", "訂閱", "", 390, "TWD", "國泰 CUBE"]; // row 7, already dated pre-bucket
		g[4] = [dateSerial(2026, 7, 12), "既有1", "訂閱", "", 100, "TWD", "國泰 Cube"]; // row 5, the only other dated CUBE row
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/15", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests.some((r: any) => r.insertDimension)).toBe(false);
		expect(result).toMatchObject({ bucket: "結帳日前", bucketRowsAdded: 0 });
	});

	it("warns and skips the guard when 支付方式 holds an unknown value", async () => {
		const g = dateGrid();
		(g[6] as unknown[])[6] = "玉山 Ubear";
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/10", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests.some((r: any) => r.insertDimension)).toBe(false);
		expect(result.bucketWarning).toMatch(/玉山 Ubear/);
		expect(result.bucket).toBeNull();
	});

	it("leaves bucket null when 支付方式 is empty", async () => {
		const client = fakeClient(dateGrid());
		const result = await setExpenseDate(client, { item: "Netflix", date: "7/10", month: 9 });
		expect(result.card).toBeNull();
		expect(result.bucket).toBeNull();
		expect(result.bucketWarning).toBeUndefined();
	});

	it("dates a 現金 row without warning — a non-card 支付方式 has no bucket to guard", async () => {
		const g = dateGrid();
		(g[6] as unknown[])[6] = "現金";
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/10", month: 9 });

		expect(result.card).toBe("現金");
		expect(result.bucket).toBeNull();
		expect(result.bucketWarning).toBeUndefined();
	});

	it("rejects a bad date before any read or write", async () => {
		const client = fakeClient(dateGrid());
		await expect(setExpenseDate(client, { item: "Netflix", date: "not-a-date", month: 9 })).rejects.toThrow(
			"Unrecognized date",
		);
		expect((client.readRange as any).mock.calls).toHaveLength(0);
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("moves the row down to its date-sorted position after dating it", async () => {
		const g = dateGrid();
		g[7] = [dateSerial(2026, 7, 3), "後面", "吃喝", "", 120, "TWD", ""]; // row 8 dated 7/3
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/10", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests.at(-1)).toEqual({
			moveDimension: {
				source: { sheetId: 111, dimension: "ROWS", startIndex: 6, endIndex: 7 },
				destinationIndex: 8, // before original row 9; lands at row 8 after its slot closes
			},
		});
		expect(result).toMatchObject({ row: 7, movedToRow: 8 });
	});

	it("moves the row up when the new date predates every dated row", async () => {
		const g = dateGrid();
		(g[5] as unknown[])[0] = dateSerial(2026, 7, 8); // 電話費 now dated 7/8
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/2", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests.at(-1)).toEqual({
			moveDimension: {
				source: { sheetId: 111, dimension: "ROWS", startIndex: 6, endIndex: 7 },
				destinationIndex: 4, // right below the carry rows
			},
		});
		expect(result).toMatchObject({ movedToRow: 5 });
	});

	it("does not move a row already in its sorted position", async () => {
		const client = fakeClient(dateGrid());
		const result = await setExpenseDate(client, { item: "Netflix", date: "7/10", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests.some((r: any) => r.moveDimension)).toBe(false);
		expect(result.movedToRow).toBeNull();
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

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:S160", "UNFORMATTED_VALUE"]);
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

describe("adjustBalance", () => {
	/** adjustedBalanceGrid with literal numbers in the 本月底…真實餘額 cells (the op reads an UNFORMATTED render). */
	function gridWithNumbers(): unknown[][] {
		const g = adjustedBalanceGrid();
		(g[37] as unknown[])[3] = 500; // 本月底新臺幣真實餘額 (row 38)
		(g[42] as unknown[])[3] = 120.5; // 本月底美金真實餘額 (row 43)
		return g;
	}

	it("writes actual − calculated into the currency's 調整 cell", async () => {
		const client = fakeClient(gridWithNumbers());

		const result = await adjustBalance(client, { currency: "TWD", actual: 450, month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toEqual([
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 43, columnIndex: 3 }, // 新臺幣餘額調整 (row 44)
					rows: [{ values: [{ userEnteredValue: { numberValue: -50 } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(result).toMatchObject({
			tab: "9 月",
			currency: "TWD",
			calculated: 500,
			actual: 450,
			adjustment: -50,
			previousAdjustment: 0,
		});
	});

	it("targets the USD 調整 cell and rounds the delta to cents", async () => {
		const client = fakeClient(gridWithNumbers());

		const result = await adjustBalance(client, { currency: "USD", actual: 100.204, month: 9 });

		expect(result.adjustment).toBe(-20.3); // 100.204 − 120.5 = −20.296 → 2dp
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 45, columnIndex: 3 }); // 美金餘額調整 (row 46)
	});

	it("overwrites a previous adjustment — the delta is against the RAW 本月底, not the 調整後 value", async () => {
		const g = gridWithNumbers();
		(g[43] as unknown[])[3] = -37; // an earlier NTD 調整
		const client = fakeClient(g);

		const result = await adjustBalance(client, { currency: "TWD", actual: 450, month: 9 });

		expect(result).toMatchObject({ adjustment: -50, previousAdjustment: -37 });
	});

	it("throws when the tab predates the 調整 rows, before writing", async () => {
		const client = fakeClient(realBalanceGrid());
		await expect(adjustBalance(client, { currency: "TWD", actual: 450, month: 9 })).rejects.toThrow("新臺幣餘額調整");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("throws when the calculated 本月底 cell is not a number", async () => {
		// adjustedBalanceGrid leaves the end cells as formula strings — a broken render.
		const client = fakeClient(adjustedBalanceGrid());
		await expect(adjustBalance(client, { currency: "TWD", actual: 450, month: 9 })).rejects.toThrow("本月底新臺幣真實餘額");
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
		// 近鐵 80000系 (row 8) is the only non-recurring item in the fixture
		// Scoped to A–G: the 乾坤大挪移 / 中餐預算 sections share these sheet rows.
		expect(requests[3]).toEqual({
			deleteRange: {
				range: { sheetId: 555, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 0, endColumnIndex: 7 },
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
			creditRebuilt: [],
		});
	});

	it("throws when the previous month tab still has the pre-支付方式 geometry (乾坤大挪移 at G-M)", async () => {
		const g = currentMonthGrid();
		(g[32] ??= [])[6] = "乾坤大挪移"; // old position: column G (index 6), one left of the current H anchor
		const client = startMonthClient(g, ["9 月", "8 月"]);

		await expect(startMonth(client, 10)).rejects.toThrow(/乾坤大挪移|支付方式/);

		// duplicateSheet already ran (it's the first batchUpdate call) but the guard
		// must fire before any further request is issued.
		expect((client.batchUpdate as any).mock.calls.length).toBe(1);
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

	it("skips the 銀行餘額 chaining on tabs that predate the block", async () => {
		const client = startMonthClient(monthGrid(), ["9 月", "8 月"]);

		await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		// No 本月初新臺幣餘額 row to rewire → nothing writes into the budget-value column (D).
		const carryWrites = requests.filter(
			(r: any) => r.updateCells && r.updateCells.start.columnIndex === MONTH_COLS.budgetValue,
		);
		expect(carryWrites).toEqual([]);
	});

	it("clears ad-hoc income rows but keeps 沛還/薪水 and the 項目 header, chaining 本月初新臺幣餘額 to 本月底新臺幣餘額", async () => {
		const client = startMonthClient(currentMonthGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		// column D writes: the USD carry (row 3) and the NTD ledger chain —
		// 本月初新臺幣餘額 (row 30) ← 9 月's 本月底新臺幣餘額 (row 32).
		const columnDWrites = requests.filter(
			(r: any) => r.updateCells && r.updateCells.start.columnIndex === MONTH_COLS.budgetValue,
		);
		expect(columnDWrites).toEqual([
			{
				updateCells: {
					start: { sheetId: 555, rowIndex: 2, columnIndex: 3 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=IF(-('9 月'!D19) > 0, -('9 月'!D19), 0)" } }] }],
					fields: "userEnteredValue",
				},
			},
			{
				updateCells: {
					start: { sheetId: 555, rowIndex: 29, columnIndex: 3 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "='9 月'!D32" } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
		// 本月初美金餘額 (row 25) is never rewired — it stays the duplicated 0.
		expect(columnDWrites.some((r: any) => r.updateCells.start.rowIndex === 24)).toBe(false);
		// 多一個月薪水 (row 17) is the only ad-hoc income; the 項目/幣別/金額
		// header (row 14) and the recurring rows survive.
		const deletes = requests.filter((r: any) => r.deleteRange);
		expect(deletes).toEqual([
			{
				deleteRange: {
					range: { sheetId: 555, startRowIndex: 16, endRowIndex: 17, startColumnIndex: 0, endColumnIndex: 7 },
					shiftDimension: "ROWS",
				},
			},
		]);
		expect(result.cleared).toEqual([]);
		expect(result.clearedIncomes).toEqual(["多一個月薪水"]);
	});

	it("clears the 午餐預算 data rows so the new month starts empty", async () => {
		const client = startMonthClient(lunchGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		expect((client.readRange as any).mock.calls[0]).toEqual(["'10 月'!A1:S160", "FORMULA"]);
		const requests = (client.batchUpdate as any).mock.calls[1][0];
		// data rows 37..37 (0-indexed 36..37), columns P–S (15..19) — cells cleared, nothing shifts
		const clear = requests.find((r: any) => r.repeatCell && r.repeatCell.range.startColumnIndex === 15);
		expect(clear).toEqual({
			repeatCell: {
				range: { sheetId: 555, startRowIndex: 36, endRowIndex: 37, startColumnIndex: 15, endColumnIndex: 19 },
				cell: {},
				fields: "userEnteredValue",
			},
		});
		expect(result.lunchCleared).toBe(true);
	});

	it("skips the lunch clear and surfaces a warning instead of throwing when the section is torn", async () => {
		const g = lunchGrid();
		(g[35] as unknown[])[15] = ""; // no 日期 header within 8 rows of the anchor
		const client = startMonthClient(g, ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		expect(result.lunchCleared).toBe(false);
		expect(result.lunchWarning).toMatch(/日期|午餐預算/);
	});

	it("chains both 帳戶實際數字對應 seeds to the previous month's 真實餘額 cells", async () => {
		const client = startMonthClient(realBalanceGrid(), ["9 月", "8 月"]);

		await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		const seedAt = (rowIndex: number) =>
			requests.find(
				(r: any) =>
					r.updateCells && r.updateCells.start.rowIndex === rowIndex && r.updateCells.start.columnIndex === MONTH_COLS.budgetValue,
			);
		// 本月初新臺幣真實餘額 (row 35) ← 9 月's 本月底新臺幣真實餘額 (row 38).
		expect(seedAt(34).updateCells.rows[0].values).toEqual([{ userEnteredValue: { formulaValue: "='9 月'!D38" } }]);
		// 本月初美金真實餘額 (row 40) ← 9 月's 本月底美金真實餘額 (row 43) —
		// unlike the 銀行餘額 ledger, the USD side chains here too.
		expect(seedAt(39).updateCells.rows[0].values).toEqual([{ userEnteredValue: { formulaValue: "='9 月'!D43" } }]);
	});

	it("chains every 本月初 cell to the 調整後 rows and zeroes the duplicated 調整 cells", async () => {
		const client = startMonthClient(adjustedBalanceGrid(), ["9 月", "8 月"]);

		await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		const at = (rowIndex: number) =>
			requests.find(
				(r: any) =>
					r.updateCells && r.updateCells.start.rowIndex === rowIndex && r.updateCells.start.columnIndex === MONTH_COLS.budgetValue,
			);
		// 銀行餘額: 本月初美金餘額 (row 25) chains now — no more hardcoded 0.
		expect(at(24).updateCells.rows[0].values).toEqual([{ userEnteredValue: { formulaValue: "='9 月'!D49" } }]);
		// 本月初新臺幣餘額 (row 30) ← 調整後的本月底新臺幣餘額 (row 48), not the raw row 32.
		expect(at(29).updateCells.rows[0].values).toEqual([{ userEnteredValue: { formulaValue: "='9 月'!D48" } }]);
		// 真實餘額 chains prefer the 調整後 rows (45 / 47) over the raw ends (38 / 43).
		expect(at(34).updateCells.rows[0].values).toEqual([{ userEnteredValue: { formulaValue: "='9 月'!D45" } }]);
		expect(at(39).updateCells.rows[0].values).toEqual([{ userEnteredValue: { formulaValue: "='9 月'!D47" } }]);
		// The duplicate carries last month's 調整 — reset both cells (rows 44 / 46) to 0.
		expect(at(43).updateCells.rows[0].values).toEqual([{ userEnteredValue: { numberValue: 0 } }]);
		expect(at(45).updateCells.rows[0].values).toEqual([{ userEnteredValue: { numberValue: 0 } }]);
	});

	it("leaves 本月初美金餘額 untouched on tabs without the 調整 rows (legacy 透支-carry design)", async () => {
		const client = startMonthClient(realBalanceGrid(), ["9 月", "8 月"]);

		await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		// 本月初美金餘額 is row 25 (rowIndex 24) — no chain write without a 調整後 target.
		expect(
			requests.some((r: any) => r.updateCells?.start.rowIndex === 24 && r.updateCells.start.columnIndex === MONTH_COLS.budgetValue),
		).toBe(false);
	});

	it("skips a 真實餘額 chain whose 本月底 anchor is missing, keeping the other currency's", async () => {
		const g = realBalanceGrid();
		(g[42] as unknown[])[1] = ""; // tear off the USD 本月底美金真實餘額 anchor
		const client = startMonthClient(g, ["9 月", "8 月"]);

		await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		const seedAt = (rowIndex: number) =>
			requests.find(
				(r: any) =>
					r.updateCells && r.updateCells.start.rowIndex === rowIndex && r.updateCells.start.columnIndex === MONTH_COLS.budgetValue,
			);
		expect(seedAt(34)).toBeDefined();
		expect(seedAt(39)).toBeUndefined();
	});

	it("bumps each card's 結帳日/繳款日 one month and rewires 本月需繳款 across two months per statementLag", async () => {
		const client = startMonthClient(creditGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		const at = (rowIndex: number, columnIndex: number) =>
			requests.find(
				(r: any) => r.updateCells && r.updateCells.start.rowIndex === rowIndex && r.updateCells.start.columnIndex === columnIndex,
			);
		// 國泰 CUBE (values in J = column 9): dates bumped 7/19→8/19, 7/6→8/6.
		expect(at(41, 9).updateCells.rows[0].values).toEqual([{ userEnteredValue: { numberValue: dateSerial(2026, 8, 19) } }]);
		expect(at(42, 9).updateCells.rows[0].values).toEqual([{ userEnteredValue: { numberValue: dateSerial(2026, 8, 6) } }]);
		// lag 1: 本月需繳款 = prev tab's 結帳日前小計 (J49) + prev-prev tab's 結帳日後小計 (J55).
		expect(at(43, 9).updateCells.rows[0].values).toEqual([{ userEnteredValue: { formulaValue: "='9 月'!J49+'8 月'!J55" } }]);
		// CHASE Amazon (values in N = column 13), lag 0: 本月需繳款 = this tab's 結帳日前小計 (N49) + prev tab's 結帳日後小計 (N55).
		expect(at(43, 13).updateCells.rows[0].values).toEqual([{ userEnteredValue: { formulaValue: "=N49+'9 月'!N55" } }]);
		// No 本期帳單總額 row exists anymore — only the two date bumps plus the single due write per card.
		expect(requests.filter((r: any) => r.updateCells && r.updateCells.start.columnIndex === 9)).toHaveLength(3);
		expect(requests.filter((r: any) => r.updateCells && r.updateCells.start.columnIndex === 13)).toHaveLength(3);
		expect(result.creditRebuilt).toEqual(["國泰 CUBE", "CHASE Amazon"]);
		expect(result.creditWarning).toBeUndefined();
	});

	it("omits the prev-prev term when that tab doesn't exist in the spreadsheet", async () => {
		const client = startMonthClient(creditGrid(), ["9 月"]);

		const result = await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		const at = (rowIndex: number, columnIndex: number) =>
			requests.find(
				(r: any) => r.updateCells && r.updateCells.start.rowIndex === rowIndex && r.updateCells.start.columnIndex === columnIndex,
			);
		expect(at(43, 9).updateCells.rows[0].values).toEqual([{ userEnteredValue: { formulaValue: "='9 月'!J49" } }]);
		expect(result.creditRebuilt).toEqual(["國泰 CUBE", "CHASE Amazon"]);
	});

	it("skips the credit rebuild silently on tabs without the section", async () => {
		const client = startMonthClient(lunchGrid(), ["9 月", "8 月"]);
		const result = await startMonth(client, 10);
		expect(result.creditRebuilt).toEqual([]);
		expect(result.creditWarning).toBeUndefined();
	});

	it("surfaces a torn credit block as a warning instead of failing the month-open", async () => {
		const g = creditGrid();
		(g[43] as unknown[])[7] = ""; // CUBE loses 本月需繳款
		const client = startMonthClient(g, ["9 月", "8 月"]);
		const result = await startMonth(client, 10);
		expect(result.creditRebuilt).toEqual([]);
		expect(result.creditWarning).toMatch(/國泰 CUBE.*本月需繳款/);
	});

	it("rebuilds both carry rows against the previous month's 收支狀況 cells", async () => {
		const client = startMonthClient(currentMonthGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		// 上月美金透支 (row 3) D ← the prev month's 本月美金收支狀況 (row 19).
		const usdWrite = requests.find(
			(r: any) => r.updateCells && r.updateCells.start.rowIndex === 2 && r.updateCells.start.columnIndex === 3,
		);
		expect(usdWrite.updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: "=IF(-('9 月'!D19) > 0, -('9 月'!D19), 0)" } },
		]);
		// 上月新臺幣透支 (row 4) E ← 本月新臺幣收支狀況 (row 20).
		const ntdWrite = requests.find(
			(r: any) => r.updateCells && r.updateCells.start.rowIndex === 3 && r.updateCells.start.columnIndex === 4,
		);
		expect(ntdWrite.updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: "=IF(-('9 月'!D20) > 0, -('9 月'!D20), 0)" } },
		]);
		// Both carry rows are recurring — kept, never deleted.
		expect(result.kept).toContain("上月美金透支");
		expect(result.kept).toContain("上月新臺幣透支");
		// the USD row's E conversion formula is row-relative — never rewritten
		expect(
			requests.find((r: any) => r.updateCells && r.updateCells.start.rowIndex === 2 && r.updateCells.start.columnIndex === 4),
		).toBeUndefined();
	});

	it("degenerate split rows over an un-migrated month: USD gets 0, NTD falls back to the 剩餘 anchor", async () => {
		const client = startMonthClient(splitCarryOldLayoutGrid(), ["9 月", "8 月"]);

		await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		const usdWrite = requests.find(
			(r: any) => r.updateCells && r.updateCells.start.rowIndex === 2 && r.updateCells.start.columnIndex === 3,
		);
		expect(usdWrite.updateCells.rows[0].values).toEqual([{ userEnteredValue: { numberValue: 0 } }]);
		const ntdWrite = requests.find(
			(r: any) => r.updateCells && r.updateCells.start.rowIndex === 3 && r.updateCells.start.columnIndex === 4,
		);
		// 剩餘 sits at row 16 after the two carry rows shifted the old grid down one.
		expect(ntdWrite.updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: "=IF(-'9 月'!D16 > 0, -'9 月'!D16, 0)" } },
		]);
	});

	it("re-anchors the legacy TWD carry on a half-converted tab (USD row inserted, old row not yet renamed)", async () => {
		const g = monthGrid();
		g.splice(2, 0, ["", "上月美金透支", "透支", 0, '=D3*GOOGLEFINANCE("CURRENCY:USDTWD")', "USD"]);
		const client = startMonthClient(g, ["9 月", "8 月"]);

		await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		// New USD row (row 3): no 收支狀況 row to anchor on → carry 0.
		const usdWrite = requests.find(
			(r: any) => r.updateCells && r.updateCells.start.rowIndex === 2 && r.updateCells.start.columnIndex === 3,
		);
		expect(usdWrite.updateCells.rows[0].values).toEqual([{ userEnteredValue: { numberValue: 0 } }]);
		// Legacy 上月透支 row (shifted to row 4) is re-anchored to 剩餘 (shifted to row 16), not left pointing two months back.
		const legacyWrite = requests.find(
			(r: any) => r.updateCells && r.updateCells.start.rowIndex === 3 && r.updateCells.start.columnIndex === 4,
		);
		expect(legacyWrite.updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: "=IF(-'9 月'!D16 > 0, -'9 月'!D16, 0)" } },
		]);
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
		const client = fakeClient(currentMonthGrid());

		const result = await setIncome(client, { item: "薪水", amount: 70000, currency: "TWD", month: 9 });

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:H60", "FORMULA"]);
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toEqual([
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 15, columnIndex: 2 },
					rows: [{ values: [{ userEnteredValue: { stringValue: "TWD" } }, { userEnteredValue: { numberValue: 70000 } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(result).toEqual({
			tab: "9 月",
			row: 16,
			action: "updated",
			item: "薪水",
			amount: 70000,
			currency: "TWD",
			previous: { currency: "TWD", amount: "68587" },
		});
	});

	it("inserts a new ad-hoc income row inside the SUMIF window so the SUMIFs auto-extend", async () => {
		const client = fakeClient(currentMonthGrid());

		const result = await setIncome(client, { item: "股息", amount: 120, currency: "USD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// SUMIF window rows 15-17 are all occupied → insert at the window's
		// LAST row (17), strictly inside C14:C17 / D14:D17, so every SUMIF
		// extends. The blank gap row 18 sits OUTSIDE the SUMIFs and is never
		// used — a row there would silently not count as income.
		expect(requests).toEqual([
			{
				insertDimension: {
					range: { sheetId: 111, dimension: "ROWS", startIndex: 16, endIndex: 17 },
					inheritFromBefore: true,
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 16, columnIndex: 1 },
					rows: [{ values: [
						{ userEnteredValue: { stringValue: "股息" } },
						{ userEnteredValue: { stringValue: "USD" } },
						{ userEnteredValue: { numberValue: 120 } },
					] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(result).toMatchObject({ row: 17, action: "inserted", previous: null });
	});

	it("reuses an empty row inside the income window before inserting", async () => {
		const g = currentMonthGrid();
		g[16] = ["", "", "", ""]; // row 17 empty (多一個月薪水 removed)
		const client = fakeClient(g);

		const result = await setIncome(client, { item: "獎金", amount: 5000, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toHaveLength(1);
		expect(requests[0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 16, columnIndex: 1 });
		expect(result).toMatchObject({ row: 17, action: "inserted" });
	});

	it("refuses old-layout tabs (6月 2026 and earlier are frozen history)", async () => {
		const client = fakeClient(oldLayoutGrid());

		await expect(setIncome(client, { item: "薪水", amount: 70000, currency: "TWD", month: 9 })).rejects.toThrow(
			"frozen history",
		);
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("rejects layout labels as income items before touching the sheet", async () => {
		const client = fakeClient(currentMonthGrid());
		await expect(setIncome(client, { item: "項目", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		await expect(setIncome(client, { item: "花費總額", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		await expect(setIncome(client, { item: "本月美金收支狀況", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		await expect(setIncome(client, { item: "本月新臺幣餘額", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		await expect(setIncome(client, { item: "本月底新臺幣餘額", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		await expect(setIncome(client, { item: "午餐超支或回補", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		await expect(setIncome(client, { item: "上月美金透支", amount: 1, currency: "USD", month: 9 })).rejects.toThrow("layout label");
		await expect(setIncome(client, { item: "帳戶實際數字對應", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		await expect(setIncome(client, { item: "本月底新臺幣真實餘額", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("layout label");
		await expect(setIncome(client, { item: "本月初美金真實餘額", amount: 1, currency: "USD", month: 9 })).rejects.toThrow("layout label");
		expect((client.readRange as any).mock.calls).toHaveLength(0);
	});

	it("fails with a clear message when the tab has no income list anchors", async () => {
		const client = fakeClient(monthGrid()); // no 總預算 row
		await expect(setIncome(client, { item: "薪水", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("income list");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("refuses to operate on a truncated read", async () => {
		const client = fakeClient(currentMonthGrid());
		(client.readRange as any).mockResolvedValue({ range: "x", values: currentMonthGrid(), truncated: true });
		await expect(setIncome(client, { item: "薪水", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("truncated");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});
});
