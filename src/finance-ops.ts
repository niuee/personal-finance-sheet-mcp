/**
 * Operations that understand Vincent's sheet conventions. Pure helpers here;
 * client-calling ops (addExpense, monthSummary, startMonth, addTripEntry)
 * live in this module too and are the only writers the tailored tools use.
 */

import {
	ADJUSTED_NTD_END_BALANCE_LABEL,
	ADJUSTED_REAL_NTD_END_LABEL,
	ADJUSTED_REAL_USD_END_LABEL,
	ADJUSTED_USD_END_BALANCE_LABELS,
	BANK_BLOCK_LABEL,
	BUDGET_SUM_LABEL,
	BUDGET_TEMPLATE_TAB,
	BUDGET_HEADER_LABEL,
	currentMonthTab,
	DATE_HEADER_LABEL,
	INCOME_HEADER_LABEL,
	LUNCH_ADJUST_LABEL,
	LUNCH_BUDGET_LABEL,
	LUNCH_COLS,
	LUNCH_SECTION_LABEL,
	LUNCH_SECTION_LEGACY_LABEL,
	LUNCH_TOTAL_LABEL,
	MONTH_COLS,
	MONTH_NTD_NET_LABELS,
	MONTH_USD_NET_LABEL,
	MONTH_USD_NET_LABELS,
	monthTabName,
	NTD_ADJUSTMENT_LABEL,
	NTD_CONSERVATIVE_END_LABEL,
	NTD_END_BALANCE_LABEL,
	NTD_INCOME_LABEL,
	NTD_OVERSPEND_LABEL,
	NTD_OVERSPEND_NET_LABEL,
	NTD_PAYMENT_LABEL,
	NTD_SPENDING_LABEL,
	NTD_START_BALANCE_LABEL,
	OVERDRAFT_LABEL,
	OVERSPEND_LABEL,
	OVERSPEND_NET_LABEL,
	parseDateInput,
	PREV_NTD_OVERDRAFT_LABEL,
	PREV_USD_OVERDRAFT_LABEL,
	RATE_LABEL,
	REAL_NTD_CARD_PAYMENT_LABEL,
	REAL_NTD_CASH_SPENDING_LABEL,
	REAL_NTD_END_BALANCE_LABEL,
	REAL_NTD_START_BALANCE_LABEL,
	REAL_SECTION_LABEL,
	REAL_USD_CARD_PAYMENT_LABEL,
	REAL_USD_CASH_SPENDING_LABEL,
	REAL_USD_END_BALANCE_LABEL,
	REAL_USD_START_BALANCE_LABEL,
	REMAINDER_LABEL,
	REPAYMENT_LABEL,
	SALARY_LABEL,
	serialToIso,
	todaySerial,
	TOTAL_ROW_LABEL,
	TOTAL_SPENDING_LABEL,
	TRANSFER_JPY_COLS,
	TRANSFER_SECTION_LABEL,
	TRANSFER_TOTAL_LABEL,
	TRIP_BUDGET_CATEGORY_HEADER,
	TRIP_BUDGET_SECTION_LABEL,
	TRIP_BUDGET_WIDTH,
	TRIP_HEADER_DATE,
	TRIP_HEADER_SHOP,
	TRIP_BLOCK_WIDTH,
	TRIP_MAX_BLOCK_ROWS,
	TRIP_TOTAL_LABEL,
	USD_ADJUSTMENT_LABEL,
	USD_END_BALANCE_LABEL,
	USD_INCOME_LABEL,
	USD_OVERSPEND_LABEL,
	USD_OVERSPEND_NET_LABEL,
	USD_PAYMENT_LABEL,
	USD_SPENDING_LABEL,
	USD_START_BALANCE_LABEL,
} from "./conventions";
import type { SheetsClient } from "./sheets-client";
import { assertBudgetMonth, findBudgetIncomeSumifWindow, isBudgetMonth } from "./budget-layout";
import {
	addBudgetExpense,
	addBudgetTransfer,
	budgetCategories,
	budgetMonthSummary,
	deleteBudgetExpense,
	startBudgetMonth,
} from "./budget-ops";

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

