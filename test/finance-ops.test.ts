import { describe, expect, it, vi } from "vitest";
import {
	adaptRowFormula,
	addExpense,
	addLunch,
	addTransfer,
	addTripEntry,
	adjustBalance,
	annotateRows,
	auditCreditBuckets,
	cellData,
	colIndex,
	colLetter,
	deleteExpense,
	CREDIT_BUCKET_PAD_ROWS,
	EXPENSE_BAND,
	expandAnchorRange,
	expensePositionFor,
	findBrokenRefs,
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
	findTripBudgetSection,
	FULL_GRID_READ,
	getCategories,
	monthSummary,
	parseColumnBand,
	safeDeleteRows,
	safeUpdateRange,
	setExpenseDate,
	setIncome,
	startMonth,
	TRANSFER_JPY_GRID_READ,
	TRANSFER_SECTIONS,
	TRIP_BUDGET_READ,
	tripBudgetStatus,
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

	it("scans for the header instead of assuming it sits directly under the title", () => {
		const g = transferGrid();
		g.splice(33, 0, [], [], []); // three rows opened between the title and the 日期 header
		expect(findTransferSection(g, "9 月")).toEqual({ headerRow: 37, totalRow: 39 });
	});

	it("stops the 總和 scan at the 信用卡帳單對帳區 below instead of running into it", () => {
		const g = creditGrid(); // the 對帳區 title sits in column H under the transfer log
		g[35] = []; // 總和 gone
		expect(() => findTransferSection(g, "9 月")).toThrow("總和");
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
		const s = findTransferSection(jpyTransferGrid(), "2026/07/25 京都東京", TRANSFER_SECTIONS.jpy);
		expect(s).toEqual({ headerRow: 70, totalRow: 72 });
	});

	it("throws the trip-tab hint when the section is missing", () => {
		expect(() => findTransferSection([[]], "2026/07/25 京都東京", TRANSFER_SECTIONS.jpy)).toThrow(
			/乾坤大挪移.*trip tab/,
		);
	});

	it("still finds the month-tab USD section by default", () => {
		const s = findTransferSection(transferGrid(), "9 月");
		expect(s).toEqual({ headerRow: 34, totalRow: 36 });
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

/**
 * How tall a card block is depends entirely on how far its two mirrors have
 * spilled, so the 對帳區 fixtures are BUILT from a spec instead of written out
 * at fixed rows: every test that needs a different spill length asks for one
 * and gets back the rows the builder actually used. Nothing in the test file
 * hard-codes where a 小計 lands, so a changed spill length can never turn into
 * a stale expectation.
 */
interface CardBlockSpec {
	name: string;
	/** 0-indexed band column: 7 (H–J) or 11 (L–N). */
	col: number;
	close: number;
	pay: number;
	due?: number | string;
	/** Rows the 結帳日前 mirror can spill into (header → 小計 gap). */
	preSpill: number;
	/** Rows the 結帳日後 mirror can spill into. */
	postSpill: number;
	/** Blank rows between the 結帳日前 小計 and the 結帳日後 label (1 on the live sheet). */
	gap?: number;
	/** Blank rows between this block's last 小計 and the next card title stacked below it. */
	tail?: number;
	/** Force a start row instead of stacking under the band's previous block. */
	startRow?: number;
	/** Column the amounts bill in: "D" for the US cards, "E" (+ lunch "R") for the TWD card. */
	amountCol?: "D" | "E";
}

interface BucketAnchorRows {
	labelRow: number;
	headerRow: number;
	subtotalRow: number;
}

interface CardBlockAnchors {
	startCol: number;
	titleRow: number;
	closeDateRow: number;
	payDateRow: number;
	dueRow: number;
	pre: BucketAnchorRows;
	post: BucketAnchorRows;
	/** Row where the next card title in this band goes. */
	nextTitleRow: number;
}

/** Write one card block at `startRow` and hand back every row it used. */
function putCardBlock(g: unknown[][], startRow: number, spec: CardBlockSpec): CardBlockAnchors {
	const col = spec.col;
	const put = (row: number, c: number, v: unknown) => {
		(g[row - 1] ??= [])[c] = v;
	};
	const value = colLetter(col + 2);
	const amount = spec.amountCol ?? (spec.name === "國泰 CUBE" ? "E" : "D");
	const gap = spec.gap ?? 1;
	const tail = spec.tail ?? 1;

	const titleRow = startRow;
	const closeDateRow = startRow + 1;
	const payDateRow = startRow + 2;
	const dueRow = startRow + 3;
	put(titleRow, col, spec.name);
	put(closeDateRow, col, "本月結帳日");
	put(closeDateRow, col + 2, spec.close);
	put(payDateRow, col, "本月繳款日");
	put(payDateRow, col + 2, spec.pay);
	put(dueRow, col, "本月需繳款");
	put(dueRow, col + 2, spec.due ?? 0);

	const closeRef = `${value}${closeDateRow}`;
	// 結帳日前 is 日期 < 結帳日 for every card except Apple Card, whose statement
	// IS the calendar month and so keeps the close date — the fixture's mirrors
	// and 小計s carry the same conditions the live sheet does.
	const pre = spec.name === "Apple Card" ? "<=" : "<";
	const post = spec.name === "Apple Card" ? ">" : ">=";
	const lunchTerm = (op: string) =>
		amount === "E" ? `+SUMIFS(R3:R,S3:S,"${spec.name}",P3:P,"${op}"&${closeRef})` : "";
	const mirror = (op: string) =>
		amount === "E"
			? `=IFERROR(QUERY({IFERROR(FILTER({A3:A,B3:B,E3:E},G3:G="${spec.name}",A3:A<>"",A3:A${op}${closeRef}),{"","",""});IFERROR(FILTER({P3:P,Q3:Q,R3:R},S3:S="${spec.name}",P3:P<>"",P3:P${op}${closeRef}),{"","",""})},"where Col1 is not null order by Col1",0),)`
			: `=IFERROR(FILTER({A3:A,B3:B,D3:D},G3:G="${spec.name}",A3:A<>"",A3:A${op}${closeRef}),)`;

	const bucket = (labelRow: number, label: string, spill: number, op: string, sumOp: string): BucketAnchorRows => {
		const headerRow = labelRow + 1;
		put(labelRow, col, label);
		put(headerRow, col, "日期");
		put(headerRow, col + 1, "項目");
		put(headerRow, col + 2, "金額");
		// The mirror lives in the first spill row; the rest is blank cushion
		// (a FORMULA-rendered read shows spilled cells as empty anyway).
		if (spill > 0) put(headerRow + 1, col, mirror(op));
		const subtotalRow = headerRow + spill + 1;
		put(subtotalRow, col + 1, "小計");
		put(
			subtotalRow,
			col + 2,
			`=SUMIFS(${amount}3:${amount},G3:G,"${spec.name}",A3:A,"${sumOp}"&${closeRef}${sumOp.startsWith("<") ? ',A3:A,">0"' : ""})${lunchTerm(sumOp)}`,
		);
		return { labelRow, headerRow, subtotalRow };
	};
	const preBucket = bucket(dueRow + 1, "結帳日前", spec.preSpill, pre, pre);
	const postBucket = bucket(preBucket.subtotalRow + gap + 1, "結帳日後", spec.postSpill, post, post);
	return {
		startCol: col,
		titleRow,
		closeDateRow,
		payDateRow,
		dueRow,
		pre: preBucket,
		post: postBucket,
		nextTitleRow: postBucket.subtotalRow + tail + 1,
	};
}

/**
 * Write a whole 信用卡帳單對帳區 (title at `anchorRow`, column H) from a list of
 * block specs. Blocks stack inside their own column band in the order given;
 * the two bands are independent, exactly as the sheet's 2×2 grid is.
 */
function putCreditSection(
	g: unknown[][],
	anchorRow: number,
	specs: readonly CardBlockSpec[],
): Record<string, CardBlockAnchors> {
	(g[anchorRow - 1] ??= [])[7] = "信用卡帳單對帳區";
	const nextFree = new Map<number, number>();
	const anchors: Record<string, CardBlockAnchors> = {};
	for (const spec of specs) {
		const start = spec.startRow ?? nextFree.get(spec.col) ?? anchorRow + 1;
		const a = putCardBlock(g, start, spec);
		nextFree.set(spec.col, a.nextTitleRow);
		anchors[spec.name] = a;
	}
	return anchors;
}

/** The two-card spec the default fixture uses: 國泰 CUBE in H–J (lag 1), CHASE Amazon in L–N (lag 0), 2-row spills. */
function twoCardSpecs(): CardBlockSpec[] {
	return [
		{
			name: "國泰 CUBE",
			col: 7,
			close: dateSerial(2026, 7, 19),
			pay: dateSerial(2026, 7, 6),
			due: 21500,
			preSpill: 2,
			postSpill: 2,
		},
		{
			name: "CHASE Amazon",
			col: 11,
			close: dateSerial(2026, 7, 3),
			pay: dateSerial(2026, 7, 28),
			due: "=N49+'6 月'!N55",
			preSpill: 2,
			postSpill: 2,
		},
	];
}

/**
 * lunchGrid + a 信用卡帳單對帳區 (anchor H40) with two card blocks:
 * 國泰 CUBE at H41 (values in J, lag 1) and CHASE Amazon at L41 (values in N,
 * lag 0). Rows: title 41, 結帳日 42, 繳款日 43, 本月需繳款 44, 結帳日前 45,
 * header 46, cushion 47-48, 小計 49, 結帳日後 51, header 52, cushion 53-54, 小計 55.
 * The 小計 label sits in the block's 2nd column (I/M), the value in the 3rd (J/N).
 */
function creditGrid(): unknown[][] {
	const g = lunchGrid();
	putCreditSection(g, 40, twoCardSpecs());
	return g;
}

/** creditGrid's 國泰 CUBE anchors — tool-level tests assert insert/stamp rows against these, never against literals. */
const CUBE_AT = creditGridAnchors()["國泰 CUBE"]!;

/** creditGrid's anchors, for tests that need the rows without re-deriving them. */
function creditGridAnchors(): Record<string, CardBlockAnchors> {
	return putCreditSection(lunchGrid(), 40, twoCardSpecs());
}

/** The repeatCells the bucket guard emits to stamp a spill area's 日期/金額 formats (0-indexed rows, end exclusive). */
function bucketFormatStamps(startRow0: number, endRow0: number, startCol: number, amountPattern: string) {
	const stamp = (col: number, numberFormat: object) => ({
		repeatCell: {
			range: {
				sheetId: 111,
				startRowIndex: startRow0,
				endRowIndex: endRow0,
				startColumnIndex: col,
				endColumnIndex: col + 1,
			},
			cell: { userEnteredFormat: { numberFormat } },
			fields: "userEnteredFormat.numberFormat",
		},
	});
	return [
		stamp(startCol, { type: "DATE", pattern: "mm/dd" }),
		stamp(startCol + 2, { type: "CURRENCY", pattern: amountPattern }),
	];
}

/** The bucket audit's clear (formula null) / rewrite of one mirror anchor around a growth insert. */
function mirrorWrite(row: number, col: number, formula: string | null) {
	return {
		updateCells: {
			start: { sheetId: 111, rowIndex: row - 1, columnIndex: col },
			rows: [{ values: [formula === null ? {} : { userEnteredValue: { formulaValue: formula } }] }],
			fields: "userEnteredValue",
		},
	};
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

/**
 * The full 2×2 grid: 國泰 CUBE / CHASE Freedom stacked in H–J, CHASE Amazon /
 * Apple Card in L–N, with per-card spill lengths. `spills` names the four
 * cards' [結帳日前, 結帳日後] capacities; anything omitted keeps the default.
 * Every test that cares about rows reads them out of the returned anchors, so
 * changing ANY card's spill length here can only move rows, never break a test.
 */
type SpillMap = Partial<Record<string, [number, number]>>;

function fourCardSpecs(spills: SpillMap = {}): CardBlockSpec[] {
	const base: Array<[string, number, number, number, number | string]> = [
		["國泰 CUBE", 7, dateSerial(2026, 7, 19), dateSerial(2026, 7, 6), 21500],
		["CHASE Amazon", 11, dateSerial(2026, 7, 3), dateSerial(2026, 7, 28), 4.99],
		["CHASE Freedom", 7, dateSerial(2026, 7, 13), dateSerial(2026, 7, 16), 26.99],
		["Apple Card", 11, dateSerial(2026, 7, 31), dateSerial(2026, 7, 31), 172.61],
	];
	return base.map(([name, col, close, pay, due]) => {
		const [preSpill, postSpill] = spills[name] ?? [2, 2];
		return { name, col, close, pay, due, preSpill, postSpill };
	});
}

function fourCardGrid(spills: SpillMap = {}, anchorRow = 40): { grid: unknown[][]; at: Record<string, CardBlockAnchors> } {
	const grid = lunchGrid();
	const at = putCreditSection(grid, anchorRow, fourCardSpecs(spills));
	return { grid, at };
}

const CARD_NAMES = ["國泰 CUBE", "CHASE Amazon", "CHASE Freedom", "Apple Card"] as const;

describe("findCreditSection", () => {
	it("locates every card block present, skipping registry cards missing from the sheet", () => {
		const at = creditGridAnchors();
		const blocks = findCreditSection(creditGrid(), "9 月");
		expect(blocks.map((b) => [b.card.name, b.startCol])).toEqual([
			["國泰 CUBE", 7],
			["CHASE Amazon", 11],
		]);
		expect(blocks[0]).toMatchObject({
			titleRow: at["國泰 CUBE"]!.titleRow,
			closeDateRow: at["國泰 CUBE"]!.closeDateRow,
			payDateRow: at["國泰 CUBE"]!.payDateRow,
			dueRow: at["國泰 CUBE"]!.dueRow,
			pre: at["國泰 CUBE"]!.pre,
			post: at["國泰 CUBE"]!.post,
		});
		expect(blocks[1]).toMatchObject({ startCol: 11, post: at["CHASE Amazon"]!.post });
	});

	it("throws when the tab has no 信用卡帳單對帳區", () => {
		expect(() => findCreditSection(lunchGrid(), "6 月")).toThrow("信用卡帳單對帳區");
	});

	it("throws naming the card and the missing label when a block is torn", () => {
		const g = creditGrid();
		(g[creditGridAnchors()["國泰 CUBE"]!.dueRow - 1] as unknown[])[7] = ""; // CUBE loses its 本月需繳款 label
		expect(() => findCreditSection(g, "9 月")).toThrow(/國泰 CUBE.*本月需繳款/);
	});

	it("throws naming the card and 小計 when the bounded scan crosses into the next bucket", () => {
		const g = creditGrid();
		(g[creditGridAnchors()["國泰 CUBE"]!.pre.subtotalRow - 1] as unknown[])[8] = ""; // CUBE loses its pre-小計 label
		expect(() => findCreditSection(g, "9 月")).toThrow(/國泰 CUBE.*小計/);
	});

	it("never adopts a 小計 from the next card block stacked below in the same column", () => {
		const { grid, at } = fourCardGrid();
		(grid[at["國泰 CUBE"]!.post.subtotalRow - 1] as unknown[])[8] = ""; // CUBE loses its post-小計 label
		// CHASE Freedom's block starts below it in the same band and has 小計s of
		// its own — the boundary must stop the scan before it reaches them.
		expect(() => findCreditSection(grid, "9 月")).toThrow(/國泰 CUBE.*小計/);
	});

	// ── spill-length independence ──────────────────────────────────────────
	// The bug this suite exists for: the 對帳區's anchors move whenever a card's
	// spill area grows, so anything located by a fixed offset (or by a fixed
	// read depth) breaks one card at a time. These cases vary the spills and
	// assert the finder returns the rows the fixture actually used.

	const SPILL_CASES: Array<[string, SpillMap]> = [
		["a freshly opened month (every spill still the same size)", {}],
		["one card grown far past the others", { "國泰 CUBE": [28, 32] }],
		["every card grown differently, top and bottom bands both deep", {
			"國泰 CUBE": [28, 32],
			"CHASE Amazon": [3, 41],
			"CHASE Freedom": [11, 9],
			"Apple Card": [40, 1],
		}],
		["the bottom band far deeper than the top", { "CHASE Freedom": [55, 60], "Apple Card": [70, 12] }],
		["empty spills (a month with no card charges yet)", {
			"國泰 CUBE": [0, 0],
			"CHASE Amazon": [0, 0],
			"CHASE Freedom": [0, 0],
			"Apple Card": [0, 0],
		}],
		["a spill big enough to push the last 小計 past any fixed read window", { "Apple Card": [260, 180] }],
	];

	for (const [label, spills] of SPILL_CASES) {
		it(`resolves all four blocks with ${label}`, () => {
			const { grid, at } = fourCardGrid(spills);
			const blocks = findCreditSection(grid, "9 月");
			expect(blocks.map((b) => b.card.name)).toEqual([...CARD_NAMES]);
			for (const b of blocks) {
				const want = at[b.card.name]!;
				expect({ name: b.card.name, ...b, card: undefined, endRow: undefined }).toMatchObject({
					titleRow: want.titleRow,
					startCol: want.startCol,
					closeDateRow: want.closeDateRow,
					payDateRow: want.payDateRow,
					dueRow: want.dueRow,
					pre: want.pre,
					post: want.post,
				});
			}
		});
	}

	it("keeps each band's blocks independent when the two bands are misaligned", () => {
		// A band insert widens both bands at the same rows, so live blocks stay
		// roughly aligned — but nothing may DEPEND on that. Here the L band's
		// second block starts 40 rows above the H band's.
		const grid = lunchGrid();
		const at = putCreditSection(grid, 40, [
			{ name: "國泰 CUBE", col: 7, close: dateSerial(2026, 7, 19), pay: dateSerial(2026, 7, 6), preSpill: 30, postSpill: 30 },
			{ name: "CHASE Amazon", col: 11, close: dateSerial(2026, 7, 3), pay: dateSerial(2026, 7, 28), preSpill: 1, postSpill: 1 },
			{ name: "CHASE Freedom", col: 7, close: dateSerial(2026, 7, 13), pay: dateSerial(2026, 7, 16), preSpill: 4, postSpill: 4 },
			{ name: "Apple Card", col: 11, close: dateSerial(2026, 7, 31), pay: dateSerial(2026, 7, 31), preSpill: 9, postSpill: 9 },
		]);
		expect(at["Apple Card"]!.titleRow).toBeLessThan(at["CHASE Freedom"]!.titleRow);
		const blocks = findCreditSection(grid, "9 月");
		for (const b of blocks) {
			expect(b.pre).toEqual(at[b.card.name]!.pre);
			expect(b.post).toEqual(at[b.card.name]!.post);
		}
	});

	it("handles a month carrying only some of the cards", () => {
		// 5月/6月 have no section at all…
		expect(() => findCreditSection(lunchGrid(), "6 月")).toThrow("信用卡帳單對帳區");
		// …and a partially built section resolves exactly the blocks present,
		// including a band holding a single card.
		const grid = lunchGrid();
		const at = putCreditSection(grid, 40, [
			{ name: "CHASE Amazon", col: 11, close: dateSerial(2026, 7, 3), pay: dateSerial(2026, 7, 28), preSpill: 7, postSpill: 2 },
			{ name: "CHASE Freedom", col: 7, close: dateSerial(2026, 7, 13), pay: dateSerial(2026, 7, 16), preSpill: 3, postSpill: 15 },
		]);
		const blocks = findCreditSection(grid, "9 月");
		expect(blocks.map((b) => b.card.name)).toEqual(["CHASE Amazon", "CHASE Freedom"]);
		expect(blocks[0]).toMatchObject({ startCol: 11, pre: at["CHASE Amazon"]!.pre, post: at["CHASE Amazon"]!.post });
		expect(blocks[1]).toMatchObject({ startCol: 7, pre: at["CHASE Freedom"]!.pre, post: at["CHASE Freedom"]!.post });
	});

	it("resolves the live 7月 2026 geometry, whose CUBE 小計s sit at J127 and J163", () => {
		// The exact tab that reported "國泰 CUBE … is missing its 小計 row": the
		// section anchor at 92, CUBE's buckets grown to 28/32 spill rows, and the
		// second band starting at 165.
		const grid = lunchGrid();
		const at = putCreditSection(grid, 92, [
			{ name: "國泰 CUBE", col: 7, close: dateSerial(2026, 7, 19), pay: dateSerial(2026, 7, 6), due: 11658, preSpill: 28, postSpill: 32 },
			{ name: "CHASE Amazon", col: 11, close: dateSerial(2026, 7, 3), pay: dateSerial(2026, 7, 28), due: 4.99, preSpill: 28, postSpill: 32 },
			{ name: "CHASE Freedom", col: 7, close: dateSerial(2026, 7, 13), pay: dateSerial(2026, 7, 16), due: 26.99, preSpill: 11, postSpill: 10 },
			{ name: "Apple Card", col: 11, close: dateSerial(2026, 7, 31), pay: dateSerial(2026, 7, 31), due: 172.61, preSpill: 11, postSpill: 10 },
		]);
		expect(at["國泰 CUBE"]!.pre.subtotalRow).toBe(127);
		expect(at["國泰 CUBE"]!.post.subtotalRow).toBe(163);
		expect(at["CHASE Freedom"]!.titleRow).toBe(165);
		expect(at["Apple Card"]!.post.subtotalRow).toBe(196);
		const blocks = findCreditSection(grid, "7 月");
		expect(blocks.map((b) => b.card.name)).toEqual([...CARD_NAMES]);
		expect(blocks[0]!.pre.subtotalRow).toBe(127);
		expect(blocks[0]!.post.subtotalRow).toBe(163);
	});

	it("reads the whole tab: the grid read carries no row bound that a spill could outgrow", () => {
		expect(FULL_GRID_READ).toBe("A1:S");
		expect(FULL_GRID_READ).not.toMatch(/\d+$/);
	});

	it("names the read extent when a scan runs off the end of the grid instead of into the next block", () => {
		const { grid, at } = fourCardGrid({ "CHASE Freedom": [22, 22] });
		grid.length = at["CHASE Freedom"]!.post.subtotalRow - 2; // the response stopped short of Freedom's last 小計
		expect(() => findCreditSection(grid, "8 月")).toThrow(/CHASE Freedom.*小計.*last row with content/s);
	});

	// ── stray cells in the band are not blocks ─────────────────────────────

	it("ignores an orphan below the section — a card name with no block head under it", () => {
		const { grid, at } = fourCardGrid();
		// what the live 7月 tab carries: a leftover ~24 rows below the last
		// block, in the band's own column
		const orphan = at["CHASE Freedom"]!.post.subtotalRow + 24;
		(grid[orphan - 1] ??= [])[7] = "CHASE Amazon";
		const blocks = findCreditSection(grid, "9 月");
		expect(blocks.map((b) => [b.card.name, b.startCol])).toEqual([
			["國泰 CUBE", 7],
			["CHASE Amazon", 11], // the real L-band block, not the orphan
			["CHASE Freedom", 7],
			["Apple Card", 11],
		]);
		expect(blocks[1]!.post).toEqual(at["CHASE Amazon"]!.post);
	});

	for (const bucket of ["pre", "post"] as const) {
		it(`a stray card name inside a ${bucket === "pre" ? "結帳日前" : "結帳日後"} spill area does not cut its block short`, () => {
			const { grid, at } = fourCardGrid();
			const cube = at["國泰 CUBE"]!;
			// a leftover lands in a spill row: scanning down from it hits the
			// bucket's 小計 before any block head, so it is inside CUBE's block,
			// not the start of a new one
			(grid[cube[bucket].headerRow] ??= [])[7] = "Apple Card";
			const blocks = findCreditSection(grid, "9 月");
			expect(blocks.find((b) => b.card.name === "國泰 CUBE")).toMatchObject({ pre: cube.pre, post: cube.post });
			// …and Apple Card still resolves to its real L-band block
			expect(blocks.find((b) => b.card.name === "Apple Card")).toMatchObject({
				startCol: 11,
				pre: at["Apple Card"]!.pre,
			});
		});
	}

	it("still reports a genuinely torn block loudly — furniture present, one label gone", () => {
		const { grid, at } = fourCardGrid();
		(grid[at["CHASE Freedom"]!.closeDateRow - 1] as unknown[])[7] = ""; // 本月結帳日 label deleted
		expect(() => findCreditSection(grid, "9 月")).toThrow(/CHASE Freedom.*本月結帳日/);
	});

	it("finds the 日期 header wherever it sits, not one row under the bucket label", () => {
		// A whole-sheet row inserted by hand (or a band insert from the other
		// column band) can open a blank row between a bucket's label and its
		// header. The header, the spill and the 小計 all move; nothing may assume
		// the old distance.
		const { grid, at } = fourCardGrid();
		const cube = at["國泰 CUBE"]!;
		grid.splice(cube.pre.headerRow - 1, 0, []); // blank row lands between 結帳日前 and 日期
		const block = findCreditSection(grid, "9 月").find((b) => b.card.name === "國泰 CUBE")!;
		expect(block.pre.labelRow).toBe(cube.pre.labelRow);
		expect(block.pre.headerRow).toBe(cube.pre.headerRow + 1);
		expect(block.pre.subtotalRow).toBe(cube.pre.subtotalRow + 1);
		// …and the spill capacity is measured from the header, so the inserted
		// row is NOT miscounted as usable spill room.
		expect(block.pre.subtotalRow - block.pre.headerRow - 1).toBe(2);
	});
});

describe("auditCreditBuckets", () => {
	/** creditGrid + three hand-entered 國泰 CUBE rows dated pre-結帳日 — one over the 結帳日前 bucket's 2-row spill area. */
	function overflowedGrid(): unknown[][] {
		const g = creditGrid();
		g[4] = [dateSerial(2026, 7, 10), "手填1", "訂閱", "", 100, "TWD", "國泰 Cube"];
		g[5] = [dateSerial(2026, 7, 10), "手填2", "訂閱", "", 100, "TWD", "國泰 Cube"];
		g[6] = [dateSerial(2026, 7, 10), "手填3", "訂閱", "", 100, "TWD", "國泰 Cube"];
		return g;
	}

	it("no-ops on a healthy section when there is no pending entry", () => {
		expect(auditCreditBuckets(creditGrid(), "9 月", 111)).toEqual({
			requests: [],
			bucket: null,
			rowsAdded: 0,
			grown: [],
		});
	});

	it("skips silently on tabs without the section", () => {
		expect(auditCreditBuckets(lunchGrid(), "6 月", 111)).toEqual({
			requests: [],
			bucket: null,
			rowsAdded: 0,
			grown: [],
		});
	});

	it("degrades to a warning on a torn section", () => {
		const g = creditGrid();
		(g[creditGridAnchors()["國泰 CUBE"]!.dueRow - 1] as unknown[])[7] = ""; // CUBE loses 本月需繳款
		const result = auditCreditBuckets(g, "9 月", 111);
		expect(result.requests).toEqual([]);
		expect(result.warning).toMatch(/國泰 CUBE.*本月需繳款/);
	});

	it("grows a bucket that hand-entered rows overflowed, with no pending entry", () => {
		const cube = creditGridAnchors()["國泰 CUBE"]!;
		const result = auditCreditBuckets(overflowedGrid(), "9 月", 111);
		expect(result.bucket).toBeNull();
		expect(result.rowsAdded).toBe(0);
		expect(result.grown).toEqual([{ card: "國泰 CUBE", bucket: "結帳日前", rowsAdded: 1 }]);
		const inserts = result.requests.filter((r: any) => (r as any).insertRange) as any[];
		expect(inserts).toEqual([
			{
				insertRange: {
					range: {
						sheetId: 111,
						startRowIndex: cube.pre.subtotalRow - 1,
						endRowIndex: cube.pre.subtotalRow,
						startColumnIndex: 7,
						endColumnIndex: 14,
					},
					shiftDimension: "ROWS",
				},
			},
		]);
		// the grown bucket's whole spill area is stamped: the row under the 日期
		// header through the row above the (shifted-down) 小計
		expect(result.requests).toEqual(
			expect.arrayContaining(bucketFormatStamps(cube.pre.headerRow, cube.pre.subtotalRow, 7, "[$NTD ]#,##0.00")),
		);
	});

	it("pads every bucket to minCapacity bottom-up, one insert per aligned 小計 row", () => {
		const at = creditGridAnchors();
		const cube = at["國泰 CUBE"]!;
		const pad = CREDIT_BUCKET_PAD_ROWS - 2; // the fixture's buckets already hold 2
		const result = auditCreditBuckets(creditGrid(), "9 月", 111, undefined, CREDIT_BUCKET_PAD_ROWS);
		const inserts = (result.requests.filter((r: any) => (r as any).insertRange) as any[]).map(
			(r) => r.insertRange.range,
		);
		// both cards' 小計 rows align, so one H–N insert per bucket row widens
		// both card columns at once — never a double-growth
		expect(inserts).toEqual([
			{
				sheetId: 111,
				startRowIndex: cube.post.subtotalRow - 1,
				endRowIndex: cube.post.subtotalRow - 1 + pad,
				startColumnIndex: 7,
				endColumnIndex: 14,
			},
			{
				sheetId: 111,
				startRowIndex: cube.pre.subtotalRow - 1,
				endRowIndex: cube.pre.subtotalRow - 1 + pad,
				startColumnIndex: 7,
				endColumnIndex: 14,
			},
		]);
		expect(result.grown).toEqual([
			{ card: "國泰 CUBE", bucket: "結帳日後", rowsAdded: pad },
			{ card: "國泰 CUBE", bucket: "結帳日前", rowsAdded: pad },
		]);
		// the widened twin blocks (CHASE) get their padded spill areas stamped too
		const amazon = at["CHASE Amazon"]!;
		expect(result.requests).toEqual(
			expect.arrayContaining(
				bucketFormatStamps(amazon.pre.headerRow, amazon.pre.subtotalRow - 1 + pad, 11, '"$"#,##0.00'),
			),
		);
	});

	it("counts a pending entry into its bucket while auditing the rest of the section", () => {
		const result = auditCreditBuckets(overflowedGrid(), "9 月", 111, {
			cardName: "國泰 CUBE",
			dateSerial: dateSerial(2026, 7, 25),
		});
		// pending lands post-結帳日: its bucket has room (0+1 of 2), the
		// overflowed 結帳日前 bucket still heals in the same audit
		expect(result.bucket).toBe("結帳日後");
		expect(result.rowsAdded).toBe(0);
		expect(result.grown).toEqual([{ card: "國泰 CUBE", bucket: "結帳日前", rowsAdded: 1 }]);
	});

	// ── array footprints vs. the growth insert ─────────────────────────────
	// Sheets refuses an insertRange that would split an array formula's
	// footprint ("You cannot insert or delete cells over an array formula").
	// A mirror whose spill is BLOCKED (#REF!) still claims its full intended
	// footprint, which runs through its own 小計 row — exactly where the
	// growth insert lands. So a bucket that a hand edit already overflowed
	// could never be healed (9 月 2026, 國泰 CUBE 結帳日後: H147 #REF!,
	// `Invalid requests[1].insertRange`).

	/** The cells cleared right before / rewritten right after the insertRange starting at 0-indexed row `startRow0`. */
	function bracketOf(requests: any[], startRow0: number) {
		const at = requests.findIndex((r) => r.insertRange?.range.startRowIndex === startRow0);
		expect(at).toBeGreaterThanOrEqual(0);
		const cell = (r: any) => [r.updateCells.start.rowIndex + 1, r.updateCells.start.columnIndex];
		const isClear = (r: any) => r?.updateCells && r.updateCells.rows[0].values[0].userEnteredValue === undefined;
		const isRestore = (r: any) => r?.updateCells?.rows[0].values[0].userEnteredValue?.formulaValue !== undefined;
		const cleared: number[][] = [];
		for (let i = at - 1; isClear(requests[i]); i--) cleared.unshift(cell(requests[i]));
		const restored: number[][] = [];
		for (let i = at + 1; isRestore(requests[i]); i++) restored.push(cell(requests[i]));
		return { cleared, restored };
	}

	it("lifts a #REF! mirror off the grid around the insert that grows its bucket, then rewrites it verbatim", () => {
		const g = overflowedGrid(); // CUBE 結帳日前: 3 charges, 2-row spill → H mirror shows #REF!
		const { "國泰 CUBE": cube, "CHASE Amazon": amazon } = creditGridAnchors();
		const cubeMirror = g[cube.pre.headerRow]![7] as string;
		const amazonMirror = g[amazon.pre.headerRow]![11] as string;
		expect(cubeMirror).toMatch(/^=/);

		const result = auditCreditBuckets(g, "9 月", 111);

		// stamps aside, the batch is exactly: clear → insert → restore. The
		// twin (CHASE Amazon, same 小計 row, widened by the same H–N insert) is
		// lifted too: any mirror whose bucket the insert row runs through might
		// straddle it, and an unneeded lift-and-rewrite is harmless.
		expect(result.requests.filter((r: any) => !r.repeatCell)).toEqual([
			mirrorWrite(cube.pre.headerRow + 1, 7, null),
			mirrorWrite(amazon.pre.headerRow + 1, 11, null),
			{
				insertRange: {
					range: {
						sheetId: 111,
						startRowIndex: cube.pre.subtotalRow - 1,
						endRowIndex: cube.pre.subtotalRow,
						startColumnIndex: 7,
						endColumnIndex: 14,
					},
					shiftDimension: "ROWS",
				},
			},
			mirrorWrite(cube.pre.headerRow + 1, 7, cubeMirror),
			mirrorWrite(amazon.pre.headerRow + 1, 11, amazonMirror),
		]);
	});

	it("lifts only the mirrors the insert row runs through — never one above its bucket or below the insert", () => {
		const { grid, at } = fourCardGrid();
		const cube = at["國泰 CUBE"]!;
		const close = grid[cube.closeDateRow - 1]![9] as number;
		putCardRows(grid, 2, 3, "國泰 CUBE", close + 3); // overflow CUBE 結帳日後 by one

		const result = auditCreditBuckets(grid, "9 月", 111);

		expect(result.grown).toEqual([{ card: "國泰 CUBE", bucket: "結帳日後", rowsAdded: 1 }]);
		// the 結帳日前 mirrors sit above (their buckets end before the insert);
		// CHASE Freedom / Apple Card sit below and shift whole
		expect(bracketOf(result.requests, cube.post.subtotalRow - 1)).toEqual({
			cleared: [
				[cube.post.headerRow + 1, 7],
				[at["CHASE Amazon"]!.post.headerRow + 1, 11],
			],
			restored: [
				[cube.post.headerRow + 1, 7],
				[at["CHASE Amazon"]!.post.headerRow + 1, 11],
			],
		});
		expect(result.requests.filter((r: any) => r.updateCells)).toHaveLength(4);
	});

	it("lifts a mirror whose overflow runs past its own 小計 for an insert in the block below", () => {
		const { grid, at } = fourCardGrid();
		const cube = at["國泰 CUBE"]!;
		const freedom = at["CHASE Freedom"]!;
		const cubeClose = grid[cube.closeDateRow - 1]![9] as number;
		const freedomClose = grid[freedom.closeDateRow - 1]![9] as number;
		// CUBE's 結帳日後 mirror wants to spill all the way down to CHASE
		// Freedom's 結帳日前 小計 — through the very row that bucket grows at
		const deep = freedom.pre.subtotalRow - cube.post.headerRow;
		putCardRows(grid, 2, deep, "國泰 CUBE", cubeClose + 3);
		putCardRows(grid, 2 + deep, 3, "CHASE Freedom", freedomClose - 3);

		const result = auditCreditBuckets(grid, "9 月", 111);

		expect(bracketOf(result.requests, freedom.pre.subtotalRow - 1).cleared).toEqual(
			expect.arrayContaining([[cube.post.headerRow + 1, 7]]),
		);
	});

	it("lifts nothing from a mirror cell that holds no formula", () => {
		const g = overflowedGrid();
		const { "CHASE Amazon": amazon, "國泰 CUBE": cube } = creditGridAnchors();
		(g[amazon.pre.headerRow] as unknown[])[11] = ""; // no mirror in the twin bucket

		const result = auditCreditBuckets(g, "9 月", 111);

		expect(bracketOf(result.requests, cube.pre.subtotalRow - 1)).toEqual({
			cleared: [[cube.pre.headerRow + 1, 7]],
			restored: [[cube.pre.headerRow + 1, 7]],
		});
	});

	// ── every card × every bucket, at any spill length ─────────────────────

	/**
	 * Write `count` card charges dated `serial` into columns A–G from row
	 * `startIdx + 1`. Only the expense columns are touched, so a run long enough
	 * to reach another section's rows cannot silently damage it — and reaching
	 * the 對帳區 itself throws, so a future spill bump fails loudly here instead
	 * of quietly testing a torn grid.
	 */
	function putCardRows(g: unknown[][], startIdx: number, count: number, card: string, serial: number): void {
		const sectionIdx = g.findIndex((r) => String(r?.[7] ?? "").trim() === "信用卡帳單對帳區");
		if (sectionIdx >= 0 && startIdx + count > sectionIdx) {
			throw new Error(`fixture overflow: ${count} card rows from index ${startIdx} would reach the 對帳區`);
		}
		for (let i = 0; i < count; i++) {
			const row = (g[startIdx + i] ??= []);
			row[0] = serial;
			row[1] = `手填${i + 1}`;
			row[2] = "訂閱";
			row[3] = 10;
			row[4] = 100;
			row[5] = "TWD";
			row[6] = card;
		}
	}

	const GROWTH_SPILLS: Array<[string, SpillMap]> = [
		["a freshly opened month", {}],
		[
			"spills already grown to different lengths",
			{ "國泰 CUBE": [9, 3], "CHASE Amazon": [1, 25], "CHASE Freedom": [17, 6], "Apple Card": [4, 30] },
		],
		[
			"empty spill areas (nothing has spilled yet)",
			{ "國泰 CUBE": [0, 0], "CHASE Amazon": [0, 0], "CHASE Freedom": [0, 0], "Apple Card": [0, 0] },
		],
	];

	for (const [label, spills] of GROWTH_SPILLS) {
		for (const card of CARD_NAMES) {
			for (const bucket of ["結帳日前", "結帳日後"] as const) {
				it(`grows ${card}'s ${bucket} bucket by exactly what overflows it — ${label}`, () => {
					const { grid, at } = fourCardGrid(spills);
					const anchors = at[card]!;
					const target = bucket === "結帳日前" ? anchors.pre : anchors.post;
					const capacity = target.subtotalRow - target.headerRow - 1;
					const charges = capacity + 3;
					// Apple Card's statement closes ON its 結帳日 (the calendar
					// month's last day); every other card's 結帳日 belongs to the
					// NEXT statement. Date the charges away from the boundary so
					// this case tests capacity, not the boundary rule.
					const close = grid[anchors.closeDateRow - 1]![anchors.startCol + 2] as number;
					putCardRows(grid, 2, charges, card, bucket === "結帳日前" ? close - 3 : close + 3);

					const result = auditCreditBuckets(grid, "9 月", 111);
					expect(result.grown).toEqual([{ card, bucket, rowsAdded: 3 }]);
					const inserts = (result.requests.filter((r: any) => r.insertRange) as any[]).map(
						(r) => r.insertRange.range,
					);
					expect(inserts).toEqual([
						{
							sheetId: 111,
							startRowIndex: target.subtotalRow - 1,
							endRowIndex: target.subtotalRow - 1 + 3,
							startColumnIndex: 7,
							endColumnIndex: 14,
						},
					]);
					// …and the grown spill area is stamped in the card's billing currency
					expect(result.requests).toEqual(
						expect.arrayContaining(
							bucketFormatStamps(
								target.headerRow,
								target.subtotalRow - 1 + 3,
								anchors.startCol,
								card === "國泰 CUBE" ? "[$NTD ]#,##0.00" : '"$"#,##0.00',
							),
						),
					);
				});
			}
		}
	}

	it("measures capacity from the scanned 日期 header, not from the bucket label", () => {
		// A hand-inserted row between 結帳日前 and its 日期 header is NOT spill
		// room: counting label→小計 would over-report capacity by one and leave
		// the mirror one row short (#REF!).
		const { grid, at } = fourCardGrid();
		const cube = at["國泰 CUBE"]!;
		grid.splice(cube.pre.headerRow - 1, 0, []);
		putCardRows(grid, 2, 3, "國泰 CUBE", (grid[cube.closeDateRow - 1]![9] as number) - 3);
		const result = auditCreditBuckets(grid, "9 月", 111);
		expect(result.grown).toEqual([{ card: "國泰 CUBE", bucket: "結帳日前", rowsAdded: 1 }]);
		const inserts = (result.requests.filter((r: any) => r.insertRange) as any[]).map((r) => r.insertRange.range);
		expect(inserts[0]).toMatchObject({ startRowIndex: cube.pre.subtotalRow }); // one row lower than before the splice
	});

	it("skips buckets that are already big enough, however long their spills are", () => {
		const { grid } = fourCardGrid({ "國泰 CUBE": [30, 30], "Apple Card": [12, 12] });
		putCardRows(grid, 2, 4, "國泰 CUBE", dateSerial(2026, 7, 10));
		expect(auditCreditBuckets(grid, "9 月", 111).grown).toEqual([]);
	});

	// ── the per-card rules the refactor must not lose ──────────────────────

	it("keeps Apple Card's 結帳日-inclusive statement while the other three exclude it", () => {
		for (const card of CARD_NAMES) {
			const { grid, at } = fourCardGrid({ [card]: [0, 0] });
			const anchors = at[card]!;
			const close = grid[anchors.closeDateRow - 1]![anchors.startCol + 2] as number;
			putCardRows(grid, 2, 1, card, close); // dated exactly ON the 結帳日
			const grown = auditCreditBuckets(grid, "9 月", 111).grown;
			expect(grown).toEqual([
				{ card, bucket: card === "Apple Card" ? "結帳日前" : "結帳日後", rowsAdded: 1 },
			]);
		}
	});

	it("counts the 午餐預算 log's card lunches into the TWD-billed card's buckets only", () => {
		const { grid, at } = fourCardGrid({ "國泰 CUBE": [0, 0], "Apple Card": [0, 0] });
		const cube = at["國泰 CUBE"]!;
		const close = grid[cube.closeDateRow - 1]![9] as number;
		// two lunches on the CUBE (P=日期, Q=項目, R=金額, S=支付方式), one each side
		// of its 結帳日 — the mirror QUERY-merges them, so the buckets must too
		(grid[36] ??= [])[15] = close - 2;
		grid[36]![16] = "中餐";
		grid[36]![17] = 143;
		grid[36]![18] = "國泰 CUBE";
		(grid[37] ??= [])[15] = close + 2;
		grid[37]![16] = "中餐";
		grid[37]![17] = 120;
		grid[37]![18] = "國泰 Cube"; // case-insensitive, like Sheets' =
		const grown = auditCreditBuckets(grid, "9 月", 111).grown;
		expect(grown).toEqual(
			expect.arrayContaining([
				{ card: "國泰 CUBE", bucket: "結帳日前", rowsAdded: 1 },
				{ card: "國泰 CUBE", bucket: "結帳日後", rowsAdded: 1 },
			]),
		);
		// the USD cards' buckets never look at the lunch log
		expect(grown.filter((g) => g.card !== "國泰 CUBE")).toEqual([]);
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

/** Serves the trip grid for TRANSFER_JPY_GRID_READ reads, the month grid for FULL_GRID_READ reads, and `rate` for single cells. */
function jpyWiringClient(tripGrid: unknown[][], monthGrid: unknown[][], rate: unknown = 0.208): SheetsClient {
	return {
		readRange: vi.fn(async (range: string) =>
			range.includes(TRANSFER_JPY_GRID_READ)
				? { range, values: tripGrid, truncated: false }
				: range.includes(FULL_GRID_READ)
					? { range, values: monthGrid, truncated: false }
					: { range, values: [[rate]], truncated: false },
		),
		getSheetId: vi.fn(async () => 111),
		batchUpdate: vi.fn(async () => ({ replies: [{}] })),
	} as unknown as SheetsClient;
}

/** A month grid with the three NTD bank formulas at rows 58/61/62 (labels col B, formulas col D). */
function bankMonthGrid(): unknown[][] {
	const g: unknown[][] = [];
	for (let r = 0; r < 70; r++) g.push([]);
	g[57] = ["", "本月新臺幣支出", "", '=SUMIF(F3:F34,"TWD",E3:E34)+M42'];
	g[60] = ["", "保守預計本月底新臺幣餘額", "", "=D60+D57-D58-I42+IF(R42>0, 0, R42)+E4"];
	g[61] = ["", "本月底新臺幣餘額", "", "=D60+D57-D58-I42+D59+E4"];
	return g;
}

describe("addTransfer", () => {
	it("writes into the first empty row with the rate pinned", async () => {
		const client = transferClient(transferGrid());
		const result = await addTransfer(client, { ntd: 30000, usd: 1000, fee: 30, month: 9, date: "9/2" });

		// full month grid, not a shallow H–N window — the write also audits the 對帳區 below
		expect((client.readRange as any).mock.calls[0]).toEqual([`'9 月'!${FULL_GRID_READ}`, "FORMULA"]);
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
		// H–N only — a whole-row insert would tear the 銀行餘額 stack (B–D)
		// and lunch log (P–S) beside the section
		expect(batch1[0].insertRange).toEqual({
			range: { sheetId: 111, startRowIndex: 35, endRowIndex: 36, startColumnIndex: 7, endColumnIndex: 14 },
			shiftDimension: "ROWS",
		});
		expect(batch1.some((r: any) => r.insertDimension)).toBe(false);
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

	it("audits the 對帳區 below the transfer block, healing hand-entered overflow", async () => {
		const g = creditGrid();
		g[4] = [dateSerial(2026, 7, 10), "手填1", "訂閱", "", 100, "TWD", "國泰 Cube"];
		g[5] = [dateSerial(2026, 7, 10), "手填2", "訂閱", "", 100, "TWD", "國泰 Cube"];
		g[6] = [dateSerial(2026, 7, 10), "手填3", "訂閱", "", 100, "TWD", "國泰 Cube"];
		const client = transferClient(g);

		const result = await addTransfer(client, { ntd: 30000, usd: 1000, fee: 30, month: 9, date: "9/2" });

		// the audit rides the first (scratch) batch, in the read's coordinates
		const batch1 = (client.batchUpdate as any).mock.calls[0][0];
		const insert = batch1.find((r: any) => r.insertRange);
		expect(insert.insertRange.range).toMatchObject({ startRowIndex: CUBE_AT.pre.subtotalRow - 1, endRowIndex: CUBE_AT.pre.subtotalRow, startColumnIndex: 7 });
		expect((client.batchUpdate as any).mock.calls[1][0].some((r: any) => r.insertRange)).toBe(false);
		expect(result).toMatchObject({
			row: 35,
			bucketsGrown: [{ card: "國泰 CUBE", bucket: "結帳日前", rowsAdded: 1 }],
		});
	});

	it("runs the audit ahead of the transfer section's own insert, in the read's coordinates", async () => {
		const g = creditGrid();
		(g[34] ??= [])[7] = 46266; // the only data slot is taken → the write inserts above 總和
		(g[34] as unknown[])[8] = 30000;
		g[4] = [dateSerial(2026, 7, 10), "手填1", "訂閱", "", 100, "TWD", "國泰 Cube"];
		g[5] = [dateSerial(2026, 7, 10), "手填2", "訂閱", "", 100, "TWD", "國泰 Cube"];
		g[6] = [dateSerial(2026, 7, 10), "手填3", "訂閱", "", 100, "TWD", "國泰 Cube"];
		const client = transferClient(g);

		await addTransfer(client, { ntd: 15000, usd: 500, fee: 15, month: 9, date: "9/9" });

		// The bucket insert precedes the H–N insert above 總和, so it (and the
		// mirror text it rewrites) uses the read's rows; the transfer insert
		// then shifts the grown section down one, references and all. Nothing
		// structural is left for the second batch, which would otherwise be
		// working from a grid one row stale.
		const batch1 = (client.batchUpdate as any).mock.calls[0][0];
		const inserts = batch1.filter((r: any) => r.insertRange).map((r: any) => r.insertRange.range);
		expect(inserts).toEqual([
			expect.objectContaining({ startRowIndex: CUBE_AT.pre.subtotalRow - 1, endRowIndex: CUBE_AT.pre.subtotalRow, startColumnIndex: 7 }),
			expect.objectContaining({ startRowIndex: 35, endRowIndex: 36, startColumnIndex: 7 }),
		]);
		expect((client.batchUpdate as any).mock.calls[1][0].some((r: any) => r.insertRange)).toBe(false);
	});
});

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
		const client = jpyWiringClient(jpyTransferGrid(), bankMonthGrid(), 0.208);
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
			wiredMonthTab: "7 月",
		});
		expect(result.spotJpy).toBeCloseTo(100000, 2);
	});

	it("inserts A–G-scoped cells (never a whole row) when the section is full", async () => {
		const grid = jpyTransferGrid();
		grid[70] = [46266, 20000, "=B71/0.21", 95000, "=(C71-D71)*0.21", 100, "=E71+F71"];
		const client = jpyWiringClient(grid, bankMonthGrid(), 0.208);
		const result = await addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 10000, jpy: 47000, fee: 50, date: "7/12" });

		const batch1 = (client.batchUpdate as any).mock.calls[0][0];
		expect(batch1[0].insertRange).toEqual({
			range: { sheetId: 111, startRowIndex: 71, endRowIndex: 72, startColumnIndex: 0, endColumnIndex: 7 },
			shiftDimension: "ROWS",
		});
		expect(batch1.some((r: any) => r.insertDimension)).toBe(false);
		expect(result).toMatchObject({ row: 72, inserted: true, wiredMonthTab: "7 月" });
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

describe("addTransfer (jpy) month wiring", () => {
	const TRIP = "2026/07/25 京都東京";

	it("appends per-entry terms to the three NTD bank formulas of the date's month", async () => {
		const client = jpyWiringClient(jpyTransferGrid(), bankMonthGrid());
		const result = await addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 20800, jpy: 99000, fee: 150, date: "7/10" });

		expect(result.wiredMonthTab).toBe("7 月");
		// wiring read targets the month tab
		const reads = (client.readRange as any).mock.calls.map((c: any) => c[0]);
		expect(reads).toContain(`'7 月'!${FULL_GRID_READ}`);

		// last batchUpdate carries the three formula appends
		const wiring = (client.batchUpdate as any).mock.calls.at(-1)[0];
		const formulas = wiring.map((u: any) => ({
			row: u.updateCells.start.rowIndex + 1,
			f: u.updateCells.rows[0].values[0].userEnteredValue.formulaValue,
		}));
		expect(formulas).toEqual([
			{ row: 58, f: `=SUMIF(F3:F34,"TWD",E3:E34)+M42+'${TRIP}'!F71` },
			{ row: 61, f: `=D60+D57-D58-I42+IF(R42>0, 0, R42)+E4-'${TRIP}'!B71` },
			{ row: 62, f: `=D60+D57-D58-I42+D59+E4-'${TRIP}'!B71` },
		]);
		expect(wiring.every((u: any) => u.updateCells.start.columnIndex === 3)).toBe(true);
	});

	it("derives the month from the entry date, not from today", async () => {
		const client = jpyWiringClient(jpyTransferGrid(), bankMonthGrid());
		const result = await addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 100, jpy: 470, fee: 0, date: "2026-08-02" });
		expect(result.wiredMonthTab).toBe("8 月");
		expect((client.readRange as any).mock.calls.map((c: any) => c[0])).toContain(`'8 月'!${FULL_GRID_READ}`);
	});

	it("names the already-written trip row when a bank label is missing", async () => {
		const month = bankMonthGrid();
		month[60] = []; // 保守預計 gone
		const client = jpyWiringClient(jpyTransferGrid(), month);
		await expect(
			addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 100, jpy: 470, fee: 0, date: "7/10" }),
		).rejects.toThrow(/A71.*already written|already written.*A71/s);
	});

	it("refuses to touch a non-formula bank cell", async () => {
		const month = bankMonthGrid();
		(month[57] as unknown[])[3] = 12345; // a raw number where a formula should be
		const client = jpyWiringClient(jpyTransferGrid(), month);
		await expect(
			addTransfer(client, { currency: "jpy", tab: TRIP, ntd: 100, jpy: 470, fee: 0, date: "7/10" }),
		).rejects.toThrow(/本月新臺幣支出/);
	});
});

