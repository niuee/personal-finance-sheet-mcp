import { describe, expect, it } from "vitest";
import {
	BUDGET_HEADER_LABEL,
	CONVENTIONS_TEXT,
	currentMonthTab,
	dateSerial,
	KNOWN_TAGS,
	LUNCH_ADJUST_LABEL,
	LUNCH_COLS,
	LUNCH_DEFAULT_ITEM,
	LUNCH_SECTION_LABEL,
	LUNCH_TOTAL_LABEL,
	MONTH_COLS,
	MONTH_NTD_NET_LABEL,
	MONTH_REMAINDER_LABEL,
	MONTH_USD_NET_LABEL,
	monthTabName,
	NTD_PAYMENT_LABEL,
	parseDateInput,
	OVERDRAFT_LABEL,
	PREV_NTD_OVERDRAFT_LABEL,
	PREV_USD_OVERDRAFT_LABEL,
	previousMonth,
	RECURRING_INCOME,
	RECURRING_ITEMS,
	REMAINDER_LABEL,
	REPAYMENT_LABEL,
	SALARY_LABEL,
	serialToIso,
	todaySerial,
	TOTAL_NTD_BALANCE_LABEL,
	TOTAL_ROW_LABEL,
	TOTAL_USD_BALANCE_LABEL,
	TRIP_HEADER_DATE,
	TRIP_HEADER_SHOP,
	TRIP_MAX_BLOCK_ROWS,
	TRIP_TOTAL_LABEL,
	USD_PAYMENT_LABEL,
	USD_WRITEOFF_LABEL,
	NTD_WRITEOFF_LABEL,
} from "../src/conventions";

