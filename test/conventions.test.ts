import { describe, expect, it } from "vitest";
import {
	CATEGORIES,
	CONVENTIONS_TEXT,
	currentMonthTab,
	DEFAULT_CATEGORY,
	monthTabName,
	OVERDRAFT_LABEL,
	previousMonth,
	RECURRING_ITEMS,
	REMAINDER_LABEL,
	REPAYMENT_LABEL,
	SALARY_LABEL,
	TOTAL_ROW_LABEL,
	TRIP_HEADER_DATE,
	TRIP_HEADER_SHOP,
	TRIP_MAX_BLOCK_ROWS,
	TRIP_TOTAL_LABEL,
	USD_PAYMENT_LABEL,
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

	it("maps short category names to the exact sheet labels", () => {
		expect(CATEGORIES["訂閱費"]).toBe("訂閱費");
		expect(CATEGORIES["交通中餐雜支"]).toBe("交通中餐等等雜支");
		expect(CATEGORIES["額外雜支"]).toBe("本月額外雜支");
		expect(CATEGORIES[DEFAULT_CATEGORY]).toBeDefined();
	});

	it("knows the recurring items and the total-row anchor", () => {
		expect(TOTAL_ROW_LABEL).toBe("花費總額");
		for (const item of ["Google Cloud", "Netflix", "電話費", "上月透支", "Claude"]) {
			expect(RECURRING_ITEMS.has(item)).toBe(true);
		}
		expect(RECURRING_ITEMS.has("近鐵 80000系")).toBe(false);
	});

	it("exports the summary row labels", () => {
		expect(OVERDRAFT_LABEL).toBe("上月透支");
		expect(SALARY_LABEL).toBe("薪水");
		expect(REPAYMENT_LABEL).toBe("沛還");
		expect(REMAINDER_LABEL).toBe("剩餘");
		expect(USD_PAYMENT_LABEL).toBe("美金支付");
	});

	it("conventions text mentions the anchors Claude needs", () => {
		for (const needle of [
			"花費總額",
			"GOOGLEFINANCE",
			"上月透支",
			"insert",
			"0.22",
			"分類總花費",
			"電子產品",
			"機票住宿",
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