/** Like fakeClient, but the post-write 編列預算/剩餘 read-back returns `budgetRow`. */
function lunchClient(grid: unknown[][], budgetRow: unknown[] = [3900, "", 3547]): SheetsClient {
	return {
		readRange: vi.fn(async (range: string) =>
			range.includes(FULL_GRID_READ)
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

		expect((client.readRange as any).mock.calls[0]).toEqual([`'9 月'!${FULL_GRID_READ}`, "FORMULA"]);
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
		// P–S only — a whole-row insert would tear the 對帳區 (H–N) and the
		// 銀行餘額 stack (B–D) beside the log
		expect(requests[0].insertRange).toEqual({
			range: { sheetId: 111, startRowIndex: 37, endRowIndex: 38, startColumnIndex: 15, endColumnIndex: 19 },
			shiftDimension: "ROWS",
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
			const insert = requests.find((r: any) => r.insertRange);
			expect(insert.insertRange).toEqual({
				range: { sheetId: 111, startRowIndex: CUBE_AT.pre.subtotalRow - 1, endRowIndex: CUBE_AT.pre.subtotalRow, startColumnIndex: 7, endColumnIndex: 14 },
				shiftDimension: "ROWS",
			});
			expect(result).toMatchObject({ bucket: "結帳日前", bucketRowsAdded: 1 });
		});

		it("does NOT shift the card bucket insert for the lunch section's own insert — it is band-scoped to P–S", async () => {
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
			const lunchInsert = requests.find((r: any) => r.insertRange && r.insertRange.range.startColumnIndex === 15);
			expect(lunchInsert).toBeDefined();
			// the P–S lunch insert leaves H–N untouched, so the bucket insert
			// lands at the same row as it would with a free lunch slot
			const bucketInsert = requests.find((r: any) => r.insertRange && r.insertRange.range.startColumnIndex === 7);
			expect(bucketInsert.insertRange).toEqual({
				range: { sheetId: 111, startRowIndex: CUBE_AT.pre.subtotalRow - 1, endRowIndex: CUBE_AT.pre.subtotalRow, startColumnIndex: 7, endColumnIndex: 14 },
				shiftDimension: "ROWS",
			});
			expect(requests.some((r: any) => r.insertDimension)).toBe(false);
			// the audit precedes the log's own insert (structural edits follow it)
			expect(requests.indexOf(bucketInsert)).toBeLessThan(requests.indexOf(lunchInsert));
			expect(result).toMatchObject({ bucketRowsAdded: 1 });
		});

		it("skips the guard when no card is given", async () => {
			const client = fakeClient(creditGrid());
			const result = await addLunch(client, { amount: 100, month: 9, date: "7/10" });
			expect(result.bucket).toBeNull();
			expect(result.bucketRowsAdded).toBe(0);
			expect(result.bucketWarning).toBeUndefined();
		});

		it("audits every bucket on a cash lunch, healing hand-entered overflow", async () => {
			const g = creditGrid();
			g[4] = [dateSerial(2026, 7, 10), "手填1", "訂閱", "", 100, "TWD", "國泰 Cube"];
			g[5] = [dateSerial(2026, 7, 10), "手填2", "訂閱", "", 100, "TWD", "國泰 Cube"];
			g[6] = [dateSerial(2026, 7, 10), "手填3", "訂閱", "", 100, "TWD", "國泰 Cube"];
			const client = fakeClient(g);
			const result = await addLunch(client, { amount: 100, month: 9, date: "9/2" });
			const requests = (client.batchUpdate as any).mock.calls[0][0];
			const insert = requests.find((r: any) => r.insertRange && r.insertRange.range.startColumnIndex === 7);
			expect(insert.insertRange.range).toMatchObject({ startRowIndex: CUBE_AT.pre.subtotalRow - 1, endRowIndex: CUBE_AT.pre.subtotalRow });
			expect(result).toMatchObject({
				bucket: null,
				bucketsGrown: [{ card: "國泰 CUBE", bucket: "結帳日前", rowsAdded: 1 }],
			});
		});
	});
});

