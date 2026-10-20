import { describe, expect, it } from "vitest";
import {
	BUDGET_HEADER_LABEL,
	CONVENTIONS_TEXT,
	currentMonthTab,
	dateSerial,
	KNOWN_TAGS,
	LUNCH_ADJUST_LABEL,
	LUNCH_COLS,
	LUNCH_SECTION_LABEL,
	LUNCH_SECTION_LEGACY_LABEL,
	LUNCH_TOTAL_LABEL,
	MONTH_COLS,
	MONTH_NTD_NET_LABELS,
	MONTH_USD_NET_LABEL,
	MONTH_USD_NET_LABELS,
	monthTabName,
	NTD_CONSERVATIVE_END_LABEL,
	NTD_END_BALANCE_LABEL,
	NTD_OVERSPEND_LABEL,
	NTD_PAYMENT_LABEL,
	NTD_START_BALANCE_LABEL,
	parseDateInput,
	OVERDRAFT_LABEL,
	PREV_NTD_OVERDRAFT_LABEL,
	PREV_USD_OVERDRAFT_LABEL,
	previousMonth,
	REMAINDER_LABEL,
	REPAYMENT_LABEL,
	SALARY_LABEL,
	serialToIso,
	todaySerial,
	TOTAL_ROW_LABEL,
	TRIP_HEADER_DATE,
	TRIP_HEADER_SHOP,
	TRIP_MAX_BLOCK_ROWS,
	TRIP_TOTAL_LABEL,
	USD_END_BALANCE_LABEL,
	USD_OVERSPEND_LABEL,
	USD_PAYMENT_LABEL,
	USD_START_BALANCE_LABEL,
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

	it("knows the old layout's total-row anchor", () => {
		expect(TOTAL_ROW_LABEL).toBe("花費總額");
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

	it("exports the income-section and 銀行餘額 labels", () => {
		expect(BUDGET_HEADER_LABEL).toBe("總預算");
		expect(NTD_PAYMENT_LABEL).toBe("新臺幣支付");
		expect(MONTH_USD_NET_LABEL).toBe("本月美金收支狀況");
		// 7月 2026 titles the rows 本月…餘額 — both anchors must be accepted.
		expect(MONTH_USD_NET_LABELS).toEqual(["本月美金收支狀況", "本月美金餘額"]);
		expect(MONTH_NTD_NET_LABELS).toEqual(["本月新臺幣收支狀況", "本月新臺幣餘額"]);
		expect(USD_START_BALANCE_LABEL).toBe("本月初美金餘額");
		expect(USD_END_BALANCE_LABEL).toBe("本月底美金餘額");
		expect(NTD_START_BALANCE_LABEL).toBe("本月初新臺幣餘額");
		expect(NTD_CONSERVATIVE_END_LABEL).toBe("保守預計本月底新臺幣餘額");
		expect(NTD_END_BALANCE_LABEL).toBe("本月底新臺幣餘額");
	});

	it("exports the 午餐預算 lunch-section anchors", () => {
		expect(LUNCH_SECTION_LABEL).toBe("午餐預算");
		expect(LUNCH_SECTION_LEGACY_LABEL).toBe("中餐預算");
		expect(LUNCH_TOTAL_LABEL).toBe("總和");
		expect(LUNCH_ADJUST_LABEL).toBe("午餐超支或回補");
		expect(LUNCH_COLS).toEqual({ date: 15, item: 16, amount: 17, paidMethod: 18 });
		expect(LUNCH_COLS.paidMethod).toBe(18); // S — 支付方式
	});

	it("maps the monthly-tab columns (類別-column layout)", () => {
		expect(MONTH_COLS).toEqual({
			date: 0,
			item: 1,
			tag: 2,
			usd: 3,
			twd: 4,
			paidWith: 5,
			paidMethod: 6,
			totalLabel: 3,
			totalValue: 4,
			budgetLabel: 1,
			budgetValue: 3,
		});
		expect(MONTH_COLS.paidMethod).toBe(6); // G — 支付方式
	});

	it("lists the nine budget categories, each one a block", () => {
		expect([...KNOWN_TAGS].sort()).toEqual(["中餐", "交通", "其他", "吃喝", "娛樂", "學貸", "生活用品", "訂閱", "購物"].sort());
		expect(KNOWN_TAGS).not.toContain("透支");
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
			"上月美金透支",
			"上月新臺幣透支",
			"分類總花費",
			"電子產品",
			"機票住宿",
			"find_cells",
			"expect_empty",
			"日期",
			"本月美金收支狀況",
			"本月新臺幣收支狀況",
			"學貸",
			"set_income",
			"幣別",
			"乾坤大挪移",
			"add_transfer",
			"當筆總額外花費",
			"編列預算",
		]) {
			expect(CONVENTIONS_TEXT).toContain(needle);
		}
	});

	it("describes old-layout months as read-only history that month_summary still reads", () => {
		const old = CONVENTIONS_TEXT.slice(CONVENTIONS_TEXT.indexOf("OLD MONTHS"));
		expect(CONVENTIONS_TEXT).toContain("OLD MONTHS");
		expect(old).toContain("read-only");
		expect(old).toContain("month_summary");
		expect(old).toContain("N 月 DEP");
	});

	it("no longer offers the removed tools or the old write paths", () => {
		for (const gone of ["add_lunch", "set_expense_date", "adjust_balance", "replace_old_layout", "card is refused", "wires the NTD side"]) {
			expect(CONVENTIONS_TEXT).not.toContain(gone);
		}
		// The card buckets survive only as part of the old months' read-only description.
		const beforeOld = CONVENTIONS_TEXT.slice(0, CONVENTIONS_TEXT.indexOf("OLD MONTHS"));
		expect(beforeOld).not.toContain("信用卡帳單對帳區");
	});

	it("describes budget months", () => {
		for (const needle of ["MONTHLY TABS", "本月匯率", "Budget Based", "幣別"]) {
			expect(CONVENTIONS_TEXT).toContain(needle);
		}
	});

	it("says add_expense carries the 幣別 dropdown onto new entries", () => {
		expect(CONVENTIONS_TEXT).toContain("add_expense copies the 幣別 dropdown rule onto the new row");
		expect(CONVENTIONS_TEXT).toContain("when nothing above has one, from another block's 幣別");
	});

	it("no longer mentions the one-off migration tool", () => {
		expect(CONVENTIONS_TEXT).not.toContain("migrate_budget_split");
	});

	it("describes per-currency budget months", () => {
		expect(USD_OVERSPEND_LABEL).toBe("本月美金超支");
		for (const needle of [
			"<類別>美金預算",
			"<類別>新臺幣預算",
			"a 美金 row and a 新臺幣 row",
			"本月美金超支（加上回補）",
			"本月新臺幣超支（加上回補）",
			"本月美金收支狀況 (USD income − 上月美金透支 − the USD budget lines + 本月美金超支)",
		]) {
			expect(CONVENTIONS_TEXT).toContain(needle);
		}
	});

	it("says the NTD line subtracts the NTD-paid overspend", () => {
		expect(NTD_OVERSPEND_LABEL).toBe("本月新臺幣超支");
		expect(CONVENTIONS_TEXT).toContain("本月新臺幣收支狀況 (TWD income − 上月新臺幣透支 − the TWD budget lines + 本月新臺幣超支 − the 乾坤大挪移 手續費)");
	});

	it("exports the trip block anchors", () => {
		expect(TRIP_HEADER_DATE).toBe("日期");
		expect(TRIP_HEADER_SHOP).toBe("店鋪");
		// The bare suffix: real total labels vary (分類總花費, 機票住宿分類總花費, 食總花費).
		expect(TRIP_TOTAL_LABEL).toBe("總花費");
		for (const label of ["分類總花費", "機票住宿分類總花費", "食總花費"]) {
			expect(label).toContain(TRIP_TOTAL_LABEL);
		}
		// The monthly tab's 花費總額 must NOT match — different anchor, different layout.
		expect("花費總額").not.toContain(TRIP_TOTAL_LABEL);
		expect(TRIP_MAX_BLOCK_ROWS).toBe(30);
	});
});