/** findRowByValue over several candidate labels, first hit wins — for renamed anchors with legacy fallbacks. */
export function findRowByLabels(values: unknown[][], colIndex: number, labels: readonly string[]): number | null {
	for (const label of labels) {
		const row = findRowByValue(values, colIndex, label);
		if (row !== null) return row;
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

// A month tab's grid. Rows are unbounded: trailing empty rows cost nothing
// (Sheets omits them) and an oversized response still fails loudly through
// assertNotTruncated rather than silently losing rows. The width reaches
// column S so month_summary sees an old-layout month's lunch log (P–S);
// budget-month ops re-read the wider BUDGET_GRID_READ for their blocks.
export const FULL_GRID_READ = "A1:S";

/** The trip tab's JPY section lives in A–G below all trip content — unbounded rows, same reason as FULL_GRID_READ. */
export const TRANSFER_JPY_GRID_READ = "A1:G";

/** Per-currency shape of a 乾坤大挪移 section: where it lives and how its rate is pinned. */
export interface TransferSectionConfig {
	cols: { date: number; ntd: number; spot: number; actual: number; spread: number; fee: number; extra: number };
	gridRead: string;
	/** GOOGLEFINANCE currency pair, e.g. "USDTWD". */
	pair: "USDTWD" | "JPYTWD";
	/** Appended to the missing-section error. */
	missingHint: string;
	/** Titles of the sections stacked BELOW this one in the same column — the 總和 scan stops there instead of running into them. */
	nextSectionLabels: readonly string[];
}

/** The trip tab's NTD→JPY 乾坤大挪移 log (columns A–G, below all trip content). */
export const JPY_TRANSFER_SECTION: TransferSectionConfig = {
	cols: TRANSFER_JPY_COLS,
	gridRead: TRANSFER_JPY_GRID_READ,
	pair: "JPYTWD",
	missingHint: "the NTD→JPY log lives on the trip tab — create the section (title/header/總和, columns A–G, below all trip content) before logging.",
	// The JPY log is the last thing on a trip tab.
	nextSectionLabels: [],
};

export interface TransferSection {
	/** 1-indexed row of the 日期/新臺幣/… header. */
	headerRow: number;
	/** 1-indexed row of the 總和 totals. */
	totalRow: number;
}

/** Locate a 乾坤大挪移 block (FORMULA-render grid of cfg.gridRead). Throws when absent or malformed. */
export function findTransferSection(
	values: unknown[][],
	tab: string,
	cfg: TransferSectionConfig,
): TransferSection {
	const dateCol = cfg.cols.date;
	const anchorRow = findRowByValue(values, dateCol, TRANSFER_SECTION_LABEL);
	if (anchorRow === null) {
		throw new Error(
			`No ${TRANSFER_SECTION_LABEL} section in ${tab} (searched column ${colLetter(dateCol)} of ${cfg.gridRead}) — ${cfg.missingHint}`,
		);
	}
	// Bottom boundary first: the 總和 row, or the title of the section stacked
	// below when the 總和 is gone — never past it into a neighbouring block.
	let totalRow: number | null = null;
	for (let r = anchorRow + 1; r <= values.length; r++) {
		const v = String(values[r - 1]?.[dateCol] ?? "").trim();
		if (v === TRANSFER_TOTAL_LABEL) {
			totalRow = r;
			break;
		}
		if (cfg.nextSectionLabels.includes(v)) break;
	}
	if (totalRow === null) {
		throw new Error(`No ${TRANSFER_TOTAL_LABEL} row under the ${TRANSFER_SECTION_LABEL} header in ${tab}.`);
	}
	// The header is SCANNED between the title and the 總和, not assumed at
	// anchor+1: a row inserted by hand (or by a neighbouring section's band
	// insert) can open a gap under the title at any time.
	let headerRow: number | null = null;
	for (let r = anchorRow + 1; r < totalRow; r++) {
		if (String(values[r - 1]?.[dateCol] ?? "").trim() === DATE_HEADER_LABEL) {
			headerRow = r;
			break;
		}
	}
	if (headerRow === null) {
		throw new Error(
			`No ${DATE_HEADER_LABEL}/新臺幣/… header row between the ${TRANSFER_SECTION_LABEL} anchor (row ${anchorRow}) and its ${TRANSFER_TOTAL_LABEL} row (${totalRow}) in ${tab}.`,
		);
	}
	return { headerRow, totalRow };
}

export interface LunchSection {
	/** 1-indexed row holding the 編列預算 / 剩餘 values. */
	budgetRow: number;
	/** 1-indexed row of the 日期/項目/金額 header. */
	headerRow: number;
	/** 1-indexed row of the 總和 total. */
	totalRow: number;
}

/** Both titles the lunch section has carried; the anchor scan accepts either. */
const LUNCH_ANCHOR_LABELS = [LUNCH_SECTION_LABEL, LUNCH_SECTION_LEGACY_LABEL];

/** Locate the 午餐預算 block (grid of FULL_GRID_READ; labels match in any render). Throws when absent or malformed. */
export function findLunchSection(values: unknown[][], tab: string): LunchSection {
	const dateCol = LUNCH_COLS.date;
	const anchorRow = findRowByLabels(values, dateCol, LUNCH_ANCHOR_LABELS);
	if (anchorRow === null) {
		throw new Error(
			`No ${LUNCH_SECTION_LABEL} section in ${tab} (searched column ${colLetter(dateCol)} of ${FULL_GRID_READ}) — the lunch-budget log exists from 7月 2026 on.`,
		);
	}
	// add_transfer's full-section path inserts a whole sheet row directly above
	// the transfer 總和 row; on live geometry that lands between this section's
	// label row and its values row, opening a blank row here. A fixed
	// anchor+3 offset would then miss the header, so scan for it — bounded by
	// the section's own 總和 row rather than by a row count, since any number of
	// rows can be opened above the header.
	let totalRow: number | null = null;
	for (let r = anchorRow + 1; r <= values.length; r++) {
		if (String(values[r - 1]?.[LUNCH_COLS.item] ?? "").trim() === LUNCH_TOTAL_LABEL) {
			totalRow = r;
			break;
		}
	}
	if (totalRow === null) {
		throw new Error(`No ${LUNCH_TOTAL_LABEL} row under the ${LUNCH_SECTION_LABEL} header in ${tab}.`);
	}
	let headerRow: number | null = null;
	for (let r = anchorRow + 1; r < totalRow; r++) {
		if (String(values[r - 1]?.[dateCol] ?? "").trim() === DATE_HEADER_LABEL) {
			headerRow = r;
			break;
		}
	}
	if (headerRow === null) {
		throw new Error(
			`No ${DATE_HEADER_LABEL}/項目/金額 header row between the ${LUNCH_SECTION_LABEL} anchor (row ${anchorRow}) and its ${LUNCH_TOTAL_LABEL} row (${totalRow}) in ${tab}.`,
		);
	}
	// The 編列預算/剩餘 values row: the first non-empty row strictly between
	// the 編列預算 label row and the header. Neither neighbour is a safe
	// anchor on its own — a transfer full-section insert opens a blank row
	// below the LABEL (values stay glued to the header), while a whole sheet
	// row inserted lower on the tab (e.g. by hand into the income list) opens
	// one above the HEADER (values stay glued to the label). Tabs missing the
	// label keep the legacy assumption (directly above the header).
	let budgetRow = headerRow - 1;
	for (let r = anchorRow + 1; r < headerRow; r++) {
		if (String(values[r - 1]?.[dateCol] ?? "").trim() !== LUNCH_BUDGET_LABEL) continue;
		for (let v = r + 1; v < headerRow; v++) {
			const cells = (values[v - 1] ?? []).slice(LUNCH_COLS.date, LUNCH_COLS.amount + 1);
			if (cells.some((c) => c !== "" && c != null)) {
				budgetRow = v;
				break;
			}
		}
		break;
	}
	return { budgetRow, headerRow, totalRow };
}

/**
 * A band-scoped "insert cells, shift down" over the 0-indexed column span
 * [startCol, endCol), starting at 1-indexed `row`. Budget months and trip
 * tabs are mosaics of side-by-side blocks (the budget list, income list and
 * category blocks share sheet rows; trip bands sit side by side) — a
 * whole-row insertDimension inside one section tears whatever block
 * straddles the insert row in the OTHER columns. Shifting only the section's
 * own columns leaves the neighbours alone; references into the shifted
 * cells (same-tab and cross-tab) adjust exactly as they would for a row
 * insert.
 */
export function bandInsert(sheetId: number, row: number, count: number, startCol: number, endCol: number): object {
	return {
		insertRange: {
			range: {
				sheetId,
				startRowIndex: row - 1,
				endRowIndex: row - 1 + count,
				startColumnIndex: startCol,
				endColumnIndex: endCol,
			},
			shiftDimension: "ROWS",
		},
	};
}

export interface IncomeWindow {
	/** First/last row (1-indexed, inclusive) of the income list, the 項目/幣別/金額 header row excluded. */
	start: number;
	end: number;
	/** True on the 本月…收支狀況 layout; false when the list still ends at the old 剩餘 row. */
	current: boolean;
}

/** The income list sits between 總預算 and 本月美金收支狀況 (current layout) or 剩餘 (old layout). Null when the tab has neither boundary. */
export function findIncomeWindow(values: unknown[][]): IncomeWindow | null {
	const budgetRow = findRowByValue(values, MONTH_COLS.budgetLabel, BUDGET_HEADER_LABEL);
	if (budgetRow === null) return null;
	let start = budgetRow + 1;
	if (String(values[start - 1]?.[MONTH_COLS.item] ?? "").trim() === INCOME_HEADER_LABEL) start++;
	const monthUsdRow = findRowByLabels(values, MONTH_COLS.budgetLabel, MONTH_USD_NET_LABELS);
	if (monthUsdRow !== null) return { start, end: monthUsdRow - 1, current: true };
	const remainderRow = findRowByValue(values, MONTH_COLS.budgetLabel, REMAINDER_LABEL);
	if (remainderRow !== null) return { start, end: remainderRow - 1, current: false };
	return null;
}

export interface SetIncomeParams {
	item: string;
	amount: number;
	currency: "TWD" | "USD";
	month?: number;
}

/** Labels that name layout rows, not income items — set_income must never write them into the income list. */
const NON_INCOME_LABELS = new Set<string>([
	BUDGET_HEADER_LABEL,
	INCOME_HEADER_LABEL,
	BANK_BLOCK_LABEL,
	REMAINDER_LABEL,
	...MONTH_USD_NET_LABELS,
	...MONTH_NTD_NET_LABELS,
	USD_PAYMENT_LABEL,
	NTD_PAYMENT_LABEL,
	TOTAL_ROW_LABEL,
	OVERDRAFT_LABEL,
	PREV_USD_OVERDRAFT_LABEL,
	PREV_NTD_OVERDRAFT_LABEL,
	USD_INCOME_LABEL,
	USD_SPENDING_LABEL,
	USD_START_BALANCE_LABEL,
	USD_END_BALANCE_LABEL,
	NTD_INCOME_LABEL,
	NTD_SPENDING_LABEL,
	NTD_START_BALANCE_LABEL,
	NTD_CONSERVATIVE_END_LABEL,
	NTD_END_BALANCE_LABEL,
	LUNCH_ADJUST_LABEL,
	REAL_SECTION_LABEL,
	REAL_NTD_START_BALANCE_LABEL,
	REAL_NTD_CASH_SPENDING_LABEL,
	REAL_NTD_CARD_PAYMENT_LABEL,
	REAL_NTD_END_BALANCE_LABEL,
	REAL_USD_START_BALANCE_LABEL,
	REAL_USD_CASH_SPENDING_LABEL,
	REAL_USD_CARD_PAYMENT_LABEL,
	REAL_USD_END_BALANCE_LABEL,
	NTD_ADJUSTMENT_LABEL,
	USD_ADJUSTMENT_LABEL,
	ADJUSTED_NTD_END_BALANCE_LABEL,
	...ADJUSTED_USD_END_BALANCE_LABELS,
	ADJUSTED_REAL_NTD_END_LABEL,
	ADJUSTED_REAL_USD_END_LABEL,
	RATE_LABEL,
	BUDGET_SUM_LABEL,
	OVERSPEND_LABEL,
	OVERSPEND_NET_LABEL,
	NTD_OVERSPEND_LABEL,
	USD_OVERSPEND_LABEL,
	USD_OVERSPEND_NET_LABEL,
	NTD_OVERSPEND_NET_LABEL,
	TOTAL_SPENDING_LABEL,
]);

/**
 * Upsert an income row on a budget month: update the row whose 項目 matches,
 * or insert a new ad-hoc row inside the income SUMIF window (so both
 * 收支狀況 SUMIFs auto-extend). Old-layout months are refused.
 */
export async function setIncome(client: SheetsClient, p: SetIncomeParams) {
	const item = p.item.trim();
	if (NON_INCOME_LABELS.has(item)) {
		throw new Error(`"${item}" is a layout label, not an income item — refusing to write it into the income list.`);
	}
	const tab = p.month !== undefined ? monthTabName(p.month) : currentMonthTab();

	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${FULL_GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, tab, FULL_GRID_READ);
	assertBudgetMonth(values, tab);
	const sheetId = await client.getSheetId(tab);

	const win = findIncomeWindow(values);
	if (win === null) {
		throw new Error(
			`Could not locate the income list in ${tab} (no "${BUDGET_HEADER_LABEL}" + "${MONTH_USD_NET_LABEL}" anchors in column ${colLetter(MONTH_COLS.budgetLabel)}).`,
		);
	}
	// The rows the 本月美金收支狀況 SUMIF covers — the only place a new income row counts.
	const sumifWin = findBudgetIncomeSumifWindow(values, tab);

	const cellStr = (r: number, c: number) => String(values[r - 1]?.[c] ?? "");
	let targetRow: number | null = null;
	for (let r = win.start; r <= win.end; r++) {
		if (cellStr(r, MONTH_COLS.item).trim() === item) {
			targetRow = r;
			break;
		}
	}

	const requests: object[] = [];
	let action: "updated" | "inserted";
	let previous: { currency: string | null; amount: string } | null = null;
	if (targetRow !== null) {
		action = "updated";
		previous = {
			currency: cellStr(targetRow, MONTH_COLS.tag).trim() || null,
			amount: cellStr(targetRow, MONTH_COLS.budgetValue),
		};
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: targetRow - 1, columnIndex: MONTH_COLS.tag },
				rows: [{ values: [cellData(p.currency), cellData(p.amount)] }],
				fields: "userEnteredValue",
			},
		});
	} else {
		action = "inserted";
		// First row whose income cells (B–D) are all empty inside the SUMIF
		// window (a row outside it would never count as income) — only the
		// list's own columns matter; the category blocks sit beside these rows
		// in the full-width read. Else insert at the window's LAST row —
		// strictly inside every range spanning the window, so the SUMIFs
		// auto-extend.
		for (let r = sumifWin.start; r <= sumifWin.end; r++) {
			const row = (values[r - 1] ?? []).slice(MONTH_COLS.item, MONTH_COLS.budgetValue + 1);
			if (!row.some((c) => c !== "" && c != null)) {
				targetRow = r;
				break;
			}
		}
		if (targetRow === null) {
			if (sumifWin.end <= sumifWin.start) {
				throw new Error(
					`The income list in ${tab} (rows ${sumifWin.start}-${sumifWin.end}) is too small to insert into safely.`,
				);
			}
			targetRow = sumifWin.end;
			// Band-scoped to the list's own columns (B–D): a whole-row insert
			// would tear the budget list and the blocks sharing these rows.
			requests.push(bandInsert(sheetId, targetRow, 1, MONTH_COLS.item, MONTH_COLS.budgetValue + 1));
		}
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: targetRow - 1, columnIndex: MONTH_COLS.item },
				rows: [{ values: [cellData(item), cellData(p.currency), cellData(p.amount)] }],
				fields: "userEnteredValue",
			},
		});
	}

	await client.batchUpdate(requests);
	return { tab, row: targetRow, action, item, amount: p.amount, currency: p.currency, previous };
}

