import { describe, expect, it } from "vitest";
import {
	adaptRowFormula,
	adjustColumnRefsForInsert,
	cellData,
	colLetter,
	findRowByValue,
	spliceIntoSum,
	stripRefErrors,
} from "../src/finance-ops";

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
