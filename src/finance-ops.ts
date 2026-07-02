/**
 * Operations that understand Vincent's sheet conventions. Pure helpers here;
 * client-calling ops (addExpense, monthSummary, startMonth, addTripEntry)
 * live in this module too and are the only writers the tailored tools use.
 */

import {
	CATEGORIES,
	currentMonthTab,
	DEFAULT_CATEGORY,
	monthTabName,
	TOTAL_ROW_LABEL,
	TRIP_CATEGORY_ROW,
} from "./conventions";
import type { SheetsClient } from "./sheets-client";

const FLAT_SUM_RE =
	/^=\s*sum\(\s*[A-Z]{1,3}\d+(?::[A-Z]{1,3}\d+)?(\s*,\s*[A-Z]{1,3}\d+(?::[A-Z]{1,3}\d+)?)*\s*\)$/i;

/** Append a cell ref inside the final closing paren: "=sum(C22,C3)" + "C24" → "=sum(C22,C3,C24)". */
export function spliceIntoSum(formula: string, cellRef: string): string {
	if (!FLAT_SUM_RE.test(formula)) {
		throw new Error(`Category formula is not a sum(...) that can be extended: "${formula}"`);
	}
	const i = formula.lastIndexOf(")");
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
	const re = new RegExp(`(?<![A-Z])([A-Z]{1,2})${fromRow}(?![0-9])`, "g");
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

/** The window that contains every anchor a monthly tab needs. */
export const GRID_READ = "A1:F60";

export function quoteTab(tab: string): string {
	return `'${tab.replace(/'/g, "''")}'`;
}

export interface AddExpenseParams {
	item: string;
	amount: number;
	currency: "TWD" | "USD";
	category?: string;
	month?: number;
}

export async function addExpense(client: SheetsClient, p: AddExpenseParams) {
	const tab = p.month !== undefined ? monthTabName(p.month) : currentMonthTab();
	const categoryKey = p.category ?? DEFAULT_CATEGORY;
	const categoryLabel = CATEGORIES[categoryKey];
	if (!categoryLabel) {
		throw new Error(`Unknown category "${p.category}". Valid categories: ${Object.keys(CATEGORIES).join(", ")}`);
	}

	const { values } = await client.readRange(`${quoteTab(tab)}!${GRID_READ}`, "FORMULA");

	const totalRow = findRowByValue(values, 1, TOTAL_ROW_LABEL);
	if (totalRow === null) {
		throw new Error(`Could not find the "${TOTAL_ROW_LABEL}" row in ${tab} (searched column B of ${GRID_READ}).`);
	}
	const categoryRow = findRowByValue(values, 4, categoryLabel);
	if (categoryRow === null) {
		throw new Error(`Could not find the category label "${categoryLabel}" in column E of ${tab}.`);
	}
	const categoryFormula = String(values[categoryRow - 1]?.[5] ?? "");

	// First fully-empty row inside the expense window (rows 3 .. totalRow-1).
	let targetRow: number | null = null;
	for (let r = 3; r < totalRow; r++) {
		const row = values[r - 1] ?? [];
		if (!row.some((c) => c !== "" && c != null)) {
			targetRow = r;
			break;
		}
	}

	const sheetId = await client.getSheetId(tab);
	const requests: object[] = [];
	const inserted = targetRow === null;
	if (targetRow === null) {
		// Insert INSIDE the SUM window (above its last row) so SUM(C3:Cn) auto-extends.
		targetRow = totalRow - 1;
		requests.push({
			insertDimension: {
				range: { sheetId, dimension: "ROWS", startIndex: targetRow - 1, endIndex: targetRow },
				inheritFromBefore: true,
			},
		});
	}

	const rowCells =
		p.currency === "USD"
			? [cellData(p.item), cellData(p.amount), cellData(`=B${targetRow}*GOOGLEFINANCE("CURRENCY:USDTWD")`)]
			: [cellData(p.item), cellData(null), cellData(p.amount)];
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: targetRow - 1, columnIndex: 0 },
			rows: [{ values: rowCells }],
			fields: "userEnteredValue",
		},
	});

	// The formula was read pre-insert; if we inserted, refs at/below the insert point shifted.
	const baseFormula = inserted ? adjustColumnRefsForInsert(categoryFormula, "C", targetRow) : categoryFormula;
	const categoryRowFinal = inserted && categoryRow >= targetRow ? categoryRow + 1 : categoryRow;
	const newCategoryFormula = spliceIntoSum(baseFormula, `C${targetRow}`);
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: categoryRowFinal - 1, columnIndex: 5 },
			rows: [{ values: [cellData(newCategoryFormula)] }],
			fields: "userEnteredValue",
		},
	});

	await client.batchUpdate(requests);
	return {
		tab,
		row: targetRow,
		inserted,
		item: p.item,
		amount: p.amount,
		currency: p.currency,
		category: categoryKey,
		categoryFormula: newCategoryFormula,
	};
}

export async function monthSummary(client: SheetsClient, month?: number) {
	const tab = month !== undefined ? monthTabName(month) : currentMonthTab();
	const { values } = await client.readRange(`${quoteTab(tab)}!${GRID_READ}`, "UNFORMATTED_VALUE");

	const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
	const cellAt = (row: number | null, col: number): number | null =>
		row === null ? null : num(values[row - 1]?.[col]);
	const rowByA = (label: string) => findRowByValue(values, 0, label);

	const categories: Record<string, number | null> = {};
	for (const [key, label] of Object.entries(CATEGORIES)) {
		categories[key] = cellAt(findRowByValue(values, 4, label), 5);
	}

	return {
		tab,
		花費總額: cellAt(findRowByValue(values, 1, TOTAL_ROW_LABEL), 2),
		上月透支: cellAt(rowByA("上月透支"), 2),
		categories,
		薪水: cellAt(rowByA("薪水"), 1),
		沛還: cellAt(rowByA("沛還"), 1),
		剩餘: cellAt(rowByA("剩餘"), 1),
		美金支付: cellAt(rowByA("美金支付"), 1),
	};
}