export function quoteTab(tab: string): string {
	return `'${tab.replace(/'/g, "''")}'`;
}

export function assertNotTruncated(truncated: boolean, tab: string, range: string): void {
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
	month?: number;
	/** M/D, MM/DD, YYYY/M/D, or YYYY-MM-DD; omitted = leave the 日期 cell blank. */
	date?: string;
	/** The category block the entry goes into (中餐 or 午餐 → the 午餐 block); required on a budget month. */
	tag?: string;
	/** Which real account paid — the entry's 幣別; defaults to `currency`. */
	paidWith?: "TWD" | "USD";
}

/** add_expense: append the entry to its category block on a budget month. Old-layout months are refused. */
export async function addExpense(client: SheetsClient, p: AddExpenseParams) {
	const tab = p.month !== undefined ? monthTabName(p.month) : currentMonthTab();
	// Parse before any read/write so a bad date fails closed.
	const dateSerialValue = p.date !== undefined ? parseDateInput(p.date) : null;
	if (p.currency === "TWD" && (p.paidWith ?? p.currency) === "USD") {
		throw new Error(
			"A TWD-priced expense paid from the USD account is not representable: its 金額 would be NTD under a USD 幣別. Log it in USD (currency USD, paid_with USD) instead.",
		);
	}
	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${FULL_GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, tab, FULL_GRID_READ);
	assertBudgetMonth(values, tab);
	return addBudgetExpense(client, tab, p, dateSerialValue);
}

export interface AddTransferParams {
	/** Which transfer log to write; default "usd". */
	currency?: "usd" | "jpy";
	/** Trip tab name, exactly as it appears — jpy only. */
	tab?: string;
	/** NTD debited from the bank (新臺幣). */
	ntd: number;
	/** USD that actually arrived (實際美金) — usd only. */
	usd?: number;
	/** JPY that actually arrived (實際日幣) — jpy only. */
	jpy?: number;
	/** 手續費 in NTD. */
	fee: number;
	/** M/D, MM/DD, YYYY/M/D, or YYYY-MM-DD; omitted = today in Taipei. */
	date?: string;
	/** usd only. */
	month?: number;
}

export function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/** Shared shape of addTransfer's return; usd/spotUsd and jpy/spotJpy are mutually exclusive per currency branch. */
export interface AddTransferResult {
	tab: string;
	row: number;
	inserted: boolean;
	date: string;
	ntd: number;
	rate: number;
	spread: number;
	fee: number;
	extraCost: number;
	usd?: number;
	spotUsd?: number;
	jpy?: number;
	spotJpy?: number;
	/** Set when the entry went into a budget month's 乾坤大挪移 log. */
	layout?: "budget";
}

/**
 * Pin a transfer's rate: the entry's own 當下美金/當下日幣 cell doubles as the
 * scratch — a live GOOGLEFINANCE written in ONE batch after `preRequests`,
 * read once, then (by the caller) overwritten with the pinned formula. An
 * unusable rate clears the scratch cell and throws.
 */
export async function pinTransferRate(
	client: SheetsClient,
	tab: string,
	sheetId: number,
	preRequests: object[],
	row: number,
	spotCol: number,
	pair: "USDTWD" | "JPYTWD",
): Promise<number> {
	const scratchWrite = {
		updateCells: {
			start: { sheetId, rowIndex: row - 1, columnIndex: spotCol },
			rows: [{ values: [cellData(`=GOOGLEFINANCE("CURRENCY:${pair}")`)] }],
			fields: "userEnteredValue",
		},
	};
	await client.batchUpdate([...preRequests, scratchWrite]);

	const scratchCell = `${colLetter(spotCol)}${row}`;
	const read = await client.readRange(`${quoteTab(tab)}!${scratchCell}`, "UNFORMATTED_VALUE");
	const rate = read.values[0]?.[0];
	if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
		await client.batchUpdate([{ updateCells: { ...scratchWrite.updateCells, rows: [{ values: [{}] }] } }]);
		throw new Error(
			`GOOGLEFINANCE("CURRENCY:${pair}") did not return a usable rate (got ${JSON.stringify(rate)}); the scratch cell ${scratchCell} was cleared — try again in a moment.`,
		);
	}
	return rate;
}

/** The six value cells 新臺幣…當筆總額外花費 of transfer entry `row`, rate pinned as a literal. */
export function transferRowCells(
	cols: TransferSectionConfig["cols"],
	row: number,
	ntd: number,
	received: number,
	rate: number,
	fee: number,
): object[] {
	const B = colLetter(cols.ntd);
	const C = colLetter(cols.spot);
	const D = colLetter(cols.actual);
	const E = colLetter(cols.spread);
	const F = colLetter(cols.fee);
	return [
		cellData(ntd), // 新臺幣
		cellData(`=${B}${row}/${rate}`), // 當下美金/日幣, rate pinned at entry
		cellData(received), // 實際美金/日幣
		cellData(`=(${C}${row}-${D}${row})*${rate}`), // 匯差 in NTD
		cellData(fee), // 手續費
		cellData(`=${E}${row}+${F}${row}`), // 當筆總額外花費
	];
}