describe("addExpense", () => {
	it("writes a TWD expense into the first empty window row", async () => {
		const client = fakeClient(monthGrid());

		const result = await addExpense(client, { item: "晚餐", amount: 250, currency: "TWD", month: 9 });

		expect((client.readRange as any).mock.calls[0]).toEqual([`'9 月'!${FULL_GRID_READ}`, "FORMULA"]);
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
		// move the shifted old last row up over the new row — a destination
		// past the range end would shrink the ranges
		expect(requests.at(-1)).toEqual({
			moveDimension: {
				source: { sheetId: 111, dimension: "ROWS", startIndex: 10, endIndex: 11 },
				destinationIndex: 9,
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
				source: { sheetId: 111, dimension: "ROWS", startIndex: 10, endIndex: 11 },
				destinationIndex: 9,
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
				source: { sheetId: 111, dimension: "ROWS", startIndex: 8, endIndex: 9 },
				destinationIndex: 7,
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
		expect(requests.some((r: any) => r.insertDimension || r.insertRange)).toBe(false);
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
			expect(requests.some((r: any) => r.insertDimension || r.insertRange)).toBe(false);
			// even a no-growth write stamps the spill area's formats (rows 47-48)
			expect(requests).toEqual(expect.arrayContaining(bucketFormatStamps(46, 48, 7, "[$NTD ]#,##0.00")));
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
			const insert = requests.find((r: any) => r.insertRange);
			// H–N only — the 銀行餘額 stack (B–D) and lunch log (P–S) beside
			// the grid must not move
			expect(insert.insertRange).toEqual({
				range: { sheetId: 111, startRowIndex: CUBE_AT.pre.subtotalRow - 1, endRowIndex: CUBE_AT.pre.subtotalRow, startColumnIndex: 7, endColumnIndex: 14 },
				shiftDimension: "ROWS",
			});
			// the stamps cover the grown spill area (rows 47-49) — the inserted
			// row inherits from the blank cushion row and would render raw
			expect(requests).toEqual(expect.arrayContaining(bucketFormatStamps(CUBE_AT.pre.headerRow, CUBE_AT.pre.subtotalRow, 7, "[$NTD ]#,##0.00")));
			expect(result).toMatchObject({ bucket: "結帳日前", bucketRowsAdded: 1 });
		});

		it("runs the bucket audit ahead of the expense row's own insert, in the read's coordinates", async () => {
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
			// The audit goes FIRST, so its rows are the read's rows: the mirror
			// it lifts and rewrites must carry formula text that is still exact
			// when written. The expense window's whole-row insert comes after
			// and shifts the grown section (and every reference) down one.
			const bucketAt = requests.findIndex((r: any) => r.insertRange);
			const rowAt = requests.findIndex((r: any) => r.insertDimension);
			expect(bucketAt).toBeLessThan(rowAt);
			expect(requests[bucketAt].insertRange).toEqual({
				range: { sheetId: 111, startRowIndex: CUBE_AT.pre.subtotalRow - 1, endRowIndex: CUBE_AT.pre.subtotalRow, startColumnIndex: 7, endColumnIndex: 14 },
				shiftDimension: "ROWS",
			});
			expect(requests.slice(bucketAt + 1, rowAt)).toContainEqual(
				mirrorWrite(CUBE_AT.pre.headerRow + 1, 7, g[CUBE_AT.pre.headerRow]![7] as string),
			);
			expect(requests.slice(0, rowAt)).toEqual(
				expect.arrayContaining(bucketFormatStamps(CUBE_AT.pre.headerRow, CUBE_AT.pre.subtotalRow, 7, "[$NTD ]#,##0.00")),
			);
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
			expect(requests.some((r: any) => r.insertRange)).toBe(true);
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
			const insert = requests.find((r: any) => r.insertRange);
			expect(insert.insertRange).toEqual({
				range: { sheetId: 111, startRowIndex: CUBE_AT.post.subtotalRow - 1, endRowIndex: CUBE_AT.post.subtotalRow, startColumnIndex: 7, endColumnIndex: 14 },
				shiftDimension: "ROWS",
			});
			// the stamps target the 結帳日後 bucket's own spill area
			expect(requests).toEqual(expect.arrayContaining(bucketFormatStamps(CUBE_AT.post.headerRow, CUBE_AT.post.subtotalRow, 7, "[$NTD ]#,##0.00")));
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

		/** creditGrid + an Apple Card block (結帳日 7/31) stacked below 國泰 CUBE in H/I/J. */
		function appleGrid(): unknown[][] {
			const g = creditGrid();
			putCardBlock(g, creditGridAnchors()["國泰 CUBE"]!.nextTitleRow, {
				name: "Apple Card",
				col: 7,
				close: dateSerial(2026, 7, 31),
				pay: dateSerial(2026, 7, 31),
				due: "='6 月'!J65+'5 月'!J71",
				preSpill: 2,
				postSpill: 2,
			});
			return g;
		}

		it("places an Apple Card entry dated ON the 結帳日 into 結帳日前 — its calendar-month statement includes the close date", async () => {
			const client = fakeClient(appleGrid());
			const result = await addExpense(client, {
				item: "Cursor",
				amount: 20,
				currency: "USD",
				month: 9,
				date: "7/31", // the Apple Card block's 結帳日
				card: "Apple Card",
			});
			expect(result).toMatchObject({ bucket: "結帳日前" });
		});

		it("places an Apple Card entry dated after the 結帳日 into 結帳日後", async () => {
			const client = fakeClient(appleGrid());
			const result = await addExpense(client, {
				item: "iCloud",
				amount: 9.99,
				currency: "USD",
				month: 9,
				date: "8/1",
				card: "Apple Card",
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
			expect(requests.some((r: any) => r.insertDimension || r.insertRange)).toBe(false);
			// USD-billed card → the 金額 column stamps the $ pattern, in the L-N block
			expect(requests).toEqual(expect.arrayContaining(bucketFormatStamps(46, 48, 11, '"$"#,##0.00')));
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
			expect(requests.some((r: any) => r.insertDimension || r.insertRange)).toBe(false);
			expect(requests.some((r: any) => r.repeatCell)).toBe(false);
			expect(result.bucket).toBeNull();
			expect(result.bucketRowsAdded).toBe(0);
			expect(result.bucketWarning).toBeUndefined();
		});

		it("audits every bucket on a dateless non-card write, healing hand-entered overflow", async () => {
			const g = creditGrid();
			// three hand-entered CUBE rows — one over the 結帳日前 spill area,
			// and none of them ever triggered the pending-entry guard
			g[4] = [dateSerial(2026, 7, 10), "手填1", "訂閱", "", 100, "TWD", "國泰 Cube"];
			g[5] = [dateSerial(2026, 7, 10), "手填2", "訂閱", "", 100, "TWD", "國泰 Cube"];
			g[6] = [dateSerial(2026, 7, 10), "手填3", "訂閱", "", 100, "TWD", "國泰 Cube"];
			const client = fakeClient(g);
			const result = await addExpense(client, { item: "Netflix", amount: 390, currency: "TWD", month: 9 });
			const requests = (client.batchUpdate as any).mock.calls[0][0];
			const insert = requests.find((r: any) => r.insertRange);
			expect(insert.insertRange).toEqual({
				range: { sheetId: 111, startRowIndex: CUBE_AT.pre.subtotalRow - 1, endRowIndex: CUBE_AT.pre.subtotalRow, startColumnIndex: 7, endColumnIndex: 14 },
				shiftDimension: "ROWS",
			});
			expect(result).toMatchObject({
				bucket: null,
				bucketRowsAdded: 0,
				bucketsGrown: [{ card: "國泰 CUBE", bucket: "結帳日前", rowsAdded: 1 }],
			});
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
			(g[creditGridAnchors()["國泰 CUBE"]!.dueRow - 1] as unknown[])[7] = ""; // CUBE loses its 本月需繳款 label -> findCreditSection throws
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

	it("heals a bucket a hand edit already overflowed (#REF!): the mirror is lifted around the growth insert", async () => {
		// 9 月 2026: G61 set to 國泰 CUBE by hand pushed 結帳日後 one row past
		// its spill area; set_expense_date on that row then had its H–N insert
		// at the 小計 row refused ("cannot insert or delete cells over an
		// array formula") because the #REF! mirror's footprint runs through it.
		const g = creditGrid();
		g[4] = [dateSerial(2026, 7, 25), "既有1", "訂閱", "", 100, "TWD", "國泰 CUBE"];
		g[5] = [dateSerial(2026, 7, 25), "既有2", "訂閱", "", 100, "TWD", "國泰 CUBE"];
		g[6] = [dateSerial(2026, 7, 30), "Claude", "訂閱", "", 6689, "TWD", "國泰 CUBE"];
		const mirror = g[CUBE_AT.post.headerRow]![7] as string;
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Claude", date: "7/30", month: 9, row: 7 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		const insertAt = requests.findIndex((r: any) => r.insertRange);
		expect(requests[insertAt].insertRange.range).toMatchObject({
			startRowIndex: CUBE_AT.post.subtotalRow - 1,
			endRowIndex: CUBE_AT.post.subtotalRow,
			startColumnIndex: 7,
			endColumnIndex: 14,
		});
		expect(requests.slice(0, insertAt)).toContainEqual(mirrorWrite(CUBE_AT.post.headerRow + 1, 7, null));
		expect(requests.slice(insertAt + 1)).toContainEqual(mirrorWrite(CUBE_AT.post.headerRow + 1, 7, mirror));
		expect(result).toMatchObject({ bucket: "結帳日後", bucketRowsAdded: 1 });
	});

	it("dates a dateless row and returns previousDate null", async () => {
		const client = fakeClient(dateGrid());
		const result = await setExpenseDate(client, { item: "Netflix", date: "7/10", month: 9 });

		expect((client.readRange as any).mock.calls[0]).toEqual([`'9 月'!${FULL_GRID_READ}`, "FORMULA"]);
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
		const insert = requests.find((r: any) => r.insertRange);
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
		expect(requests.some((r: any) => r.insertDimension || r.insertRange)).toBe(false);
		expect(result).toMatchObject({ bucket: "結帳日前", bucketRowsAdded: 0 });
	});

	it("warns and skips the guard when 支付方式 holds an unknown value", async () => {
		const g = dateGrid();
		(g[6] as unknown[])[6] = "玉山 Ubear";
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/10", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests.some((r: any) => r.insertDimension || r.insertRange)).toBe(false);
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

	it("audits every bucket when dating a no-支付方式 row, healing hand-entered overflow", async () => {
		const g = dateGrid();
		g[4] = [dateSerial(2026, 7, 10), "手填1", "訂閱", "", 100, "TWD", "國泰 Cube"];
		g[5] = [dateSerial(2026, 7, 10), "手填2", "訂閱", "", 100, "TWD", "國泰 Cube"];
		g[7] = [dateSerial(2026, 7, 10), "手填3", "訂閱", "", 100, "TWD", "國泰 Cube"];
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/5", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		const insert = requests.find((r: any) => r.insertRange);
		expect(insert.insertRange.range).toMatchObject({ startRowIndex: CUBE_AT.pre.subtotalRow - 1, endRowIndex: CUBE_AT.pre.subtotalRow, startColumnIndex: 7 });
		expect(result).toMatchObject({
			card: null,
			bucket: null,
			bucketsGrown: [{ card: "國泰 CUBE", bucket: "結帳日前", rowsAdded: 1 }],
		});
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

	it("moves the displaced block up when the dated row must become the last list row", async () => {
		const g = dateGrid();
		g[7] = [dateSerial(2026, 7, 2), "甲", "吃喝", "", 10, "TWD", ""]; // row 8
		g[8] = [dateSerial(2026, 7, 3), "乙", "吃喝", "", 11, "TWD", ""]; // row 9
		g[9] = [dateSerial(2026, 7, 4), "丙", "吃喝", "", 12, "TWD", ""]; // row 10 — window full
		const client = fakeClient(g);

		const result = await setExpenseDate(client, { item: "Netflix", date: "7/10", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// target = 11 (past every dated row) > windowEnd 10 — a direct move
		// there would shrink the window ranges, so rows 8-10 move up instead
		expect(requests.at(-1)).toEqual({
			moveDimension: {
				source: { sheetId: 111, dimension: "ROWS", startIndex: 7, endIndex: 10 },
				destinationIndex: 6,
			},
		});
		expect(result).toMatchObject({ row: 7, movedToRow: 10 });
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

	it("audits against a FORMULA render, so a lifted mirror is rewritten as its formula, never its #REF! value", async () => {
		const formulas = gridWithNumbers();
		formulas[4] = [dateSerial(2026, 7, 10), "手填1", "訂閱", "", 100, "TWD", "國泰 Cube"];
		formulas[5] = [dateSerial(2026, 7, 10), "手填2", "訂閱", "", 100, "TWD", "國泰 Cube"];
		formulas[6] = [dateSerial(2026, 7, 10), "手填3", "訂閱", "", 100, "TWD", "國泰 Cube"];
		const mirrorRow = CUBE_AT.pre.headerRow + 1;
		const mirror = formulas[mirrorRow - 1]![7] as string;
		// what the op's UNFORMATTED read sees in the same cells
		const rendered = formulas.map((row) => (row ? [...row] : row));
		(rendered[mirrorRow - 1] as unknown[])[7] = "#REF!";
		const client = {
			readRange: vi.fn(async (_range: string, mode: string) => ({
				range: "x",
				values: mode === "FORMULA" ? formulas : rendered,
				truncated: false,
			})),
			getSheetId: vi.fn(async () => 111),
			batchUpdate: vi.fn(async () => ({ replies: [{}] })),
		} as unknown as SheetsClient;

		await adjustBalance(client, { currency: "TWD", actual: 450, month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toContainEqual(mirrorWrite(mirrorRow, 7, mirror));
		expect(JSON.stringify(requests)).not.toContain("#REF!");
	});

	it("audits the 對帳區 alongside the 調整 write, healing hand-entered overflow", async () => {
		const g = gridWithNumbers();
		g[4] = [dateSerial(2026, 7, 10), "手填1", "訂閱", "", 100, "TWD", "國泰 Cube"];
		g[5] = [dateSerial(2026, 7, 10), "手填2", "訂閱", "", 100, "TWD", "國泰 Cube"];
		g[6] = [dateSerial(2026, 7, 10), "手填3", "訂閱", "", 100, "TWD", "國泰 Cube"];
		const client = fakeClient(g);

		const result = await adjustBalance(client, { currency: "TWD", actual: 450, month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].updateCells.start).toEqual({ sheetId: 111, rowIndex: 43, columnIndex: 3 });
		const insert = requests.find((r: any) => r.insertRange);
		expect(insert.insertRange.range).toMatchObject({ startRowIndex: CUBE_AT.pre.subtotalRow - 1, endRowIndex: CUBE_AT.pre.subtotalRow, startColumnIndex: 7 });
		expect(result).toMatchObject({
			adjustment: -50,
			bucketsGrown: [{ card: "國泰 CUBE", bucket: "結帳日前", rowsAdded: 1 }],
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

		expect((client.readRange as any).mock.calls[0]).toEqual([`'10 月'!${FULL_GRID_READ}`, "FORMULA"]);
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
		const anchors = creditGridAnchors();
		const cube = anchors["國泰 CUBE"]!;
		const amazon = anchors["CHASE Amazon"]!;
		const client = startMonthClient(creditGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		const at = (row: number, columnIndex: number) =>
			requests.find(
				(r: any) => r.updateCells && r.updateCells.start.rowIndex === row - 1 && r.updateCells.start.columnIndex === columnIndex,
			);
		// 國泰 CUBE (values in J = column 9): dates bumped 7/19→8/19, 7/6→8/6.
		expect(at(cube.closeDateRow, 9).updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { numberValue: dateSerial(2026, 8, 19) } },
		]);
		expect(at(cube.payDateRow, 9).updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { numberValue: dateSerial(2026, 8, 6) } },
		]);
		// lag 1: 本月需繳款 = prev tab's 結帳日前小計 + prev-prev tab's 結帳日後小計.
		expect(at(cube.dueRow, 9).updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: `='9 月'!J${cube.pre.subtotalRow}+'8 月'!J${cube.post.subtotalRow}` } },
		]);
		// CHASE Amazon (values in N = column 13), lag 0: 本月需繳款 = this tab's 結帳日前小計 + prev tab's 結帳日後小計.
		expect(at(amazon.dueRow, 13).updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: `=N${amazon.pre.subtotalRow}+'9 月'!N${amazon.post.subtotalRow}` } },
		]);
		// No 本期帳單總額 row exists anymore — only the two date bumps plus the single due write per card.
		expect(requests.filter((r: any) => r.updateCells && r.updateCells.start.columnIndex === 9)).toHaveLength(3);
		expect(requests.filter((r: any) => r.updateCells && r.updateCells.start.columnIndex === 13)).toHaveLength(3);
		expect(result.creditRebuilt).toEqual(["國泰 CUBE", "CHASE Amazon"]);
		expect(result.creditWarning).toBeUndefined();
	});

	it("wires all four cards' 本月需繳款 to their own scanned 小計 rows, whatever the spills are", async () => {
		// Each card's buckets are a different length here, so a lag rule that
		// leaned on a shared or offset-derived 小計 row would point at the wrong
		// cell for at least one card.
		const { grid, at } = fourCardGrid({
			"國泰 CUBE": [15, 4],
			"CHASE Amazon": [2, 33],
			"CHASE Freedom": [7, 9],
			"Apple Card": [21, 2],
		});
		const client = startMonthClient(grid, ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		expect(result.creditRebuilt).toEqual([...CARD_NAMES]);
		for (const card of CARD_NAMES) {
			const a = at[card]!;
			const col = a.startCol + 2;
			const letter = colLetter(col);
			const write = requests.find(
				(r: any) => r.updateCells && r.updateCells.start.rowIndex === a.dueRow - 1 && r.updateCells.start.columnIndex === col,
			);
			expect(write.updateCells.rows[0].values[0].userEnteredValue.formulaValue).toBe(
				// CHASE Amazon is the only statementLag 0 card.
				card === "CHASE Amazon"
					? `=${letter}${a.pre.subtotalRow}+'9 月'!${letter}${a.post.subtotalRow}`
					: `='9 月'!${letter}${a.pre.subtotalRow}+'8 月'!${letter}${a.post.subtotalRow}`,
			);
		}
	});

	it("omits the prev-prev term when that tab doesn't exist in the spreadsheet", async () => {
		const cube = creditGridAnchors()["國泰 CUBE"]!;
		const client = startMonthClient(creditGrid(), ["9 月"]);

		const result = await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		const write = requests.find(
			(r: any) => r.updateCells && r.updateCells.start.rowIndex === cube.dueRow - 1 && r.updateCells.start.columnIndex === 9,
		);
		expect(write.updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: `='9 月'!J${cube.pre.subtotalRow}` } },
		]);
		expect(result.creditRebuilt).toEqual(["國泰 CUBE", "CHASE Amazon"]);
	});

	it("pads every bucket's spill area to CREDIT_BUCKET_PAD_ROWS blank rows at month open", async () => {
		const cube = creditGridAnchors()["國泰 CUBE"]!;
		const pad = CREDIT_BUCKET_PAD_ROWS - 2; // the fixture's buckets already hold 2
		const client = startMonthClient(creditGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		const inserts = requests.filter((r: any) => r.insertRange).map((r: any) => r.insertRange.range);
		// both cards' 小計 rows align, so one H–N insert per bucket row
		// (bottom-up) pads both card columns at once
		expect(inserts).toEqual([
			{
				sheetId: 555,
				startRowIndex: cube.post.subtotalRow - 1,
				endRowIndex: cube.post.subtotalRow - 1 + pad,
				startColumnIndex: 7,
				endColumnIndex: 14,
			},
			{
				sheetId: 555,
				startRowIndex: cube.pre.subtotalRow - 1,
				endRowIndex: cube.pre.subtotalRow - 1 + pad,
				startColumnIndex: 7,
				endColumnIndex: 14,
			},
		]);
		// the pads land AFTER the 本月需繳款 rewires, so those just-written
		// formulas' 小計 references shift down in lockstep with the inserts
		const dueWriteIdx = requests.findIndex(
			(r: any) => r.updateCells && r.updateCells.start.rowIndex === cube.dueRow - 1 && r.updateCells.start.columnIndex === 9,
		);
		const firstInsertIdx = requests.findIndex((r: any) => r.insertRange);
		expect(dueWriteIdx).toBeGreaterThanOrEqual(0);
		expect(firstInsertIdx).toBeGreaterThan(dueWriteIdx);
		expect(result.creditPadded).toEqual([
			{ card: "國泰 CUBE", bucket: "結帳日後", rowsAdded: pad },
			{ card: "國泰 CUBE", bucket: "結帳日前", rowsAdded: pad },
		]);
	});

	it("pads a month whose cards' spills are already past the pad without touching them", async () => {
		const { grid, at } = fourCardGrid({
			"國泰 CUBE": [CREDIT_BUCKET_PAD_ROWS + 5, CREDIT_BUCKET_PAD_ROWS + 5],
			"CHASE Amazon": [CREDIT_BUCKET_PAD_ROWS + 5, CREDIT_BUCKET_PAD_ROWS + 5],
			"CHASE Freedom": [1, CREDIT_BUCKET_PAD_ROWS],
			"Apple Card": [1, CREDIT_BUCKET_PAD_ROWS],
		});
		const client = startMonthClient(grid, ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		// only CHASE Freedom's 結帳日前 (1 row) is under the pad; its aligned twin
		// Apple Card gains the same rows from the shared band insert
		expect(result.creditPadded).toEqual([
			{ card: "CHASE Freedom", bucket: "結帳日前", rowsAdded: CREDIT_BUCKET_PAD_ROWS - 1 },
		]);
		const inserts = (client.batchUpdate as any).mock.calls[1][0]
			.filter((r: any) => r.insertRange)
			.map((r: any) => r.insertRange.range.startRowIndex);
		expect(inserts).toEqual([at["CHASE Freedom"]!.pre.subtotalRow - 1]);
	});

	it("skips the credit rebuild silently on tabs without the section", async () => {
		const client = startMonthClient(lunchGrid(), ["9 月", "8 月"]);
		const result = await startMonth(client, 10);
		expect(result.creditRebuilt).toEqual([]);
		expect(result.creditWarning).toBeUndefined();
		expect(result.creditPadded).toBeUndefined();
	});

	it("surfaces a torn credit block as a warning instead of failing the month-open", async () => {
		const g = creditGrid();
		(g[creditGridAnchors()["國泰 CUBE"]!.dueRow - 1] as unknown[])[7] = ""; // CUBE loses 本月需繳款
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

		expect((client.readRange as any).mock.calls[0]).toEqual([`'9 月'!${FULL_GRID_READ}`, "FORMULA"]);
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
				// B–D only — a whole-row insert would tear the 乾坤大挪移/對帳區
				// grids (H–N) and lunch log (P–S) beside the income list
				insertRange: {
					range: { sheetId: 111, startRowIndex: 16, endRowIndex: 17, startColumnIndex: 1, endColumnIndex: 4 },
					shiftDimension: "ROWS",
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

	it("finds the income list even when the expense window has pushed it past row 60", async () => {
		// Live July 2026 layout: 57 expense rows put 花費總額 at row 60 and
		// 總預算 at 62 — the old A1:H60 read window missed every anchor.
		const g: unknown[][] = [];
		g[0] = ["7 月花費"];
		g[1] = ["日期", "項目", "類別", "美金", "新臺幣", "支付幣別", "支付方式"];
		g[2] = ["", "上月美金透支", "透支", 0, "", "USD"];
		g[59] = ["", "", "", "花費總額", "=SUM(E3:E59)"];
		g[61] = ["", "總預算"];
		g[62] = ["", "項目", "幣別", "金額"];
		g[63] = ["", "沛還", "USD", 800];
		g[64] = ["", "薪水", "TWD", 68587];
		g[65] = ["", "多一個月薪水", "TWD", 68587];
		g[67] = ["", "本月美金收支狀況", "", "=D71-D72"];
		g[70] = ["", "本月美金收入", "", '=SUMIF(C63:C66,"USD",D63:D66)'];
		const client = fakeClient(g);

		const result = await setIncome(client, { item: "發票中獎", amount: 1000, currency: "TWD", month: 7 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		// Rows 64-66 are all occupied → band insert at the SUMIF window's last row (66).
		expect(requests[0]).toEqual({
			insertRange: {
				range: { sheetId: 111, startRowIndex: 65, endRowIndex: 66, startColumnIndex: 1, endColumnIndex: 4 },
				shiftDimension: "ROWS",
			},
		});
		expect(result).toMatchObject({ tab: "7 月", row: 66, action: "inserted" });
	});

	it("reuses a row whose income cells are empty even when neighbouring sections occupy it", async () => {
		const g = currentMonthGrid();
		g[16] = ["", "", "", "", "", "", "", "乾坤大挪移"]; // B–D empty; H holds the transfer title
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

	it("audits the 對帳區 on an income write, healing hand-entered overflow", async () => {
		const g = creditGrid();
		g[4] = [dateSerial(2026, 7, 10), "手填1", "訂閱", "", 100, "TWD", "國泰 Cube"];
		g[5] = [dateSerial(2026, 7, 10), "手填2", "訂閱", "", 100, "TWD", "國泰 Cube"];
		g[6] = [dateSerial(2026, 7, 10), "手填3", "訂閱", "", 100, "TWD", "國泰 Cube"];
		const client = fakeClient(g);

		const result = await setIncome(client, { item: "薪水", amount: 70000, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		const insert = requests.find((r: any) => r.insertRange && r.insertRange.range.startColumnIndex === 7);
		expect(insert.insertRange.range).toMatchObject({ startRowIndex: CUBE_AT.pre.subtotalRow - 1, endRowIndex: CUBE_AT.pre.subtotalRow });
		expect(result).toMatchObject({
			action: "updated",
			bucketsGrown: [{ card: "國泰 CUBE", bucket: "結帳日前", rowsAdded: 1 }],
		});
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

describe("deleteExpense", () => {
	/** creditGrid with three 國泰 CUBE charges (rows 6-8) inside the 結帳日前 bucket's 2-row spill. */
	function cardChargeGrid(count: number): unknown[][] {
		const g = creditGrid();
		for (let i = 0; i < count; i++) {
			g[5 + i] = [dateSerial(2026, 7, 3 + i), `刷卡${i + 1}`, "購物", "", 100, "TWD", "國泰 Cube"];
		}
		return g;
	}

	it("deletes the row scoped to the expense band and returns the cells", async () => {
		const client = fakeClient(currentMonthGrid());

		const result = await deleteExpense(client, { item: "電話費", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0]).toEqual({
			deleteRange: {
				range: { sheetId: 111, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 0, endColumnIndex: 7 },
				shiftDimension: "ROWS",
			},
		});
		expect(result).toMatchObject({
			tab: "9 月",
			row: 6,
			item: "電話費",
			card: null,
			deleted: [dateSerial(2026, 7, 1), "電話費", "生活用品", "", 1261, "TWD"],
		});
	});

	it("refuses the formula-owned 上月…透支 carry rows", async () => {
		const client = fakeClient(currentMonthGrid());
		await expect(deleteExpense(client, { item: "上月美金透支", month: 9 })).rejects.toThrow("carry row");
		await expect(deleteExpense(client, { item: "上月新臺幣透支", month: 9 })).rejects.toThrow("carry row");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("refuses an item that is not in the expense window", async () => {
		const client = fakeClient(currentMonthGrid());
		await expect(deleteExpense(client, { item: "薪水", month: 9 })).rejects.toThrow("No \"薪水\" row");
		await expect(deleteExpense(client, { item: "沒有這個", month: 9 })).rejects.toThrow("expense window");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("never guesses between duplicate 項目 rows — row picks one", async () => {
		const g = currentMonthGrid();
		g[6] = ["", "電話費", "生活用品", "", 999, "TWD"];
		const client = fakeClient(g);

		await expect(deleteExpense(client, { item: "電話費", month: 9 })).rejects.toThrow("rows 6, 7");
		await expect(deleteExpense(client, { item: "電話費", month: 9, row: 9 })).rejects.toThrow("not one of");

		const result = await deleteExpense(client, { item: "電話費", month: 9, row: 7 });
		expect(result.row).toBe(7);
	});

	it("refuses a row the 午餐預算 block's 編列預算 points straight at", async () => {
		const client = fakeClient(lunchGrid()); // P35 = "=E5", the 中餐 budget link

		await expect(deleteExpense(client, { item: "Google Cloud", month: 9 })).rejects.toThrow(/#REF!.*P35/);
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});

	it("refuses when the expense window is a single row", async () => {
		const g = currentMonthGrid();
		g[10] = ["", "", "", "花費總額", "=SUM(E5:E5)"];
		const client = fakeClient(g);

		await expect(deleteExpense(client, { item: "Google Cloud", month: 9 })).rejects.toThrow("single row");
	});

	it("audits the 對帳區 against the POST-delete grid: the removed charge stops counting", async () => {
		const client = fakeClient(cardChargeGrid(3)); // 3 charges, 2-row spill

		const result = await deleteExpense(client, { item: "刷卡3", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toHaveLength(1); // the delete alone: 2 charges left, 2 rows of spill
		expect(result.bucketsGrown).toBeUndefined();
	});

	it("still heals a bucket that overflows without the deleted row", async () => {
		const client = fakeClient(cardChargeGrid(4)); // 4 charges, 2-row spill

		const result = await deleteExpense(client, { item: "刷卡4", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		const insert = requests.find((r: any) => r.insertRange);
		expect(insert.insertRange.range).toMatchObject({
			startRowIndex: CUBE_AT.pre.subtotalRow - 1,
			endRowIndex: CUBE_AT.pre.subtotalRow,
			startColumnIndex: 7,
		});
		// the audit runs before the row's own delete, in the read's coordinates
		expect(requests.indexOf(insert)).toBeLessThan(requests.findIndex((r: any) => r.deleteRange));
		expect(result).toMatchObject({
			card: "國泰 Cube",
			bucketsGrown: [{ card: "國泰 CUBE", bucket: "結帳日前", rowsAdded: 1 }],
		});
	});

	it("refuses to operate on a truncated read", async () => {
		const client = fakeClient(currentMonthGrid());
		(client.readRange as any).mockResolvedValue({ range: "x", values: currentMonthGrid(), truncated: true });
		await expect(deleteExpense(client, { item: "電話費", month: 9 })).rejects.toThrow("truncated");
		expect((client.batchUpdate as any).mock.calls).toHaveLength(0);
	});
});
