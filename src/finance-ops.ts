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
	OVERDRAFT_LABEL,
	previousMonth,
	RECURRING_ITEMS,
	REMAINDER_LABEL,
	REPAYMENT_LABEL,
	SALARY_LABEL,
	TOTAL_ROW_LABEL,
	TRIP_CATEGORY_ROW,
	USD_PAYMENT_LABEL,
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
	return formula
		.replace(/#REF!\s*,\s*/g, "")
		.replace(/,\s*#REF!/g, "")
		.replace(/\(\s*#REF!\s*\)/g, "(0)");
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

function assertNotTruncated(truncated: boolean, tab: string, range: string): void {
	if (truncated) {
		throw new Error(
			`Refusing to operate on ${tab}: reading ${range} was truncated at the size cap, so row positions cannot be trusted.`,
		);
	}
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

	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, tab, GRID_READ);

	const totalRow = findRowByValue(values, 1, TOTAL_ROW_LABEL);
	if (totalRow === null) {
		throw new Error(`Could not find the "${TOTAL_ROW_LABEL}" row in ${tab} (searched column B of ${GRID_READ}).`);
	}
	const totalFormula = String(values[totalRow - 1]?.[2] ?? "");
	const windowMatch = totalFormula.match(/^=SUM\(C(\d+):C(\d+)\)$/i);
	if (!windowMatch) {
		throw new Error(
			`The "${TOTAL_ROW_LABEL}" cell C${totalRow} in ${tab} is not a plain =SUM(Cstart:Cend) formula (got "${totalFormula}") — cannot locate the expense window safely.`,
		);
	}
	const windowStart = Number(windowMatch[1]);
	const windowEnd = Number(windowMatch[2]);
	const categoryRow = findRowByValue(values, 4, categoryLabel);
	if (categoryRow === null) {
		throw new Error(`Could not find the category label "${categoryLabel}" in column E of ${tab}.`);
	}
	const categoryFormula = String(values[categoryRow - 1]?.[5] ?? "");

	// First fully-empty row inside the SUM window (and above the total row).
	let targetRow: number | null = null;
	for (let r = windowStart; r <= Math.min(windowEnd, totalRow - 1); r++) {
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
		if (windowEnd <= windowStart) {
			throw new Error(`The expense window ${totalFormula} in ${tab} is too small to insert into safely.`);
		}
		// Insert at the window's last row: strictly inside the SUM range, so it auto-extends.
		targetRow = windowEnd;
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
	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${GRID_READ}`, "UNFORMATTED_VALUE");
	assertNotTruncated(truncated, tab, GRID_READ);

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
		上月透支: cellAt(rowByA(OVERDRAFT_LABEL), 2),
		categories,
		薪水: cellAt(rowByA(SALARY_LABEL), 1),
		沛還: cellAt(rowByA(REPAYMENT_LABEL), 1),
		剩餘: cellAt(rowByA(REMAINDER_LABEL), 1),
		美金支付: cellAt(rowByA(USD_PAYMENT_LABEL), 1),
	};
}

export async function startMonth(client: SheetsClient, month: number) {
	const newTab = monthTabName(month);
	const prevTab = monthTabName(previousMonth(month));

	const tabs = await client.listTabs();
	if (tabs.some((t) => t.title === newTab)) {
		throw new Error(`Tab "${newTab}" already exists — refusing to overwrite it.`);
	}
	if (!tabs.some((t) => t.title === prevTab)) {
		throw new Error(`Previous month tab "${prevTab}" not found — cannot duplicate it.`);
	}

	const prevSheetId = await client.getSheetId(prevTab);
	const dup = await client.batchUpdate([
		{ duplicateSheet: { sourceSheetId: prevSheetId, insertSheetIndex: 0, newSheetName: newTab } },
	]);
	const sheetId = dup.replies?.[0]?.duplicateSheet?.properties?.sheetId;
	if (sheetId == null) throw new Error("duplicateSheet did not return the new tab's sheetId.");

	const { values, truncated } = await client.readRange(`${quoteTab(newTab)}!${GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, newTab, GRID_READ);
	const totalRow = findRowByValue(values, 1, TOTAL_ROW_LABEL);
	if (totalRow === null) {
		throw new Error(`Could not find the "${TOTAL_ROW_LABEL}" row in the duplicated tab ${newTab}.`);
	}

	const requests: object[] = [
		{
			updateCells: {
				start: { sheetId, rowIndex: 0, columnIndex: 0 },
				rows: [{ values: [cellData(`${month} 月花費`)] }],
				fields: "userEnteredValue",
			},
		},
	];

	const overdraftRow = findRowByValue(values, 0, OVERDRAFT_LABEL);
	if (overdraftRow !== null) {
		const formula = String(values[overdraftRow - 1]?.[2] ?? "");
		const rewired = formula.replace(/'\d+ 月'/g, `'${prevTab}'`);
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: overdraftRow - 1, columnIndex: 2 },
				rows: [{ values: [cellData(rewired)] }],
				fields: "userEnteredValue",
			},
		});
	}

	const kept: string[] = [];
	const cleared: string[] = [];
	const rowsToDelete: number[] = [];
	for (let r = 3; r < totalRow; r++) {
		const item = String(values[r - 1]?.[0] ?? "").trim();
		if (item === "") continue;
		if (RECURRING_ITEMS.has(item)) kept.push(item);
		else {
			cleared.push(item);
			rowsToDelete.push(r);
		}
	}
	// Bottom-up so earlier deletions don't shift later indices.
	for (const r of [...rowsToDelete].sort((a, b) => b - a)) {
		requests.push({
			deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: r - 1, endIndex: r } },
		});
	}
	await client.batchUpdate(requests);

	// Deleting referenced rows leaves #REF! inside the hand-picked category sums — scrub them.
	if (rowsToDelete.length > 0) {
		const { values: afterValues, truncated: afterTruncated } = await client.readRange(
			`${quoteTab(newTab)}!${GRID_READ}`,
			"FORMULA",
		);
		assertNotTruncated(afterTruncated, newTab, GRID_READ);
		const fixes: object[] = [];
		for (const label of Object.values(CATEGORIES)) {
			const r = findRowByValue(afterValues, 4, label);
			if (r === null) continue;
			const formula = String(afterValues[r - 1]?.[5] ?? "");
			if (formula.includes("#REF!")) {
				fixes.push({
					updateCells: {
						start: { sheetId, rowIndex: r - 1, columnIndex: 5 },
						rows: [{ values: [cellData(stripRefErrors(formula))] }],
						fields: "userEnteredValue",
					},
				});
			}
		}
		if (fixes.length > 0) await client.batchUpdate(fixes);
	}

	return { tab: newTab, duplicatedFrom: prevTab, kept, cleared };
}