export async function addTransfer(client: SheetsClient, p: AddTransferParams): Promise<AddTransferResult> {
	const currency = p.currency ?? "usd";
	if (currency === "jpy") {
		if (!p.tab) throw new Error("currency:'jpy' logs into a trip tab — provide tab (e.g. 2026/07/25 京都東京).");
		if (p.jpy === undefined) throw new Error("currency:'jpy' needs jpy (實際日幣 that actually arrived).");
		if (p.usd !== undefined) throw new Error("currency:'jpy' takes jpy, not usd.");
		if (p.month !== undefined) {
			throw new Error("currency:'jpy' logs into a trip tab, not a month — month is not accepted.");
		}
	} else {
		if (p.usd === undefined) throw new Error("usd (實際美金 that actually arrived) is required.");
		if (p.jpy !== undefined) throw new Error("jpy is only valid with currency:'jpy'.");
		if (p.tab !== undefined) throw new Error("tab is only valid with currency:'jpy' — usd transfers target a month tab (use month).");
	}
	const tab = currency === "jpy" ? p.tab! : p.month !== undefined ? monthTabName(p.month) : currentMonthTab();
	const received = currency === "jpy" ? p.jpy! : p.usd!;
	// Parse before any read/write so a bad date fails closed.
	const dateSerialValue = p.date !== undefined ? parseDateInput(p.date) : todaySerial();

	if (currency === "usd") {
		const month = await client.readRange(`${quoteTab(tab)}!${FULL_GRID_READ}`, "FORMULA");
		assertNotTruncated(month.truncated, tab, FULL_GRID_READ);
		assertBudgetMonth(month.values, tab);
		return addBudgetTransfer(client, tab, p, dateSerialValue);
	}
	const cfg = JPY_TRANSFER_SECTION;
	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${cfg.gridRead}`, "FORMULA");
	assertNotTruncated(truncated, tab, cfg.gridRead);
	const { headerRow, totalRow } = findTransferSection(values, tab, cfg);

	// First row between the header and 總和 that is empty across the section's columns.
	let targetRow: number | null = null;
	for (let r = headerRow + 1; r < totalRow; r++) {
		const cells = (values[r - 1] ?? []).slice(cfg.cols.date, cfg.cols.extra + 1);
		if (!cells.some((c) => c !== "" && c != null)) {
			targetRow = r;
			break;
		}
	}

	const sheetId = await client.getSheetId(tab);
	const inserted = targetRow === null;
	let finalTotalRow = totalRow;
	const scratchRequests: object[] = [];
	if (targetRow === null) {
		// Insert directly above 總和, band-scoped: a trip tab is a mosaic of
		// column bands, and a whole-row insert would tear the blocks beside it.
		targetRow = totalRow;
		finalTotalRow = totalRow + 1;
		scratchRequests.push(bandInsert(sheetId, targetRow, 1, cfg.cols.date, cfg.cols.extra + 1));
	}
	const rate = await pinTransferRate(client, tab, sheetId, scratchRequests, targetRow, cfg.cols.spot, cfg.pair);

	const r = targetRow;
	const rowCells = transferRowCells(cfg.cols, r, p.ntd, received, rate, p.fee);
	// Rewrite 總和 over the whole data window: the sheet's original single-cell
	// =sum(...) cannot auto-extend, so the op owns the range from now on.
	const sumCells = [];
	for (let c = cfg.cols.ntd; c <= cfg.cols.extra; c++) {
		const col = colLetter(c);
		sumCells.push(cellData(`=SUM(${col}${headerRow + 1}:${col}${finalTotalRow - 1})`));
	}

	// Cells created by insertRange (or never-formatted empties at the sheet
	// bottom) carry no format — stamp them before the value writes (mirrors
	// addTripEntry's formatCell).
	const formatRepeat = (col: number, format: object, width: number) => ({
		repeatCell: {
			range: { sheetId, startRowIndex: r - 1, endRowIndex: r, startColumnIndex: col, endColumnIndex: col + width },
			cell: { userEnteredFormat: format },
			fields: "userEnteredFormat.numberFormat",
		},
	});
	const jpyFormatRequests = [
		formatRepeat(cfg.cols.date, { numberFormat: { type: "DATE", pattern: "mm/dd" } }, 1),
		formatRepeat(cfg.cols.spot, { numberFormat: { type: "CURRENCY", pattern: "[$¥]#,##0" } }, 2), // C:D
		formatRepeat(cfg.cols.ntd, { numberFormat: { type: "CURRENCY", pattern: "[$NTD ]#,##0" } }, 1), // B
		formatRepeat(cfg.cols.spread, { numberFormat: { type: "CURRENCY", pattern: "[$NTD ]#,##0" } }, 3), // E:G
	];

	await client.batchUpdate([
		...jpyFormatRequests,
		{
			updateCells: {
				start: { sheetId, rowIndex: r - 1, columnIndex: cfg.cols.date },
				rows: [
					{
						values: [
							{
								userEnteredValue: { numberValue: dateSerialValue },
								userEnteredFormat: { numberFormat: { type: "DATE", pattern: "mm/dd" } },
							},
						],
					},
				],
				fields: "userEnteredValue,userEnteredFormat.numberFormat",
			},
		},
		{
			updateCells: {
				start: { sheetId, rowIndex: r - 1, columnIndex: cfg.cols.ntd },
				rows: [{ values: rowCells }],
				fields: "userEnteredValue",
			},
		},
		{
			updateCells: {
				start: { sheetId, rowIndex: finalTotalRow - 1, columnIndex: cfg.cols.ntd },
				rows: [{ values: sumCells }],
				fields: "userEnteredValue",
			},
		},
	]);

	const spread = p.ntd - received * rate; // == (當下美金/日幣 − 實際美金/日幣) × rate
	const base = {
		tab,
		row: r,
		inserted,
		date: serialToIso(dateSerialValue),
		ntd: p.ntd,
		rate,
		spread: round2(spread),
		fee: p.fee,
		extraCost: round2(spread + p.fee),
	};
	return { ...base, jpy: received, spotJpy: round2(p.ntd / rate) };
}

export async function monthSummary(client: SheetsClient, month?: number) {
	const tab = month !== undefined ? monthTabName(month) : currentMonthTab();
	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${FULL_GRID_READ}`, "UNFORMATTED_VALUE");
	assertNotTruncated(truncated, tab, FULL_GRID_READ);
	if (isBudgetMonth(values)) return (await budgetMonthSummary(client, tab)) as never;

	const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
	const cellAt = (row: number | null, col: number): number | null =>
		row === null ? null : num(values[row - 1]?.[col]);
	const rowByItem = (label: string) => findRowByValue(values, MONTH_COLS.item, label);

	// Per-row 類別 breakdown: sum the TWD column by tag across the expense window.
	const totalRow = findRowByValue(values, MONTH_COLS.totalLabel, TOTAL_ROW_LABEL);
	const tags: Record<string, number> = {};
	if (totalRow !== null) {
		for (let r = 3; r < totalRow; r++) {
			const tag = String(values[r - 1]?.[MONTH_COLS.tag] ?? "").trim();
			const twd = num(values[r - 1]?.[MONTH_COLS.twd]);
			if (tag === "" || twd === null) continue;
			tags[tag] = (tags[tag] ?? 0) + twd;
		}
	}

	// Income list (current or old-layout window); empty when the tab has no 總預算 anchor.
	const win = findIncomeWindow(values);
	const incomes: Array<{ item: string; currency: string | null; amount: number | null }> = [];
	if (win !== null) {
		for (let r = win.start; r <= win.end; r++) {
			const incomeItem = String(values[r - 1]?.[MONTH_COLS.item] ?? "").trim();
			if (incomeItem === "" || incomeItem === INCOME_HEADER_LABEL) continue;
			incomes.push({
				item: incomeItem,
				currency: String(values[r - 1]?.[MONTH_COLS.tag] ?? "").trim() || null,
				amount: num(values[r - 1]?.[MONTH_COLS.budgetValue]),
			});
		}
	}

	// 午餐預算 lunch-budget section (P–R); null on tabs that predate it, and
	// also null (not thrown) when the section is torn beyond recognition —
	// this read-only summary must not die over a malformed lunch block.
	let lunch: { 編列預算: number | null; 總和: number | null; 剩餘: number | null } | null = null;
	if (findRowByLabels(values, LUNCH_COLS.date, LUNCH_ANCHOR_LABELS) !== null) {
		try {
			const sec = findLunchSection(values, tab);
			lunch = {
				編列預算: num(values[sec.budgetRow - 1]?.[LUNCH_COLS.date]),
				總和: num(values[sec.totalRow - 1]?.[LUNCH_COLS.amount]),
				剩餘: num(values[sec.budgetRow - 1]?.[LUNCH_COLS.amount]),
			};
		} catch {
			lunch = null;
		}
	}

	return {
		tab,
		花費總額: cellAt(totalRow, MONTH_COLS.totalValue),
		上月透支: cellAt(rowByItem(OVERDRAFT_LABEL), MONTH_COLS.twd),
		上月美金透支: cellAt(rowByItem(PREV_USD_OVERDRAFT_LABEL), MONTH_COLS.usd),
		上月新臺幣透支: cellAt(rowByItem(PREV_NTD_OVERDRAFT_LABEL), MONTH_COLS.twd),
		午餐預算: lunch,
		午餐超支或回補: cellAt(rowByItem(LUNCH_ADJUST_LABEL), MONTH_COLS.budgetValue),
		tags,
		incomes,
		薪水: cellAt(rowByItem(SALARY_LABEL), MONTH_COLS.budgetValue),
		沛還: cellAt(rowByItem(REPAYMENT_LABEL), MONTH_COLS.budgetValue),
		// Old-layout only (6月 2026 and earlier); null on current tabs.
		剩餘: cellAt(rowByItem(REMAINDER_LABEL), MONTH_COLS.budgetValue),
		// 7月 titles these 本月美金餘額/本月新臺幣餘額 — the label lists cover both.
		本月美金收支狀況: cellAt(findRowByLabels(values, MONTH_COLS.item, MONTH_USD_NET_LABELS), MONTH_COLS.budgetValue),
		本月新臺幣收支狀況: cellAt(findRowByLabels(values, MONTH_COLS.item, MONTH_NTD_NET_LABELS), MONTH_COLS.budgetValue),
		// 銀行餘額 block — the month's per-currency money flow (null on tabs that predate it).
		本月美金收入: cellAt(rowByItem(USD_INCOME_LABEL), MONTH_COLS.budgetValue),
		本月美金支出: cellAt(rowByItem(USD_SPENDING_LABEL), MONTH_COLS.budgetValue),
		本月初美金餘額: cellAt(rowByItem(USD_START_BALANCE_LABEL), MONTH_COLS.budgetValue),
		本月底美金餘額: cellAt(rowByItem(USD_END_BALANCE_LABEL), MONTH_COLS.budgetValue),
		本月新臺幣收入: cellAt(rowByItem(NTD_INCOME_LABEL), MONTH_COLS.budgetValue),
		本月新臺幣支出: cellAt(rowByItem(NTD_SPENDING_LABEL), MONTH_COLS.budgetValue),
		本月初新臺幣餘額: cellAt(rowByItem(NTD_START_BALANCE_LABEL), MONTH_COLS.budgetValue),
		保守預計本月底新臺幣餘額: cellAt(rowByItem(NTD_CONSERVATIVE_END_LABEL), MONTH_COLS.budgetValue),
		本月底新臺幣餘額: cellAt(rowByItem(NTD_END_BALANCE_LABEL), MONTH_COLS.budgetValue),
	};
}