describe("conventions", () => {
	it("builds month tab names with the space Vincent uses", () => {
		expect(monthTabName(9)).toBe("9 月");
		expect(monthTabName(12)).toBe("12 月");
	});

	it("rejects invalid months", () => {
		expect(() => monthTabName(0)).toThrow("Invalid month");
		expect(() => monthTabName(13)).toThrow("Invalid month");
		expect(() => monthTabName(1.5)).toThrow("Invalid month");
	});

	it("derives the current month tab from a date", () => {
		expect(currentMonthTab(new Date("2026-07-02T12:00:00"))).toBe("7 月");
		expect(currentMonthTab(new Date("2026-12-31T12:00:00"))).toBe("12 月");
	});

	it("resolves the month in Taipei time, not UTC", () => {
		// 2026-07-31T17:00:00Z is already August 1st, 01:00 in Taipei
		expect(currentMonthTab(new Date("2026-07-31T17:00:00Z"))).toBe("8 月");
		expect(currentMonthTab(new Date("2026-07-31T15:59:00Z"))).toBe("7 月");
	});

	it("wraps January's previous month to December", () => {
		expect(previousMonth(1)).toBe(12);
		expect(previousMonth(10)).toBe(9);
	});

	it("knows the recurring items and the total-row anchor", () => {
		expect(TOTAL_ROW_LABEL).toBe("花費總額");
		for (const item of ["Google Cloud", "Netflix", "電話費", "上月透支", "Claude"]) {
			expect(RECURRING_ITEMS.has(item)).toBe(true);
		}
		expect(RECURRING_ITEMS.has("近鐵 80000系")).toBe(false);
		expect(RECURRING_ITEMS.has("上月美金透支")).toBe(true);
		expect(RECURRING_ITEMS.has("上月新臺幣透支")).toBe(true);
	});

	it("exports the summary row labels", () => {
		expect(OVERDRAFT_LABEL).toBe("上月透支");
		expect(PREV_USD_OVERDRAFT_LABEL).toBe("上月美金透支");
		expect(PREV_NTD_OVERDRAFT_LABEL).toBe("上月新臺幣透支");
		expect(SALARY_LABEL).toBe("薪水");
		expect(REPAYMENT_LABEL).toBe("沛還");
		expect(REMAINDER_LABEL).toBe("剩餘");
		expect(USD_PAYMENT_LABEL).toBe("美金支付");
	});

	it("exports the income-section labels", () => {
		expect(BUDGET_HEADER_LABEL).toBe("總預算");
		expect(NTD_PAYMENT_LABEL).toBe("新臺幣支付");
		expect(MONTH_USD_NET_LABEL).toBe("月美金餘額");
		expect(MONTH_NTD_NET_LABEL).toBe("月新臺幣餘額");
		expect(MONTH_REMAINDER_LABEL).toBe("月剩餘");
		expect(USD_WRITEOFF_LABEL).toBe("美金透支沖銷");
		expect(NTD_WRITEOFF_LABEL).toBe("新臺幣透支沖銷");
		expect(TOTAL_USD_BALANCE_LABEL).toBe("總美金餘額");
		expect(TOTAL_NTD_BALANCE_LABEL).toBe("總新臺幣餘額");
	});

	it("exports the 中餐預算 lunch-section anchors", () => {
		expect(LUNCH_SECTION_LABEL).toBe("中餐預算");
		expect(LUNCH_TOTAL_LABEL).toBe("總和");
		expect(LUNCH_DEFAULT_ITEM).toBe("中餐");
		expect(LUNCH_ADJUST_LABEL).toBe("午餐超支或回補");
		expect(LUNCH_COLS).toEqual({ date: 14, item: 15, amount: 16 });
	});

	it("keeps 沛還 and 薪水 as recurring income, ad-hoc rows are not", () => {
		expect(RECURRING_INCOME.has("沛還")).toBe(true);
		expect(RECURRING_INCOME.has("薪水")).toBe(true);
		expect(RECURRING_INCOME.has("多一個月薪水")).toBe(false);
	});

	it("maps the monthly-tab columns (類別-column layout)", () => {
		expect(MONTH_COLS).toEqual({
			date: 0,
			item: 1,
			tag: 2,
			usd: 3,
			twd: 4,
			paidWith: 5,
			totalLabel: 3,
			totalValue: 4,
			budgetLabel: 1,
			budgetValue: 3,
		});
	});

	it("documents the 類別 tags seen in the sheet", () => {
		for (const tag of ["訂閱", "吃喝", "交通", "生活用品", "娛樂", "購物", "其他", "透支"]) {
			expect(KNOWN_TAGS).toContain(tag);
		}
	});

	it("converts calendar dates to Sheets serials", () => {
		expect(dateSerial(1899, 12, 31)).toBe(1);
		expect(dateSerial(2026, 7, 1)).toBe(46204); // matches the live sheet's 7月!A3
	});

	it("parses M/D input with the current Taipei year", () => {
		const now = new Date("2026-07-02T12:00:00Z");
		expect(parseDateInput("7/1", now)).toBe(46204);
		expect(parseDateInput("07/01", now)).toBe(46204);
	});

	it("parses explicit years in slash and dash forms", () => {
		expect(parseDateInput("2026/07/01")).toBe(46204);
		expect(parseDateInput("2026-7-1")).toBe(46204);
	});

	it("resolves the default year in Taipei time across the UTC year boundary", () => {
		// 2026-12-31T17:00:00Z is already 2027-01-01 01:00 in Taipei
		expect(parseDateInput("1/1", new Date("2026-12-31T17:00:00Z"))).toBe(dateSerial(2027, 1, 1));
	});

	it("rejects unparseable and impossible dates", () => {
		expect(() => parseDateInput("tomorrow")).toThrow("Unrecognized date");
		expect(() => parseDateInput("13/40")).toThrow("Invalid date");
		expect(() => parseDateInput("2026/02/30")).toThrow("Invalid date");
	});

	it("todaySerial uses the Taipei calendar date", () => {
		// 18:00 UTC on 7/6 is already 02:00 on 7/7 in Taipei
		expect(todaySerial(new Date("2026-07-06T18:00:00Z"))).toBe(dateSerial(2026, 7, 7));
		expect(todaySerial(new Date("2026-07-06T03:00:00Z"))).toBe(dateSerial(2026, 7, 6));
	});

	it("serialToIso inverts dateSerial", () => {
		expect(serialToIso(dateSerial(2026, 7, 6))).toBe("2026-07-06");
		expect(serialToIso(dateSerial(1999, 12, 31))).toBe("1999-12-31");
	});

	it("conventions text mentions the anchors Claude needs", () => {
		for (const needle of [
			"花費總額",
			"GOOGLEFINANCE",
			"上月透支",
			"上月美金透支",
			"上月新臺幣透支",
			"insert",
			"0.22",
			"分類總花費",
			"電子產品",
			"機票住宿",
			"find_cells",
			"expect_empty",
			"日期",
			"類別",
			"新臺幣支付",
			"支付幣別",
			"月剩餘",
			"月美金餘額",
			"總美金餘額",
			"set_income",
			"幣別",
			"透支沖銷",
			"乾坤大挪移",
			"add_transfer",
			"當筆總額外花費",
			"中餐預算",
			"add_lunch",
			"午餐超支或回補",
			"編列預算",
		]) {
			expect(CONVENTIONS_TEXT).toContain(needle);
		}
	});

	it("exports the trip block anchors", () => {
		expect(TRIP_HEADER_DATE).toBe("日期");
		expect(TRIP_HEADER_SHOP).toBe("店鋪");
		expect(TRIP_TOTAL_LABEL).toBe("分類總花費");
		expect(TRIP_MAX_BLOCK_ROWS).toBe(30);
	});
});
