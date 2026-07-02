/**
 * Operations that understand Vincent's sheet conventions. Pure helpers here;
 * client-calling ops (addExpense, monthSummary, startMonth, addTripEntry)
 * live in this module too and are the only writers the tailored tools use.
 */

/** Append a cell ref inside the final closing paren: "=sum(C22,C3)" + "C24" → "=sum(C22,C3,C24)". */
export function spliceIntoSum(formula: string, cellRef: string): string {
	const i = formula.lastIndexOf(")");
	if (!formula.toLowerCase().includes("sum(") || i === -1) {
		throw new Error(`Category formula is not a sum(...) that can be extended: "${formula}"`);
	}
	return `${formula.slice(0, i)},${cellRef})`;
}

/**
 * Adjust a formula that was read BEFORE an insertDimension so it is correct
 * AFTER: 1-indexed refs to `column` at/below `insertedAt` shift down by one.
 */
export function adjustColumnRefsForInsert(formula: string, column: string, insertedAt: number): string {
	const re = new RegExp(`\\b${column}(\\d+)\\b`, "g");
	return formula.replace(re, (_m, n: string) => {
		const row = Number(n);
		return `${column}${row >= insertedAt ? row + 1 : row}`;
	});
}

/** Remove #REF! entries a row deletion leaves inside sum(...) lists. */
export function stripRefErrors(formula: string): string {
	return formula.replace(/#REF!\s*,\s*/g, "").replace(/,\s*#REF!/g, "");
}

/** Re-target a single-row formula: "=E5*0.22" from row 5 to row 9 → "=E9*0.22". */
export function adaptRowFormula(formula: string, fromRow: number, toRow: number): string {
	const re = new RegExp(`([A-Z]{1,2})${fromRow}(?![0-9])`, "g");
	return formula.replace(re, (_m, col: string) => `${col}${toRow}`);
}

/** 1-indexed row of the first exact (trimmed) match of `needle` in column `colIndex`, else null. */
export function findRowByValue(values: unknown[][], colIndex: number, needle: string): number | null {
	for (let i = 0; i < values.length; i++) {
		if (String(values[i]?.[colIndex] ?? "").trim() === needle) return i + 1;
	}
	return null;
}

/** Sheets CellData for updateCells requests. */
export function cellData(v: string | number | null): object {
	if (v === null) return {};
	if (typeof v === "number") return { userEnteredValue: { numberValue: v } };
	if (v.startsWith("=")) return { userEnteredValue: { formulaValue: v } };
	return { userEnteredValue: { stringValue: v } };
}

/** 0-indexed column → A1 letter ("A", "I", "AA"). */
export function colLetter(index0: number): string {
	let s = "";
	let i = index0 + 1;
	while (i > 0) {
		s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
		i = Math.floor((i - 1) / 26);
	}
	return s;
}