/** get_categories: a budget month's category blocks. Old-layout months are refused. */
export async function getCategories(client: SheetsClient, month?: number) {
	const tab = month !== undefined ? monthTabName(month) : currentMonthTab();
	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${FULL_GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, tab, FULL_GRID_READ);
	assertBudgetMonth(values, tab);
	return budgetCategories(client, tab);
}

/** A month's carry: the previous month's negative 本月…收支狀況 (column D of `row`) becomes this month's shortfall; a positive month carries 0. */
export function carryFormula(prevTab: string, row: number): string {
	const cell = `${quoteTab(prevTab)}!${colLetter(MONTH_COLS.budgetValue)}${row}`;
	return `=IF(-(${cell}) > 0, -(${cell}), 0)`;
}

/** start_month: build "N 月" by copying the "Budget Based" template (see startBudgetMonth). */
export async function startMonth(client: SheetsClient, month: number, opts: { now?: Date; newSheetId?: number } = {}) {
	const tabs = (await client.listTabs()).map((t) => t.title);
	if (!tabs.includes(BUDGET_TEMPLATE_TAB)) {
		throw new Error(`No "${BUDGET_TEMPLATE_TAB}" template tab — start_month builds every month from it.`);
	}
	return startBudgetMonth(client, month, tabs, { now: opts.now ?? new Date(), newSheetId: opts.newSheetId });
}

export interface TripEntryParams {
	tab: string;
	category: string;
	date: string;
	shop: string;
	item: string;
	paymentMethod: string;
	jpy?: number;
	twd?: number;
}

// Unbounded rows, same reason as FULL_GRID_READ: a trip tab grows as the trip
// does, and a clipped read makes a block look torn instead of failing loudly.
const TRIP_READ = "A1:AL";
/** Canonical band cell formats: 日期 as mm/dd hh:mm, prices with their currency sign. */
const TRIP_DATE_FORMAT = { type: "DATE_TIME", pattern: 'mm"/"dd" "hh":"mm' };
const TRIP_JPY_FORMAT = { type: "CURRENCY", pattern: "[$¥]#,##0" };
const TRIP_TWD_FORMAT = { type: "CURRENCY", pattern: "[$NTD ]#,##0.00" };
/** Plain single-column SUM: a range like =SUM(M10:M12) or a single cell like =SUM(E37). */
const PLAIN_SUM_RANGE_RE = /^=SUM\(([A-Z]{1,2})(\d+)(?::\1(\d+))?\)$/i;
/** Data columns per trip block (the band width minus its spacer column). */
const BAND_COLS = TRIP_BLOCK_WIDTH - 1;