export interface TripEntryParams {
	tab: string;
	category: string;
	date: string;
	shop: string;
	item: string;
	paymentMethod: string;
	jpy: number;
}

export async function addTripEntry(client: SheetsClient, p: TripEntryParams) {
	const { values, truncated } = await client.readRange(`${quoteTab(p.tab)}!A1:AL200`, "FORMULA");
	assertNotTruncated(truncated, p.tab, "A1:AL200");

	const categoryRow = values[TRIP_CATEGORY_ROW - 1] ?? [];
	let startCol = -1;
	for (let c = 0; c < categoryRow.length; c++) {
		if (String(categoryRow[c] ?? "").trim() === p.category) {
			startCol = c;
			break;
		}
	}
	if (startCol === -1) {
		const blocks = categoryRow.map((v) => String(v ?? "").trim()).filter(Boolean);
		throw new Error(
			`Category block "${p.category}" not found in row ${TRIP_CATEGORY_ROW} of ${p.tab}. Blocks present: ${blocks.join(", ")}`,
		);
	}

	let targetRow = values.length + 1;
	let lastDataRow = -1;
	for (let r = TRIP_CATEGORY_ROW + 1; r <= values.length + 1; r++) {
		const block = (values[r - 1] ?? []).slice(startCol, startCol + 7);
		if (block.some((c) => c !== "" && c != null)) {
			lastDataRow = r;
		} else {
			targetRow = r;
			break;
		}
	}

	const jpyCol = colLetter(startCol + 4);
	const twdCol = colLetter(startCol + 5);
	let twdFormula = `=${jpyCol}${targetRow}*0.22`;
	let roundFormula = `=CEILING(${twdCol}${targetRow})`;
	if (lastDataRow > TRIP_CATEGORY_ROW) {
		const prevRow = values[lastDataRow - 1] ?? [];
		const prevTwd = String(prevRow[startCol + 5] ?? "");
		const prevRound = String(prevRow[startCol + 6] ?? "");
		if (prevTwd.startsWith("=")) twdFormula = adaptRowFormula(prevTwd, lastDataRow, targetRow);
		if (prevRound.startsWith("=")) roundFormula = adaptRowFormula(prevRound, lastDataRow, targetRow);
	}

	const range = `${quoteTab(p.tab)}!${colLetter(startCol)}${targetRow}:${colLetter(startCol + 6)}${targetRow}`;
	const result = await client.updateRange(range, [
		[p.date, p.shop, p.item, p.paymentMethod, p.jpy, twdFormula, roundFormula],
	]);
	return { tab: p.tab, category: p.category, row: targetRow, updatedRange: result.updatedRange };
}