export async function addTripEntry(client: SheetsClient, p: TripEntryParams) {
	if ((p.jpy === undefined) === (p.twd === undefined)) {
		throw new Error("Provide exactly one of jpy or twd for a trip entry.");
	}

	const { values, truncated } = await client.readRange(`${quoteTab(p.tab)}!${TRIP_READ}`, "FORMULA");
	assertNotTruncated(truncated, p.tab, TRIP_READ);

	const blocks = findTripBlocks(values);
	const block = blocks.find((b) => b.category === p.category.trim());
	if (!block) {
		throw new Error(
			`Category block "${p.category}" not found in ${p.tab}. Blocks present: ${blocks.map((b) => b.category).join(", ")}`,
		);
	}
	const { startCol, firstDataRow, endRow } = block;
	const cellStr = (r: number, c: number) => String(values[r - 1]?.[c] ?? "").trim();

	// The block's …總花費 row (endRow when terminated by one) and its two total cells.
	const endRowBand = Array.from({ length: BAND_COLS }, (_, i) => cellStr(endRow, startCol + i));
	const totalRow = endRowBand.some(
		(v) => v.includes(TRIP_TOTAL_LABEL) || (v.startsWith("=") && /sum\(/i.test(v)),
	)
		? endRow
		: null;
	const totals = (totalRow === null ? [] : [4, 6]).map((off) => {
		const formula = cellStr(totalRow!, startCol + off);
		const m = formula.match(PLAIN_SUM_RANGE_RE);
		return {
			col: startCol + off,
			formula,
			parsed: m ? { col: m[1], a: Number(m[2]), b: Number(m[3] ?? m[2]) } : null,
		};
	});

	// Target: first fully-empty band row inside the region.
	let targetRow: number | null = null;
	for (let r = firstDataRow; r < endRow; r++) {
		if (Array.from({ length: BAND_COLS }, (_, i) => cellStr(r, startCol + i)).every((v) => v === "")) {
			targetRow = r;
			break;
		}
	}

	const insertNeeded = targetRow === null;
	if (insertNeeded) {
		if (totalRow === null) {
			throw new Error(
				`Block "${p.category}" in ${p.tab} is full and has no ${TRIP_TOTAL_LABEL} row to anchor a safe cell insert — add rows to it manually.`,
			);
		}
		for (const t of totals) {
			if (t.formula.startsWith("=") && t.parsed === null) {
				throw new Error(
					`Block "${p.category}" is full and its total formula "${t.formula}" is not a plain =SUM(range) — cannot safely extend it. Add a row to the block manually.`,
				);
			}
		}
		targetRow = totalRow;
	}
	const row = targetRow!;

	// Totals whose SUM range doesn't cover the new row get rewritten.
	const rewrites = totals.filter((t) => t.parsed !== null && (row < t.parsed.a || row > t.parsed.b));

	// 支付方式 is a dropdown (chip) column. A written value only renders as a chip
	// if the cell carries the dropdown's data-validation rule — empty rows and
	// freshly inserted cells don't, so the plain string shows as bare text. Copy
	// the rule from an existing entry in the same block onto the target cell so
	// the new payment method renders like a hand-picked one. Source is the first
	// real entry above the target (shift-safe: it never moves when we insert below).
	const payCol = startCol + 3;
	let validationSrcRow: number | null = null;
	if (p.paymentMethod.trim() !== "") {
		for (let r = firstDataRow; r < endRow; r++) {
			if (r === row) continue;
			const pay = cellStr(r, payCol);
			if (pay === "" || pay === "支付方式" || pay === "預算" || pay.includes(TRIP_TOTAL_LABEL)) continue;
			if (cellStr(r, startCol) === TRIP_HEADER_DATE) continue;
			validationSrcRow = r;
			break;
		}
	}

	const sheetId = await client.getSheetId(p.tab);
	const requests: object[] = [];
	if (insertNeeded) {
		requests.push({
			insertRange: {
				range: {
					sheetId,
					startRowIndex: row - 1,
					endRowIndex: row,
					startColumnIndex: startCol,
					endColumnIndex: startCol + BAND_COLS,
				},
				shiftDimension: "ROWS",
			},
		});
	}
	for (const t of rewrites) {
		const a = Math.min(t.parsed!.a, row);
		const b = Math.max(t.parsed!.b, row);
		// A cell insert at `row` shifts the total row itself down by one.
		const totalRowFinal = insertNeeded ? totalRow! + 1 : totalRow!;
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: totalRowFinal - 1, columnIndex: t.col },
				rows: [{ values: [cellData(`=SUM(${t.parsed!.col}${a}:${t.parsed!.col}${b})`)] }],
				fields: "userEnteredValue",
			},
		});
	}
	if (validationSrcRow !== null) {
		// Paste only the data validation (the chip dropdown) — not values or
		// formatting — from an existing entry onto the target 支付方式 cell.
		requests.push({
			copyPaste: {
				source: {
					sheetId,
					startRowIndex: validationSrcRow - 1,
					endRowIndex: validationSrcRow,
					startColumnIndex: payCol,
					endColumnIndex: payCol + 1,
				},
				destination: {
					sheetId,
					startRowIndex: row - 1,
					endRowIndex: row,
					startColumnIndex: payCol,
					endColumnIndex: payCol + 1,
				},
				pasteType: "PASTE_DATA_VALIDATION",
			},
		});
	}
	// Stamp the band's canonical formats onto the target row BEFORE the value
	// write: the cells it lands in may carry no format at all (cells created by
	// the insertRange above, or empty rows the sheet owner never pre-formatted),
	// which renders the date without its HH:mm time, prices without their ¥/NTD
	// sign, and 店鋪/品項 left-aligned instead of centered. USER_ENTERED values
	// keep an existing cell format, so formats applied here survive the write.
	const formatCell = (col: number, format: object, fields: string, width = 1) => ({
		repeatCell: {
			range: {
				sheetId,
				startRowIndex: row - 1,
				endRowIndex: row,
				startColumnIndex: col,
				endColumnIndex: col + width,
			},
			cell: { userEnteredFormat: format },
			fields,
		},
	});
	requests.push(
		formatCell(startCol, { numberFormat: TRIP_DATE_FORMAT }, "userEnteredFormat.numberFormat"),
		formatCell(startCol + 1, { horizontalAlignment: "CENTER" }, "userEnteredFormat.horizontalAlignment", 2),
		formatCell(startCol + 4, { numberFormat: TRIP_JPY_FORMAT }, "userEnteredFormat.numberFormat"),
		formatCell(startCol + 5, { numberFormat: TRIP_TWD_FORMAT }, "userEnteredFormat.numberFormat", 2),
	);
	// A band-scoped insertRange copies the neighbouring row's userEnteredFormat —
	// including its cell fill — onto the fresh cells, so a full block's new entry
	// would inherit an unwanted background (empty-row writes touch no format and
	// need no reset). Clear the whole band's fill back to default: an empty cell
	// with a backgroundColor field mask deletes the property rather than guessing
	// a colour. Runs after the numberFormat/alignment stamps (disjoint fields).
	if (insertNeeded) {
		requests.push({
			repeatCell: {
				range: {
					sheetId,
					startRowIndex: row - 1,
					endRowIndex: row,
					startColumnIndex: startCol,
					endColumnIndex: startCol + BAND_COLS,
				},
				cell: {},
				fields: "userEnteredFormat.backgroundColor,userEnteredFormat.backgroundColorStyle",
			},
		});
	}
	await client.batchUpdate(requests);

	// Conversion columns: adapt the row above's formulas for JPY entries; TWD entries are direct.
	const jpyCol = colLetter(startCol + 4);
	const twdCol = colLetter(startCol + 5);
	let twdValue: string | number;
	let roundFormula = `=CEILING(${twdCol}${row})`;
	if (p.twd !== undefined) {
		twdValue = p.twd;
	} else {
		twdValue = `=${jpyCol}${row}*0.22`;
		const prevRow = row - 1;
		if (prevRow >= firstDataRow) {
			const prevTwd = cellStr(prevRow, startCol + 5);
			const prevRound = cellStr(prevRow, startCol + 6);
			if (prevTwd.startsWith("=")) twdValue = adaptRowFormula(prevTwd, prevRow, row);
			if (prevRound.startsWith("=")) roundFormula = adaptRowFormula(prevRound, prevRow, row);
		}
	}

	const range = `${quoteTab(p.tab)}!${colLetter(startCol)}${row}:${colLetter(startCol + BAND_COLS - 1)}${row}`;
	const result = await client.updateRange(range, [
		[p.date, p.shop, p.item, p.paymentMethod, p.jpy ?? "", twdValue, roundFormula],
	]);
	return {
		tab: p.tab,
		category: block.category,
		row,
		updatedRange: result.updatedRange,
		currency: p.jpy !== undefined ? ("JPY" as const) : ("TWD" as const),
	};
}

export interface TripBlock {
	category: string;
	headerRow: number;
	startCol: number;
	firstDataRow: number;
	endRow: number;
}

/** Discover trip category blocks: header row (日期+店鋪), label on the next row, region bounded by a …總花費 row / next header / scan cap. */
export function findTripBlocks(values: unknown[][]): TripBlock[] {
	const cell = (r: number, c: number) => String(values[r - 1]?.[c] ?? "").trim();

	const blocks: TripBlock[] = [];
	for (let r = 1; r <= values.length; r++) {
		const rowLen = (values[r - 1] ?? []).length;
		for (let c = 0; c < rowLen; c++) {
			if (cell(r, c) !== TRIP_HEADER_DATE || cell(r, c + 1) !== TRIP_HEADER_SHOP) continue;

			let category = "";
			for (let lc = c; lc < c + BAND_COLS; lc++) {
				const v = cell(r + 1, lc);
				if (v !== "") {
					category = v;
					break;
				}
			}
			if (category === "") continue; // stray header with no label beneath

			const firstDataRow = r + 2;
			// Scan the whole read window for the block's terminator — a real block
			// can outgrow any fixed depth (餐(當下吃的) passed 30 data rows
			// mid-trip and its 食總花費 row fell off a capped scan, wedging the
			// tool). TRIP_MAX_BLOCK_ROWS only bounds the fallback endRow when no
			// terminator exists at all, so a headerless tail can't swallow
			// unrelated content below the block.
			let endRow = firstDataRow + TRIP_MAX_BLOCK_ROWS;
			for (let br = firstDataRow; br <= values.length; br++) {
				const band = Array.from({ length: BAND_COLS }, (_, i) => cell(br, c + i));
				if (band.some((v) => v.includes(TRIP_TOTAL_LABEL))) {
					endRow = br;
					break;
				}
				// An untitled per-block summary row (e.g. 交通's) is recognizable by its =SUM(...) cells.
				if (band.some((v) => v.startsWith("=") && /sum\(/i.test(v))) {
					endRow = br;
					break;
				}
				if (cell(br, c) === TRIP_HEADER_DATE && cell(br, c + 1) === TRIP_HEADER_SHOP) {
					endRow = br;
					break;
				}
			}
			blocks.push({ category, headerRow: r, startCol: c, firstDataRow, endRow });
		}
	}
	return blocks;
}

/** The 目前實際開銷 summary sits right of every category band (~AI46 today) — wider than TRIP_READ, so read the full tab width; rows unbounded, like every other grid read. */
export const TRIP_BUDGET_READ = "A1:AZ";

export interface TripBudgetSection {
	/** 1-indexed row of the 目前實際開銷 title. */
	anchorRow: number;
	/** 1-indexed row of the 分類/金額/預算/預算餘額/餘額 JP header. */
	headerRow: number;
	/** 0-indexed column of the title/分類 — the section's first column. */
	startCol: number;
}

/** Locate the 目前實際開銷 summary anywhere in the grid: the title cell with the 分類 header directly below it. Throws when absent. */
export function findTripBudgetSection(values: unknown[][], tab: string): TripBudgetSection {
	const cell = (r: number, c: number) => String(values[r - 1]?.[c] ?? "").trim();
	for (let r = 1; r <= values.length; r++) {
		const rowLen = (values[r - 1] ?? []).length;
		for (let c = 0; c < rowLen; c++) {
			if (cell(r, c) !== TRIP_BUDGET_SECTION_LABEL) continue;
			if (cell(r + 1, c) !== TRIP_BUDGET_CATEGORY_HEADER) continue;
			return { anchorRow: r, headerRow: r + 1, startCol: c };
		}
	}
	throw new Error(
		`No ${TRIP_BUDGET_SECTION_LABEL} summary in ${tab} (searched ${TRIP_BUDGET_READ} for the title with a ${TRIP_BUDGET_CATEGORY_HEADER} header directly below it).`,
	);
}

export interface TripBudgetCategory {
	分類: string;
	/** Actual spend so far, NTD. */
	金額: number | null;
	預算: number | null;
	/** 預算 − 金額 — what's left of the category's budget, NTD. */
	預算餘額: number | null;
	/** The remainder converted to JPY. */
	"餘額 JP": number | null;
}

/**
 * Read a trip tab's 目前實際開銷 budget-vs-actual summary: one entry per
 * budget category with its 金額 (spent) / 預算 / 預算餘額 / 餘額 JP, plus
 * totals summed here from the category rows (the sheet's own =SUM total and
 * the hand subtotal below it are layout cells, not categories, and are
 * excluded). The list ends at the first row whose 分類 cell holds no text.
 */
export async function tripBudgetStatus(client: SheetsClient, p: { tab: string }) {
	const { values, truncated } = await client.readRange(`${quoteTab(p.tab)}!${TRIP_BUDGET_READ}`, "UNFORMATTED_VALUE");
	assertNotTruncated(truncated, p.tab, TRIP_BUDGET_READ);
	const sec = findTripBudgetSection(values, p.tab);

	const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
	const categories: TripBudgetCategory[] = [];
	for (let r = sec.headerRow + 1; r <= values.length; r++) {
		const row = values[r - 1] ?? [];
		// A numeric 分類 cell is the hand subtotal under the list, not a category.
		const name = row[sec.startCol];
		if (typeof name !== "string" || name.trim() === "") break;
		categories.push({
			分類: name.trim(),
			金額: num(row[sec.startCol + 1]),
			預算: num(row[sec.startCol + 2]),
			預算餘額: num(row[sec.startCol + 3]),
			"餘額 JP": num(row[sec.startCol + TRIP_BUDGET_WIDTH - 1]),
		});
	}

	const total = (pick: (c: TripBudgetCategory) => number | null): number =>
		round2(categories.reduce((s, c) => s + (pick(c) ?? 0), 0));
	return {
		tab: p.tab,
		categories,
		totals: {
			金額: total((c) => c.金額),
			預算: total((c) => c.預算),
			預算餘額: total((c) => c.預算餘額),
		},
	};
}

export interface AnnotatedRows {
	startRow: number;
	rows: Array<{ row: number; values: unknown[] }>;
}

/** Row-number a values grid using the A1 range the API echoed ("'9 月'!A3:F60" → startRow 3). Empty rows are omitted. */
export function annotateRows(range: string, values: unknown[][]): AnnotatedRows {
	const m = range.match(/![A-Za-z]*(\d+)/);
	const startRow = m ? Number(m[1]) : 1;
	const rows: Array<{ row: number; values: unknown[] }> = [];
	for (let i = 0; i < values.length; i++) {
		const row = values[i] ?? [];
		if (row.some((c) => c !== "" && c != null)) {
			rows.push({ row: startRow + i, values: row });
		}
	}
	return { startRow, rows };
}

/** "A" → 0, "I" → 8, "AA" → 26 — the inverse of colLetter. */
export function colIndex(letter: string): number {
	let n = 0;
	for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n - 1;
}

/** Expand a single-cell anchor range to the rectangle `values` will actually cover ("'9 月'!A22" + 1x3 values → "'9 月'!A22:C22"). */
export function expandAnchorRange(range: string, values: unknown[][]): string {
	const m = range.match(/^(.*!)?\$?([A-Za-z]+)\$?(\d+)$/);
	if (!m) return range; // already a rectangle or open-ended range
	const sheet = m[1] ?? "";
	const colLetters = m[2].toUpperCase();
	const startRow = Number(m[3]);
	const rows = values.length;
	const cols = Math.max(1, ...values.map((r) => r.length));
	if (rows <= 1 && cols <= 1) return range;
	const startCol = colIndex(colLetters);
	return `${sheet}${colLetters}${startRow}:${colLetter(startCol + cols - 1)}${startRow + rows - 1}`;
}

/**
 * update_range with a seatbelt: reads the target first (the read IS the
 * safety mechanism — two calls, deliberately not atomic), optionally refuses
 * non-empty targets, and always returns what was there before the write.
 */
export async function safeUpdateRange(
	client: SheetsClient,
	range: string,
	values: unknown[][],
	expectEmpty = false,
): Promise<{ updatedRange: string; updatedCells: number; previousValues: AnnotatedRows }> {
	const readTarget = expandAnchorRange(range, values);
	const before = await client.readRange(readTarget, "FORMULA");
	if (before.truncated) {
		throw new Error(`Refusing to write: reading ${readTarget} back was truncated, so its current contents cannot be verified.`);
	}
	const echoed = before.range || range;
	const previousValues = annotateRows(echoed, before.values);

	if (expectEmpty) {
		const colMatch = echoed.match(/!\$?([A-Za-z]+)\$?\d*/);
		const startCol = colMatch ? colIndex(colMatch[1].toUpperCase()) : 0;
		const occupied: string[] = [];
		for (const r of previousValues.rows) {
			r.values.forEach((c, j) => {
				if (c !== "" && c != null) {
					occupied.push(`${colLetter(startCol + j)}${r.row}=${String(c).slice(0, 40)}`);
				}
			});
		}
		if (occupied.length > 0) {
			const listed = occupied.slice(0, 10).join(", ");
			const more = occupied.length > 10 ? ` (+${occupied.length - 10} more)` : "";
			throw new Error(
				`expect_empty: target range ${range} is not empty — refusing to overwrite. Occupied: ${listed}${more}`,
			);
		}
	}

	const result = await client.updateRange(range, values);
	return { ...result, previousValues };
}

export const FIND_CELLS_CAP = 50;

export interface FindCellsParams {
	query: string;
	tab?: string;
	match?: "contains" | "exact";
}

/** Find cells by text and return exact A1 addresses — the alternative to reading big ranges and counting rows. */
export async function findCells(client: SheetsClient, p: FindCellsParams) {
	const mode = p.match ?? "contains";
	const needle = mode === "contains" ? p.query.toLowerCase() : p.query.trim();
	const tabs = p.tab !== undefined ? [p.tab] : (await client.listTabs()).map((t) => t.title);

	const matches: Array<{ tab: string; cell: string; row: number; column: string; value: string }> = [];
	let truncated = false;
	outer: for (const tab of tabs) {
		const { values, truncated: readTruncated } = await client.readRange(quoteTab(tab));
		if (readTruncated) truncated = true;
		for (let i = 0; i < values.length; i++) {
			const row = values[i] ?? [];
			for (let j = 0; j < row.length; j++) {
				const raw = String(row[j] ?? "");
				if (raw === "") continue;
				const hit = mode === "contains" ? raw.toLowerCase().includes(needle) : raw.trim() === needle;
				if (!hit) continue;
				if (matches.length >= FIND_CELLS_CAP) {
					truncated = true;
					break outer;
				}
				matches.push({ tab, cell: `${colLetter(j)}${i + 1}`, row: i + 1, column: colLetter(j), value: raw });
			}
		}
	}
	return { matches, truncated };
}

// ---------------------------------------------------------------------------
// Deletes — removing a row entirely, rather than blanking its cells.
// ---------------------------------------------------------------------------

/** A 0-indexed half-open column span: the columns one section owns. */
export interface ColumnBand {
	startCol: number;
	/** Exclusive. */
	endCol: number;
}

const COLUMN_BAND_RE = /^([A-Za-z]{1,2})(?::([A-Za-z]{1,2}))?$/;

/** Parse a column band spec ("A:G", "P:S", or a single "R") into a 0-indexed half-open span. */
export function parseColumnBand(spec: string): ColumnBand {
	const m = spec.trim().match(COLUMN_BAND_RE);
	if (m === null) {
		throw new Error(`Invalid columns "${spec}" — expected column letters like "A:G" (a band) or "R" (one column).`);
	}
	const startCol = colIndex((m[1] as string).toUpperCase());
	const endCol = colIndex(((m[2] ?? m[1]) as string).toUpperCase()) + 1;
	if (endCol <= startCol) {
		throw new Error(`Invalid columns "${spec}" — the band's last column is left of its first.`);
	}
	return { startCol, endCol };
}

/** A formula that points STRAIGHT at a cell a delete would remove — it would become #REF!. */
export interface BrokenRef {
	/** A1 address of the formula cell, e.g. "P35". */
	cell: string;
	/** The reference that would break, e.g. "E5". */
	ref: string;
	formula: string;
}

// One pass over a formula, longest-first so a reference is only ever read as
// its widest form: a cross-tab reference ('8 月'!D19, 火車模型!D4) first, then
// a range (E3:E10), then a bare single cell ($E$5). The lookbehind keeps
// LOG10(...) / CEILING12 style text from being read as a column+row, the same
// guard adaptRowFormula uses.
const REF_SCAN =
	/(?:'(?:[^']|'')*'|[^\s!,()+\-*/&=<>]+)!\$?[A-Za-z]{1,2}\$?\d+(?::\$?[A-Za-z]{1,2}\$?\d+)?|(?<![A-Za-z0-9_$!.])\$?([A-Za-z]{1,2})\$?(\d+)(?::\$?[A-Za-z]{1,2}\$?\d+)?/g;

/**
 * Same-tab single-cell references a delete of rows [startRow, endRow] over
 * `band` would orphan. RANGE references (=SUM(E3:E10)) are fine — Sheets
 * shrinks them with the delete, which is exactly how 花費總額 and every SUMIF
 * window keep covering the list — and cross-tab references are another tab's
 * business (this scan sees one grid). What breaks is a formula naming a single
 * deleted cell, like the 午餐預算 block's 編列預算 =E5 pointing at the 中餐
 * expense row. Formulas INSIDE the deleted rows are skipped: they go away too.
 */
export function findBrokenRefs(
	values: unknown[][],
	band: ColumnBand,
	startRow: number,
	endRow: number,
): BrokenRef[] {
	const broken: BrokenRef[] = [];
	for (let i = 0; i < values.length; i++) {
		const row = i + 1;
		const cells = values[i] ?? [];
		for (let j = 0; j < cells.length; j++) {
			const formula = cells[j];
			if (typeof formula !== "string" || !formula.startsWith("=")) continue;
			// A formula inside the deleted band+rows disappears with them.
			if (row >= startRow && row <= endRow && j >= band.startCol && j < band.endCol) continue;
			// String literals can hold anything ("CURRENCY:USDTWD", ">"&E5 is
			// outside the quotes) — drop them before scanning for references.
			const scannable = formula.replace(/"(?:[^"]|"")*"/g, '""');
			for (const m of scannable.matchAll(REF_SCAN)) {
				const [, colLetters, rowDigits] = m;
				if (colLetters === undefined || rowDigits === undefined) continue; // cross-tab
				if (m[0].includes(":")) continue; // a range: it shrinks, it does not break
				const refRow = Number(rowDigits);
				const refCol = colIndex(colLetters.toUpperCase());
				if (refRow < startRow || refRow > endRow) continue;
				if (refCol < band.startCol || refCol >= band.endCol) continue;
				broken.push({ cell: `${colLetter(j)}${row}`, ref: m[0], formula });
			}
		}
	}
	return broken;
}

function describeBrokenRefs(refs: BrokenRef[]): string {
	const listed = refs.slice(0, 5).map((r) => `${r.cell} (${r.formula})`).join(", ");
	return refs.length > 5 ? `${listed} (+${refs.length - 5} more)` : listed;
}

export interface DeleteRowsParams {
	tab: string;
	/** 1-indexed first row to delete. */
	row: number;
	count: number;
	/** Column band to scope the delete to, e.g. "A:G"; omitted = whole rows. */
	columns?: string;
	/** Delete even when a formula points straight at a deleted cell. */
	force?: boolean;
}

export interface DeleteRowsResult {
	tab: string;
	row: number;
	count: number;
	columns: string | null;
	/** What was removed (formulas, not display values) — enough to re-enter it. */
	deletedValues: AnnotatedRows;
	/** Why the reference check was skipped, or which formulas force:true broke. */
	refWarning?: string;
}

/**
 * delete_rows with a seatbelt: reads the tab first (the read IS the safety
 * mechanism — two calls, deliberately not atomic), refuses when a formula
 * points straight at a cell about to vanish, and always returns what it
 * removed. The complement of safeUpdateRange, which can only blank cells.
 */
export async function safeDeleteRows(client: SheetsClient, p: DeleteRowsParams): Promise<DeleteRowsResult> {
	const band = p.columns !== undefined ? parseColumnBand(p.columns) : null;
	const lastRow = p.row + p.count - 1;
	const scanBand = band ?? { startCol: 0, endCol: Number.MAX_SAFE_INTEGER };

	const grid = await client.readRange(quoteTab(p.tab), "FORMULA");
	let refWarning: string | undefined;
	let deletedValues: AnnotatedRows;
	if (grid.truncated) {
		// The tab is too big to read whole, so the reference scan cannot be
		// trusted. Fall back to a narrow read for the record and say so.
		const target = band === null
			? `${quoteTab(p.tab)}!${p.row}:${lastRow}`
			: `${quoteTab(p.tab)}!${colLetter(band.startCol)}${p.row}:${colLetter(band.endCol - 1)}${lastRow}`;
		const before = await client.readRange(target, "FORMULA");
		if (before.truncated) {
			throw new Error(`Refusing to delete: reading ${target} back was truncated, so its contents cannot be recorded.`);
		}
		deletedValues = annotateRows(before.range || target, before.values);
		refWarning = `${p.tab} is too large to read in one call, so formulas pointing at the deleted cells were NOT checked — look for #REF! on the tab afterwards.`;
	} else {
		const rows: AnnotatedRows["rows"] = [];
		for (let r = p.row; r <= lastRow; r++) {
			const cells = (grid.values[r - 1] ?? []).slice(
				scanBand.startCol,
				band === null ? undefined : band.endCol,
			);
			if (cells.some((c) => c !== "" && c != null)) rows.push({ row: r, values: cells });
		}
		deletedValues = { startRow: p.row, rows };

		const broken = findBrokenRefs(grid.values, scanBand, p.row, lastRow);
		if (broken.length > 0) {
			if (p.force !== true) {
				throw new Error(
					`Refusing to delete rows ${p.row}-${lastRow} of ${p.tab}: ${broken.length} formula(s) point straight at cells being deleted and would turn into #REF! — ${describeBrokenRefs(broken)}. Re-point them first, or pass force:true to delete anyway.`,
				);
			}
			refWarning = `force:true — ${broken.length} formula(s) now show #REF!: ${describeBrokenRefs(broken)}`;
		}
	}

	await client.deleteRows(p.tab, p.row, p.count, band ?? undefined);
	return { tab: p.tab, row: p.row, count: p.count, columns: p.columns ?? null, deletedValues, refWarning };
}

export interface DeleteExpenseParams {
	item: string;
	month?: number;
	/** 1-indexed sheet row, to disambiguate duplicate 項目 names. */
	row?: number;
	/** The category block to search; every block has entries on the same sheet rows. */
	tag?: string;
}

/**
 * delete_expense: remove a block entry from a budget month — a delete scoped
 * to that block's columns, so only its entries below move up. Old-layout
 * months are refused.
 */
export async function deleteExpense(client: SheetsClient, p: DeleteExpenseParams) {
	const tab = p.month !== undefined ? monthTabName(p.month) : currentMonthTab();
	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${FULL_GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, tab, FULL_GRID_READ);
	assertBudgetMonth(values, tab);
	return deleteBudgetExpense(client, tab, p);
}
