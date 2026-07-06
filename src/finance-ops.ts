/**
 * Operations that understand Vincent's sheet conventions. Pure helpers here;
 * client-calling ops (addExpense, monthSummary, startMonth, addTripEntry)
 * live in this module too and are the only writers the tailored tools use.
 */

import {
	BANK_BLOCK_LABEL,
	BUDGET_HEADER_LABEL,
	currentMonthTab,
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
	NTD_BALANCE_LABEL,
	NTD_INCOME_LABEL,
	NTD_PAYMENT_LABEL,
	NTD_SPENDING_LABEL,
	NTD_WRITEOFF_LABEL,
	OVERDRAFT_LABEL,
	parseDateInput,
	PREV_NTD_BALANCE_LABEL,
	PREV_NTD_OVERDRAFT_LABEL,
	PREV_USD_BALANCE_LABEL,
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
	TRANSFER_COLS,
	TRANSFER_SECTION_LABEL,
	TRANSFER_TOTAL_LABEL,
	TRIP_HEADER_DATE,
	TRIP_HEADER_SHOP,
	TRIP_BLOCK_WIDTH,
	TRIP_MAX_BLOCK_ROWS,
	TRIP_TOTAL_LABEL,
	USD_BALANCE_LABEL,
	USD_WRITEOFF_LABEL,
	USD_INCOME_LABEL,
	USD_PAYMENT_LABEL,
	USD_SPENDING_LABEL,
} from "./conventions";
import type { SheetsClient } from "./sheets-client";

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

/** The window that contains every anchor a monthly tab needs. */
export const GRID_READ = "A1:H60";

const USD_COL = colLetter(MONTH_COLS.usd);
const TWD_COL = colLetter(MONTH_COLS.twd);
const EXPENSE_WINDOW_RE = new RegExp(`^=SUM\\(${TWD_COL}(\\d+):${TWD_COL}(\\d+)\\)$`, "i");

export interface ExpenseWindow {
	totalRow: number;
	start: number;
	end: number;
}

/** Locate the expense window from the 花費總額 =SUM(Estart:Eend) formula (FORMULA-render grid). Throws when it cannot be trusted. */
export function findExpenseWindow(values: unknown[][], tab: string): ExpenseWindow {
	const totalRow = findRowByValue(values, MONTH_COLS.totalLabel, TOTAL_ROW_LABEL);
	if (totalRow === null) {
		throw new Error(
			`Could not find the "${TOTAL_ROW_LABEL}" row in ${tab} (searched column ${colLetter(MONTH_COLS.totalLabel)} of ${GRID_READ}).`,
		);
	}
	const totalFormula = String(values[totalRow - 1]?.[MONTH_COLS.totalValue] ?? "");
	const m = totalFormula.match(EXPENSE_WINDOW_RE);
	if (!m) {
		throw new Error(
			`The "${TOTAL_ROW_LABEL}" cell ${TWD_COL}${totalRow} in ${tab} is not a plain =SUM(${TWD_COL}start:${TWD_COL}end) formula (got "${totalFormula}") — cannot locate the expense window safely.`,
		);
	}
	return { totalRow, start: Number(m[1]), end: Number(m[2]) };
}

/** The 乾坤大挪移 section spans G–M, wider than GRID_READ — read the full width. */
export const TRANSFER_GRID_READ = "A1:M60";

export interface TransferSection {
	/** 1-indexed row of the 日期/新臺幣/… header. */
	headerRow: number;
	/** 1-indexed row of the 總和 totals. */
	totalRow: number;
}

/** Locate the 乾坤大挪移 block (FORMULA-render grid of TRANSFER_GRID_READ). Throws when absent or malformed. */
export function findTransferSection(values: unknown[][], tab: string): TransferSection {
	const dateCol = TRANSFER_COLS.date;
	const anchorRow = findRowByValue(values, dateCol, TRANSFER_SECTION_LABEL);
	if (anchorRow === null) {
		throw new Error(
			`No ${TRANSFER_SECTION_LABEL} section in ${tab} (searched column ${colLetter(dateCol)} of ${TRANSFER_GRID_READ}) — the transfer log exists from 7月 2026 on.`,
		);
	}
	const headerRow = anchorRow + 1;
	if (String(values[headerRow - 1]?.[dateCol] ?? "").trim() !== "日期") {
		throw new Error(
			`The row under the ${TRANSFER_SECTION_LABEL} anchor in ${tab} is not the 日期/新臺幣/… header row.`,
		);
	}
	for (let r = headerRow + 1; r <= values.length; r++) {
		if (String(values[r - 1]?.[dateCol] ?? "").trim() === TRANSFER_TOTAL_LABEL) {
			return { headerRow, totalRow: r };
		}
	}
	throw new Error(`No ${TRANSFER_TOTAL_LABEL} row under the ${TRANSFER_SECTION_LABEL} header in ${tab}.`);
}

// The lunch section grows one row per entry and pushes the 銀行餘額 block
// below it downward, so the window must hold a full month of daily entries —
// a too-shallow read makes startMonth's 上月…餘額 rewire silently skip.
export const LUNCH_GRID_READ = "A1:Q120";

export interface LunchSection {
	/** 1-indexed row holding the 編列預算 / 剩餘 values. */
	budgetRow: number;
	/** 1-indexed row of the 日期/項目/金額 header. */
	headerRow: number;
	/** 1-indexed row of the 總和 total. */
	totalRow: number;
}

/** Locate the 中餐預算 block (grid of LUNCH_GRID_READ; labels match in any render). Throws when absent or malformed. */
export function findLunchSection(values: unknown[][], tab: string): LunchSection {
	const dateCol = LUNCH_COLS.date;
	const anchorRow = findRowByValue(values, dateCol, LUNCH_SECTION_LABEL);
	if (anchorRow === null) {
		throw new Error(
			`No ${LUNCH_SECTION_LABEL} section in ${tab} (searched column ${colLetter(dateCol)} of ${LUNCH_GRID_READ}) — the lunch-budget log exists from 7月 2026 on.`,
		);
	}
	// add_transfer's full-section path inserts a whole sheet row directly above
	// the transfer 總和 row; on live geometry that lands between this section's
	// label row and its values row, opening a blank row here. A fixed
	// anchor+3 offset would then miss the header, so scan for it instead.
	let headerRow: number | null = null;
	for (let r = anchorRow + 1; r <= anchorRow + 8; r++) {
		if (String(values[r - 1]?.[dateCol] ?? "").trim() === "日期") {
			headerRow = r;
			break;
		}
	}
	if (headerRow === null) {
		throw new Error(
			`No 日期/項目/金額 header row found within 8 rows of the ${LUNCH_SECTION_LABEL} anchor in ${tab}.`,
		);
	}
	// The 編列預算/剩餘 values row always sits directly above the header — a
	// whole-row insert above the transfer 總和 shifts the values row and the
	// header down together, so this adjacency holds no matter how many blank
	// rows opened up between the anchor and the header.
	const budgetRow = headerRow - 1;
	for (let r = headerRow + 1; r <= values.length; r++) {
		if (String(values[r - 1]?.[LUNCH_COLS.item] ?? "").trim() === LUNCH_TOTAL_LABEL) {
			return { budgetRow, headerRow, totalRow: r };
		}
	}
	throw new Error(`No ${LUNCH_TOTAL_LABEL} row under the ${LUNCH_SECTION_LABEL} header in ${tab}.`);
}

export interface IncomeWindow {
	/** First/last row (1-indexed, inclusive) of the income list. */
	start: number;
	end: number;
	/** True on the 月剩餘 layout; false when the list still ends at the old 剩餘 row. */
	migrated: boolean;
}

/** The income list sits between 總預算 and 月美金餘額 (migrated) or 剩餘 (old layout). Null when the tab has neither boundary. */
export function findIncomeWindow(values: unknown[][]): IncomeWindow | null {
	const budgetRow = findRowByValue(values, MONTH_COLS.budgetLabel, BUDGET_HEADER_LABEL);
	if (budgetRow === null) return null;
	const monthUsdRow = findRowByValue(values, MONTH_COLS.budgetLabel, MONTH_USD_NET_LABEL);
	if (monthUsdRow !== null) return { start: budgetRow + 1, end: monthUsdRow - 1, migrated: true };
	const remainderRow = findRowByValue(values, MONTH_COLS.budgetLabel, REMAINDER_LABEL);
	if (remainderRow !== null) return { start: budgetRow + 1, end: remainderRow - 1, migrated: false };
	return null;
}

export interface MigrationChange {
	cell: string;
	before: string;
	after: string;
}

export interface MigrationResult {
	changes: MigrationChange[];
	deletedRows: Array<{ row: number; item: string; values: unknown[] }>;
}

/**
 * Upgrade an old-layout monthly tab to the 月剩餘 income layout in one batch:
 * 支付幣別 column F (back-tagged from the USD column), income 幣別 tags,
 * 剩餘 → 月美金餘額/美金透支沖銷/月新臺幣餘額/新臺幣透支沖銷/月剩餘, 美金支付/新臺幣支付 deleted,
 * 收入/支出 rewritten as SUMIFs, running balances renamed 總…餘額.
 * `values` must be a FORMULA render of GRID_READ. Every overwrite/delete is
 * reported with its previous contents so it can be reverted by hand.
 */
export async function migrateIncomeLayout(
	client: SheetsClient,
	tab: string,
	values: unknown[][],
	sheetId: number,
): Promise<MigrationResult> {
	const win = findIncomeWindow(values);
	if (win === null || win.migrated) {
		throw new Error(`migrateIncomeLayout called on ${tab} but its layout is not the expected old one.`);
	}
	const expense = findExpenseWindow(values, tab);
	const remRow = win.end + 1; // the old 剩餘 row
	const cellStr = (r: number, c: number) => String(values[r - 1]?.[c] ?? "");
	const labelRow = (l: string) => findRowByValue(values, MONTH_COLS.budgetLabel, l);

	const usdIncRow = labelRow(USD_INCOME_LABEL);
	const usdSpRow = labelRow(USD_SPENDING_LABEL);
	const usdBalRow = labelRow(USD_BALANCE_LABEL);
	const ntdIncRow = labelRow(NTD_INCOME_LABEL);
	const ntdSpRow = labelRow(NTD_SPENDING_LABEL);
	const ntdBalRow = labelRow(NTD_BALANCE_LABEL);
	if (!usdIncRow || !usdSpRow || !usdBalRow || !ntdIncRow || !ntdSpRow || !ntdBalRow) {
		throw new Error(`Cannot migrate ${tab}: its 銀行餘額 block is missing or incomplete — set it up by hand first.`);
	}
	const bankTop = Math.min(usdIncRow, usdSpRow, usdBalRow, ntdIncRow, ntdSpRow, ntdBalRow);
	if (bankTop <= remRow) {
		throw new Error(`Cannot migrate ${tab}: the 銀行餘額 block sits above the ${REMAINDER_LABEL} row — unexpected layout.`);
	}
	const payRows: Array<{ label: string; row: number }> = [];
	for (const l of [USD_PAYMENT_LABEL, NTD_PAYMENT_LABEL]) {
		const row = labelRow(l);
		if (row === null) continue;
		if (row <= remRow || row >= bankTop) {
			throw new Error(`Cannot migrate ${tab}: "${l}" is not between ${REMAINDER_LABEL} and the 銀行餘額 block — unexpected layout.`);
		}
		payRows.push({ label: l, row });
	}
	// Rows ≤ remRow keep their position; below it: +4 for the insert, −1 per deleted pay row above.
	const finalRow = (r: number) => (r <= remRow ? r : r + 4 - payRows.filter((p) => p.row < r).length);

	const C = colLetter(MONTH_COLS.tag);
	const D = colLetter(MONTH_COLS.budgetValue);
	const F = colLetter(MONTH_COLS.paidWith);
	const changes: MigrationChange[] = [];
	const deletedRows: MigrationResult["deletedRows"] = [];
	const requests: object[] = [];

	// Structural ops first, so every write below can use final row positions.
	requests.push({
		insertDimension: {
			range: { sheetId, dimension: "ROWS", startIndex: remRow, endIndex: remRow + 4 },
			inheritFromBefore: true,
		},
	});
	for (const p of [...payRows].sort((a, b) => b.row - a.row)) {
		requests.push({
			deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: p.row + 4 - 1, endIndex: p.row + 4 } },
		});
		deletedRows.push({ row: p.row, item: p.label, values: values[p.row - 1] ?? [] });
	}

	const write = (row: number, col: number, value: string, before: string) => {
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: row - 1, columnIndex: col },
				rows: [{ values: [cellData(value)] }],
				fields: "userEnteredValue",
			},
		});
		changes.push({ cell: `${colLetter(col)}${row}`, before, after: value });
	};

	write(2, MONTH_COLS.paidWith, "支付幣別", cellStr(2, MONTH_COLS.paidWith));

	// Back-tag 支付幣別 across the expense window: USD-priced → USD, else TWD;
	// existing F values (explicit paid_with) are preserved and empty rows stay empty.
	const expEnd = Math.min(expense.end, expense.totalRow - 1);
	const backTags: object[] = [];
	for (let r = expense.start; r <= expEnd; r++) {
		const hasItem = cellStr(r, MONTH_COLS.item).trim() !== "";
		const existing = cellStr(r, MONTH_COLS.paidWith).trim();
		if (existing !== "") {
			// updateCells clears mask fields omitted from the cell data, so an
			// explicit pre-migration 支付幣別 must be written back, not skipped.
			backTags.push({ values: [cellData(existing)] });
			continue;
		}
		const tag = hasItem ? (cellStr(r, MONTH_COLS.usd).trim() !== "" ? "USD" : "TWD") : null;
		backTags.push({ values: [cellData(tag)] });
		if (tag !== null) changes.push({ cell: `${F}${r}`, before: "", after: tag });
	}
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: expense.start - 1, columnIndex: MONTH_COLS.paidWith },
			rows: backTags,
			fields: "userEnteredValue",
		},
	});

	// Existing income rows are TWD (USD income did not exist before this layout).
	const incomeTags: object[] = [];
	for (let r = win.start; r <= win.end; r++) {
		const hasItem = cellStr(r, MONTH_COLS.item).trim() !== "";
		incomeTags.push({ values: [cellData(hasItem ? "TWD" : null)] });
		if (hasItem) changes.push({ cell: `${C}${r}`, before: cellStr(r, MONTH_COLS.tag), after: "TWD" });
	}
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: win.start - 1, columnIndex: MONTH_COLS.tag },
			rows: incomeTags,
			fields: "userEnteredValue",
		},
	});

	// 剩餘 row + the four inserted rows become the 月 view. Each currency's
	// write-off settles ITS month-deficit from ITS bank when that 總…餘額 stays
	// non-negative; a fully settled month's 月剩餘 closes at 0 and nothing
	// rolls to next month's 上月…透支.
	const usd = colLetter(MONTH_COLS.usd);
	const twd = colLetter(MONTH_COLS.twd);
	const usdNet = `=${D}${finalRow(usdIncRow)}-${D}${finalRow(usdSpRow)}`;
	const ntdNet = `=${D}${finalRow(ntdIncRow)}-${D}${finalRow(ntdSpRow)}`;
	const usdWriteoff = `=IF(AND(${D}${remRow}<0,${D}${finalRow(usdBalRow)}>=0),-${D}${remRow},0)`;
	const ntdWriteoff = `=IF(AND(${D}${remRow + 2}<0,${D}${finalRow(ntdBalRow)}>=0),-${D}${remRow + 2},0)`;
	const monthRemainder = `=(${D}${remRow}+${D}${remRow + 1})*GOOGLEFINANCE("CURRENCY:USDTWD")+${D}${remRow + 2}+${D}${remRow + 3}`;
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: remRow - 1, columnIndex: MONTH_COLS.item },
			rows: [
				{ values: [cellData(MONTH_USD_NET_LABEL), cellData(null), cellData(usdNet)] },
				{ values: [cellData(USD_WRITEOFF_LABEL), cellData(null), cellData(usdWriteoff)] },
				{ values: [cellData(MONTH_NTD_NET_LABEL), cellData(null), cellData(ntdNet)] },
				{ values: [cellData(NTD_WRITEOFF_LABEL), cellData(null), cellData(ntdWriteoff)] },
				{ values: [cellData(MONTH_REMAINDER_LABEL), cellData(null), cellData(monthRemainder)] },
			],
			fields: "userEnteredValue",
		},
	});
	changes.push({ cell: `${colLetter(MONTH_COLS.item)}${remRow}`, before: REMAINDER_LABEL, after: MONTH_USD_NET_LABEL });
	changes.push({ cell: `${D}${remRow}`, before: cellStr(remRow, MONTH_COLS.budgetValue), after: usdNet });

	const incRange = (col: string) => `${col}${win.start}:${col}${win.end}`;
	const expRange = (col: string) => `${col}${expense.start}:${col}${expense.end}`;
	write(finalRow(usdIncRow), MONTH_COLS.budgetValue, `=SUMIF(${incRange(C)},"USD",${incRange(D)})`, cellStr(usdIncRow, MONTH_COLS.budgetValue));
	write(finalRow(usdSpRow), MONTH_COLS.budgetValue, `=SUMIF(${expRange(F)},"USD",${expRange(usd)})`, cellStr(usdSpRow, MONTH_COLS.budgetValue));
	write(finalRow(ntdIncRow), MONTH_COLS.budgetValue, `=SUMIF(${incRange(C)},"TWD",${incRange(D)})`, cellStr(ntdIncRow, MONTH_COLS.budgetValue));
	write(finalRow(ntdSpRow), MONTH_COLS.budgetValue, `=SUMIF(${expRange(F)},"TWD",${expRange(twd)})`, cellStr(ntdSpRow, MONTH_COLS.budgetValue));
	write(finalRow(usdBalRow), MONTH_COLS.item, TOTAL_USD_BALANCE_LABEL, USD_BALANCE_LABEL);
	write(finalRow(ntdBalRow), MONTH_COLS.item, TOTAL_NTD_BALANCE_LABEL, NTD_BALANCE_LABEL);

	await client.batchUpdate(requests);
	return { changes, deletedRows };
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
	BANK_BLOCK_LABEL,
	REMAINDER_LABEL,
	MONTH_USD_NET_LABEL,
	MONTH_NTD_NET_LABEL,
	MONTH_REMAINDER_LABEL,
	USD_WRITEOFF_LABEL,
	NTD_WRITEOFF_LABEL,
	USD_PAYMENT_LABEL,
	NTD_PAYMENT_LABEL,
	TOTAL_ROW_LABEL,
	OVERDRAFT_LABEL,
	PREV_USD_OVERDRAFT_LABEL,
	PREV_NTD_OVERDRAFT_LABEL,
	USD_INCOME_LABEL,
	USD_SPENDING_LABEL,
	PREV_USD_BALANCE_LABEL,
	USD_BALANCE_LABEL,
	TOTAL_USD_BALANCE_LABEL,
	NTD_INCOME_LABEL,
	NTD_SPENDING_LABEL,
	PREV_NTD_BALANCE_LABEL,
	NTD_BALANCE_LABEL,
	TOTAL_NTD_BALANCE_LABEL,
]);

/**
 * Upsert an income row on a monthly tab: update the row whose 項目 matches,
 * or insert a new ad-hoc row inside the income window (so the 美金收入 /
 * 新臺幣收入 SUMIFs auto-extend). Auto-migrates old-layout tabs first.
 */
export async function setIncome(client: SheetsClient, p: SetIncomeParams) {
	const item = p.item.trim();
	if (NON_INCOME_LABELS.has(item)) {
		throw new Error(`"${item}" is a layout label, not an income item — refusing to write it into the income list.`);
	}
	const tab = p.month !== undefined ? monthTabName(p.month) : currentMonthTab();

	const first = await client.readRange(`${quoteTab(tab)}!${GRID_READ}`, "FORMULA");
	assertNotTruncated(first.truncated, tab, GRID_READ);
	let values = first.values;
	const sheetId = await client.getSheetId(tab);

	let win = findIncomeWindow(values);
	if (win === null) {
		throw new Error(
			`Could not locate the income list in ${tab} (no "${BUDGET_HEADER_LABEL}" + "${MONTH_USD_NET_LABEL}"/"${REMAINDER_LABEL}" anchors in column ${colLetter(MONTH_COLS.budgetLabel)}) — the tab may predate the budget block.`,
		);
	}
	let migration: MigrationResult | null = null;
	if (!win.migrated) {
		migration = await migrateIncomeLayout(client, tab, values, sheetId);
		const reread = await client.readRange(`${quoteTab(tab)}!${GRID_READ}`, "FORMULA");
		assertNotTruncated(reread.truncated, tab, GRID_READ);
		values = reread.values;
		win = findIncomeWindow(values);
		if (win === null || !win.migrated) {
			throw new Error(`Migration of ${tab} did not produce the expected ${MONTH_REMAINDER_LABEL} layout — inspect the tab before retrying.`);
		}
	}

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
		// First fully-empty row inside the window; else insert at the window's
		// LAST row — strictly inside every range spanning the window, so the
		// income SUMIFs (and the 月-row anchors below) auto-extend.
		for (let r = win.start; r <= win.end; r++) {
			const row = values[r - 1] ?? [];
			if (!row.some((c) => c !== "" && c != null)) {
				targetRow = r;
				break;
			}
		}
		if (targetRow === null) {
			if (win.end <= win.start) {
				throw new Error(`The income list in ${tab} (rows ${win.start}-${win.end}) is too small to insert into safely.`);
			}
			targetRow = win.end;
			requests.push({
				insertDimension: {
					range: { sheetId, dimension: "ROWS", startIndex: targetRow - 1, endIndex: targetRow },
					inheritFromBefore: true,
				},
			});
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
	return { tab, row: targetRow, action, item, amount: p.amount, currency: p.currency, previous, migration };
}

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
	month?: number;
	/** M/D, MM/DD, YYYY/M/D, or YYYY-MM-DD; omitted = leave the 日期 cell blank. */
	date?: string;
	/** Per-row 類別 tag written into column C; omitted = leave the cell blank. */
	tag?: string;
	/** Which real account paid the row (支付幣別, column F); defaults to `currency`. */
	paidWith?: "TWD" | "USD";
}

export async function addExpense(client: SheetsClient, p: AddExpenseParams) {
	const tab = p.month !== undefined ? monthTabName(p.month) : currentMonthTab();
	// Parse before any read/write so a bad date fails closed.
	const dateSerialValue = p.date !== undefined ? parseDateInput(p.date) : null;
	const paidWith = p.paidWith ?? p.currency;
	if (p.currency === "TWD" && paidWith === "USD") {
		throw new Error(
			"A TWD-priced expense paid from the USD account is not representable: 美金支出 sums the USD column (D), which is blank on TWD-priced rows. Log it in USD (currency USD, paid_with USD) instead.",
		);
	}

	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, tab, GRID_READ);

	const { totalRow, start: windowStart, end: windowEnd } = findExpenseWindow(values, tab);

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
			throw new Error(`The expense window =SUM(${TWD_COL}${windowStart}:${TWD_COL}${windowEnd}) in ${tab} is too small to insert into safely.`);
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

	const tagCell = cellData(p.tag ?? null);
	const rowCells =
		p.currency === "USD"
			? [cellData(p.item), tagCell, cellData(p.amount), cellData(`=${USD_COL}${targetRow}*GOOGLEFINANCE("CURRENCY:USDTWD")`), cellData(paidWith)]
			: [cellData(p.item), tagCell, cellData(null), cellData(p.amount), cellData(paidWith)];
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: targetRow - 1, columnIndex: MONTH_COLS.item },
			rows: [{ values: rowCells }],
			fields: "userEnteredValue",
		},
	});
	if (dateSerialValue !== null) {
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: targetRow - 1, columnIndex: MONTH_COLS.date },
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
		});
	}

	// The expense lands inside the 花費總額 SUM window, so the total picks it up
	// automatically (an insert at the window's edge auto-extends the range).
	await client.batchUpdate(requests);
	return {
		tab,
		row: targetRow,
		inserted,
		item: p.item,
		amount: p.amount,
		currency: p.currency,
		paidWith,
		date: p.date ?? null,
		tag: p.tag ?? null,
	};
}

export interface AddTransferParams {
	/** NTD debited from the bank (新臺幣). */
	ntd: number;
	/** USD that actually arrived (實際美金). */
	usd: number;
	/** 手續費 in NTD. */
	fee: number;
	/** M/D, MM/DD, YYYY/M/D, or YYYY-MM-DD; omitted = today in Taipei. */
	date?: string;
	month?: number;
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

export async function addTransfer(client: SheetsClient, p: AddTransferParams) {
	const tab = p.month !== undefined ? monthTabName(p.month) : currentMonthTab();
	// Parse before any read/write so a bad date fails closed.
	const dateSerialValue = p.date !== undefined ? parseDateInput(p.date) : todaySerial();

	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${TRANSFER_GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, tab, TRANSFER_GRID_READ);
	const { headerRow, totalRow } = findTransferSection(values, tab);

	// First row between the header and 總和 that is empty across G–M.
	let targetRow: number | null = null;
	for (let r = headerRow + 1; r < totalRow; r++) {
		const cells = (values[r - 1] ?? []).slice(TRANSFER_COLS.date, TRANSFER_COLS.extra + 1);
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
		// Insert directly above 總和; the ledger's +J/−H/+M references shift with it.
		targetRow = totalRow;
		finalTotalRow = totalRow + 1;
		scratchRequests.push({
			insertDimension: {
				range: { sheetId, dimension: "ROWS", startIndex: targetRow - 1, endIndex: targetRow },
				inheritFromBefore: true,
			},
		});
	}
	// The entry's own 當下美金 cell doubles as the rate scratch: live GOOGLEFINANCE,
	// read once, then overwritten with the pinned formula.
	const scratchWrite = {
		updateCells: {
			start: { sheetId, rowIndex: targetRow - 1, columnIndex: TRANSFER_COLS.spotUsd },
			rows: [{ values: [cellData('=GOOGLEFINANCE("CURRENCY:USDTWD")')] }],
			fields: "userEnteredValue",
		},
	};
	scratchRequests.push(scratchWrite);
	await client.batchUpdate(scratchRequests);

	const scratchCell = `${colLetter(TRANSFER_COLS.spotUsd)}${targetRow}`;
	const read = await client.readRange(`${quoteTab(tab)}!${scratchCell}`, "UNFORMATTED_VALUE");
	const rate = read.values[0]?.[0];
	if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
		await client.batchUpdate([{ updateCells: { ...scratchWrite.updateCells, rows: [{ values: [{}] }] } }]);
		throw new Error(
			`GOOGLEFINANCE("CURRENCY:USDTWD") did not return a usable rate (got ${JSON.stringify(rate)}); the scratch cell ${scratchCell} was cleared — try again in a moment.`,
		);
	}

	const r = targetRow;
	const H = colLetter(TRANSFER_COLS.ntd);
	const I = colLetter(TRANSFER_COLS.spotUsd);
	const J = colLetter(TRANSFER_COLS.actualUsd);
	const K = colLetter(TRANSFER_COLS.spread);
	const L = colLetter(TRANSFER_COLS.fee);
	const rowCells = [
		cellData(p.ntd), // H 新臺幣
		cellData(`=${H}${r}/${rate}`), // I 當下美金, rate pinned at entry
		cellData(p.usd), // J 實際美金
		cellData(`=(${I}${r}-${J}${r})*${rate}`), // K 匯差 in NTD
		cellData(p.fee), // L 手續費
		cellData(`=${K}${r}+${L}${r}`), // M 當筆總額外花費
	];
	// Rewrite 總和 over the whole data window: the sheet's original single-cell
	// =sum(H35) cannot auto-extend, so the op owns the range from now on.
	const sumCells = [];
	for (let c = TRANSFER_COLS.ntd; c <= TRANSFER_COLS.extra; c++) {
		const col = colLetter(c);
		sumCells.push(cellData(`=SUM(${col}${headerRow + 1}:${col}${finalTotalRow - 1})`));
	}
	await client.batchUpdate([
		{
			updateCells: {
				start: { sheetId, rowIndex: r - 1, columnIndex: TRANSFER_COLS.date },
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
				start: { sheetId, rowIndex: r - 1, columnIndex: TRANSFER_COLS.ntd },
				rows: [{ values: rowCells }],
				fields: "userEnteredValue",
			},
		},
		{
			updateCells: {
				start: { sheetId, rowIndex: finalTotalRow - 1, columnIndex: TRANSFER_COLS.ntd },
				rows: [{ values: sumCells }],
				fields: "userEnteredValue",
			},
		},
	]);

	const spread = p.ntd - p.usd * rate; // == (當下美金 − 實際美金) × rate
	return {
		tab,
		row: r,
		inserted,
		date: serialToIso(dateSerialValue),
		ntd: p.ntd,
		usd: p.usd,
		rate,
		spotUsd: round2(p.ntd / rate),
		spread: round2(spread),
		fee: p.fee,
		extraCost: round2(spread + p.fee),
	};
}

export interface AddLunchParams {
	/** 金額 in NTD. */
	amount: number;
	/** 項目; defaults to 中餐. */
	item?: string;
	/** M/D, MM/DD, YYYY/M/D, or YYYY-MM-DD; omitted = today in Taipei. */
	date?: string;
	month?: number;
}

export async function addLunch(client: SheetsClient, p: AddLunchParams) {
	const tab = p.month !== undefined ? monthTabName(p.month) : currentMonthTab();
	// Parse before any read/write so a bad date fails closed.
	const dateSerialValue = p.date !== undefined ? parseDateInput(p.date) : todaySerial();
	const item = (p.item ?? LUNCH_DEFAULT_ITEM).trim() || LUNCH_DEFAULT_ITEM;

	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${LUNCH_GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, tab, LUNCH_GRID_READ);
	const { budgetRow, headerRow, totalRow } = findLunchSection(values, tab);

	// First row between the header and 總和 that is empty across O–Q.
	let targetRow: number | null = null;
	for (let r = headerRow + 1; r < totalRow; r++) {
		const cells = (values[r - 1] ?? []).slice(LUNCH_COLS.date, LUNCH_COLS.amount + 1);
		if (!cells.some((c) => c !== "" && c != null)) {
			targetRow = r;
			break;
		}
	}

	const sheetId = await client.getSheetId(tab);
	const inserted = targetRow === null;
	let finalTotalRow = totalRow;
	const requests: object[] = [];
	if (targetRow === null) {
		// Insert directly above 總和; the ledger's 午餐超支或回補 =Q reference
		// tracks the 剩餘 cell (above the insert) and needs no rewiring.
		targetRow = totalRow;
		finalTotalRow = totalRow + 1;
		requests.push({
			insertDimension: {
				range: { sheetId, dimension: "ROWS", startIndex: targetRow - 1, endIndex: targetRow },
				inheritFromBefore: true,
			},
		});
	}
	const Q = colLetter(LUNCH_COLS.amount);
	requests.push(
		{
			updateCells: {
				start: { sheetId, rowIndex: targetRow - 1, columnIndex: LUNCH_COLS.date },
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
				start: { sheetId, rowIndex: targetRow - 1, columnIndex: LUNCH_COLS.item },
				rows: [{ values: [cellData(item), cellData(p.amount)] }],
				fields: "userEnteredValue",
			},
		},
		// Rewrite 總和 over the whole data window: the sheet's original
		// =sum(Q38:Q39) cannot auto-extend, so the op owns the range from now on.
		{
			updateCells: {
				start: { sheetId, rowIndex: finalTotalRow - 1, columnIndex: LUNCH_COLS.amount },
				rows: [{ values: [cellData(`=SUM(${Q}${headerRow + 1}:${Q}${finalTotalRow - 1})`)] }],
				fields: "userEnteredValue",
			},
		},
	);
	await client.batchUpdate(requests);

	// Echo the section state AFTER the write so the caller sees the new leftover.
	const O = colLetter(LUNCH_COLS.date);
	const readBack = await client.readRange(`${quoteTab(tab)}!${O}${budgetRow}:${Q}${budgetRow}`, "UNFORMATTED_VALUE");
	const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
	const budget = num(readBack.values[0]?.[0]);
	const leftover = num(readBack.values[0]?.[2]);
	return {
		tab,
		row: targetRow,
		inserted,
		date: serialToIso(dateSerialValue),
		item,
		amount: p.amount,
		budget,
		spent: budget !== null && leftover !== null ? round2(budget - leftover) : null,
		leftover,
	};
}

export async function monthSummary(client: SheetsClient, month?: number) {
	const tab = month !== undefined ? monthTabName(month) : currentMonthTab();
	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${LUNCH_GRID_READ}`, "UNFORMATTED_VALUE");
	assertNotTruncated(truncated, tab, LUNCH_GRID_READ);

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

	// Income list (post- or pre-migration window); empty when the tab has no 總預算 anchor.
	const win = findIncomeWindow(values);
	const incomes: Array<{ item: string; currency: string | null; amount: number | null }> = [];
	if (win !== null) {
		for (let r = win.start; r <= win.end; r++) {
			const incomeItem = String(values[r - 1]?.[MONTH_COLS.item] ?? "").trim();
			if (incomeItem === "") continue;
			incomes.push({
				item: incomeItem,
				currency: String(values[r - 1]?.[MONTH_COLS.tag] ?? "").trim() || null,
				amount: num(values[r - 1]?.[MONTH_COLS.budgetValue]),
			});
		}
	}

	// 中餐預算 lunch-budget section (O–Q); null on tabs that predate it, and
	// also null (not thrown) when the section is torn beyond recognition —
	// this read-only summary must not die over a malformed lunch block.
	let lunch: { 編列預算: number | null; 總和: number | null; 剩餘: number | null } | null = null;
	if (findRowByValue(values, LUNCH_COLS.date, LUNCH_SECTION_LABEL) !== null) {
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
		中餐預算: lunch,
		午餐超支或回補: cellAt(rowByItem(LUNCH_ADJUST_LABEL), MONTH_COLS.budgetValue),
		tags,
		incomes,
		薪水: cellAt(rowByItem(SALARY_LABEL), MONTH_COLS.budgetValue),
		沛還: cellAt(rowByItem(REPAYMENT_LABEL), MONTH_COLS.budgetValue),
		// Old-layout only; null once migration replaces it with the 月 rows.
		剩餘: cellAt(rowByItem(REMAINDER_LABEL), MONTH_COLS.budgetValue),
		月美金餘額: cellAt(rowByItem(MONTH_USD_NET_LABEL), MONTH_COLS.budgetValue),
		月新臺幣餘額: cellAt(rowByItem(MONTH_NTD_NET_LABEL), MONTH_COLS.budgetValue),
		美金透支沖銷: cellAt(rowByItem(USD_WRITEOFF_LABEL), MONTH_COLS.budgetValue),
		新臺幣透支沖銷: cellAt(rowByItem(NTD_WRITEOFF_LABEL), MONTH_COLS.budgetValue),
		月剩餘: cellAt(rowByItem(MONTH_REMAINDER_LABEL), MONTH_COLS.budgetValue),
		// 銀行餘額 block — per-currency running balance (null on tabs that predate it).
		美金收入: cellAt(rowByItem(USD_INCOME_LABEL), MONTH_COLS.budgetValue),
		美金支出: cellAt(rowByItem(USD_SPENDING_LABEL), MONTH_COLS.budgetValue),
		上月美金餘額: cellAt(rowByItem(PREV_USD_BALANCE_LABEL), MONTH_COLS.budgetValue),
		總美金餘額: cellAt(findRowByLabels(values, MONTH_COLS.item, [TOTAL_USD_BALANCE_LABEL, USD_BALANCE_LABEL]), MONTH_COLS.budgetValue),
		新臺幣收入: cellAt(rowByItem(NTD_INCOME_LABEL), MONTH_COLS.budgetValue),
		新臺幣支出: cellAt(rowByItem(NTD_SPENDING_LABEL), MONTH_COLS.budgetValue),
		上月新臺幣餘額: cellAt(rowByItem(PREV_NTD_BALANCE_LABEL), MONTH_COLS.budgetValue),
		總新臺幣餘額: cellAt(findRowByLabels(values, MONTH_COLS.item, [TOTAL_NTD_BALANCE_LABEL, NTD_BALANCE_LABEL]), MONTH_COLS.budgetValue),
	};
}

/** Probe window for the 類別 dropdown: rows 3-4 are the 上月…透支 carries, so scan a few rows deep. */
const TAG_VALIDATION_ROWS = { start: 3, end: 15 } as const;

/** The live 類別 tag list, read from the dropdown (data validation) on a monthly tab's 類別 column. */
export async function getCategories(client: SheetsClient, month?: number) {
	const tab = month !== undefined ? monthTabName(month) : currentMonthTab();
	const rule = await client.getDataValidation(
		tab,
		TAG_VALIDATION_ROWS.start,
		TAG_VALIDATION_ROWS.end,
		colLetter(MONTH_COLS.tag),
	);
	if (!rule) {
		throw new Error(
			`No data validation found on the 類別 column of "${tab}" — the tab may predate the 類別 dropdown.`,
		);
	}
	if (rule.type === "ONE_OF_LIST") {
		return { tab, categories: [...new Set(rule.values)], source: "ONE_OF_LIST" as const };
	}
	if (rule.type === "ONE_OF_RANGE") {
		const range = (rule.values[0] ?? "").replace(/^=/, "");
		const { values } = await client.readRange(range);
		const categories = [
			...new Set(
				values.flat().filter((v): v is string => typeof v === "string" && v.trim() !== ""),
			),
		];
		return { tab, categories, source: "ONE_OF_RANGE" as const };
	}
	throw new Error(`類別 column validation on "${tab}" is ${rule.type}, not a dropdown list.`);
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

	const { values, truncated } = await client.readRange(`${quoteTab(newTab)}!${LUNCH_GRID_READ}`, "FORMULA");
	assertNotTruncated(truncated, newTab, LUNCH_GRID_READ);
	const totalRow = findRowByValue(values, MONTH_COLS.totalLabel, TOTAL_ROW_LABEL);
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

	// Carry rebuild. Split layout: each currency rolls its own UNSETTLED
	// deficit — 月…餘額+…透支沖銷 is negative exactly when the 沖銷 could not
	// fire — independently of the other currency and of 月剩餘. Legacy tabs
	// keep the single TWD carry anchored at 月剩餘/剩餘. The duplicated grid
	// mirrors prevTab's layout, so every anchor row is findable here — a plain
	// tab-name swap would keep a stale row reference from whichever layout the
	// formula was born in.
	const carryWrite = (row: number, col: number, value: string | number) => {
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: row - 1, columnIndex: col },
				rows: [{ values: [cellData(value)] }],
				fields: "userEnteredValue",
			},
		});
	};
	const legacyCarryFormula = (fallbackRow: number): string => {
		const remainderRow = findRowByLabels(values, MONTH_COLS.budgetLabel, [MONTH_REMAINDER_LABEL, REMAINDER_LABEL]);
		if (remainderRow !== null) {
			const cell = `${quoteTab(prevTab)}!${colLetter(MONTH_COLS.budgetValue)}${remainderRow}`;
			return `=IF(-${cell} > 0, -${cell}, 0)`;
		}
		return String(values[fallbackRow - 1]?.[MONTH_COLS.twd] ?? "").replace(/'\d+ 月'/g, `'${prevTab}'`);
	};
	const usdCarryRow = findRowByValue(values, MONTH_COLS.item, PREV_USD_OVERDRAFT_LABEL);
	const ntdCarryRow = findRowByValue(values, MONTH_COLS.item, PREV_NTD_OVERDRAFT_LABEL);
	if (usdCarryRow !== null || ntdCarryRow !== null) {
		const unsettled = (netLabel: string, writeoffLabel: string): string | null => {
			const netRow = findRowByValue(values, MONTH_COLS.budgetLabel, netLabel);
			const writeoffRow = findRowByValue(values, MONTH_COLS.budgetLabel, writeoffLabel);
			if (netRow === null || writeoffRow === null) return null;
			const D = colLetter(MONTH_COLS.budgetValue);
			const sum = `${quoteTab(prevTab)}!${D}${netRow}+${quoteTab(prevTab)}!${D}${writeoffRow}`;
			return `=IF(-(${sum}) > 0, -(${sum}), 0)`;
		};
		if (usdCarryRow !== null) {
			// Degenerate (previous month predates the 月 view): nothing to anchor
			// the USD side on — carry 0. The row's E conversion formula is
			// row-relative and survives duplication; only D is rewritten.
			carryWrite(usdCarryRow, MONTH_COLS.usd, unsettled(MONTH_USD_NET_LABEL, USD_WRITEOFF_LABEL) ?? 0);
		}
		if (ntdCarryRow !== null) {
			carryWrite(
				ntdCarryRow,
				MONTH_COLS.twd,
				unsettled(MONTH_NTD_NET_LABEL, NTD_WRITEOFF_LABEL) ?? legacyCarryFormula(ntdCarryRow),
			);
		} else {
			// Mid-backfill tab (USD row inserted, old row not yet renamed): re-anchor the legacy TWD carry to this month rather than leave it pointing two months back.
			const legacyRow = findRowByValue(values, MONTH_COLS.item, OVERDRAFT_LABEL);
			if (legacyRow !== null) {
				carryWrite(legacyRow, MONTH_COLS.twd, legacyCarryFormula(legacyRow));
			}
		}
	} else {
		const overdraftRow = findRowByValue(values, MONTH_COLS.item, OVERDRAFT_LABEL);
		if (overdraftRow !== null) {
			carryWrite(overdraftRow, MONTH_COLS.twd, legacyCarryFormula(overdraftRow));
		}
	}

	// The date column restarts each month — clear it across the expense window.
	if (totalRow > 3) {
		requests.push({
			repeatCell: {
				range: {
					sheetId,
					startRowIndex: 2,
					endRowIndex: totalRow - 1,
					startColumnIndex: MONTH_COLS.date,
					endColumnIndex: MONTH_COLS.date + 1,
				},
				cell: {},
				fields: "userEnteredValue",
			},
		});
	}

	// Carry the 銀行餘額 running balances forward: point each 上月餘額 cell at the
	// month-just-ended's matching 餘額. The new tab is a duplicate, so its 餘額
	// rows sit at the same positions as in prevTab. These writes precede the
	// row deletes below; a delete above only shifts the written cell (with its
	// label) up in lockstep, and the cross-tab reference into prevTab is
	// unaffected. Skipped on tabs that predate the block (rows not found).
	for (const [prevLabel, balanceLabels] of [
		[PREV_USD_BALANCE_LABEL, [TOTAL_USD_BALANCE_LABEL, USD_BALANCE_LABEL]],
		[PREV_NTD_BALANCE_LABEL, [TOTAL_NTD_BALANCE_LABEL, NTD_BALANCE_LABEL]],
	] as const) {
		const prevBalanceRow = findRowByValue(values, MONTH_COLS.budgetLabel, prevLabel);
		const balanceRow = findRowByLabels(values, MONTH_COLS.budgetLabel, balanceLabels);
		if (prevBalanceRow === null || balanceRow === null) continue;
		const ref = `=${quoteTab(prevTab)}!${colLetter(MONTH_COLS.budgetValue)}${balanceRow}`;
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: prevBalanceRow - 1, columnIndex: MONTH_COLS.budgetValue },
				rows: [{ values: [cellData(ref)] }],
				fields: "userEnteredValue",
			},
		});
	}

	// The lunch log restarts each month: clear the 中餐預算 data rows (O–Q).
	// Cells are cleared, not deleted, so nothing shifts; the 總和 =SUM over the
	// empty window reads 0 and 剩餘 resets to the full budget. The anchor probe
	// keeps pre-section tabs silent. A malformed section (e.g. torn by a
	// transfer insert) must not fail month-open after duplicateSheet has
	// already committed, so the clear is skipped and the reason surfaced
	// instead of thrown.
	let lunchCleared = false;
	let lunchWarning: string | undefined;
	if (findRowByValue(values, LUNCH_COLS.date, LUNCH_SECTION_LABEL) !== null) {
		try {
			const lunch = findLunchSection(values, newTab);
			if (lunch.totalRow > lunch.headerRow + 1) {
				requests.push({
					repeatCell: {
						range: {
							sheetId,
							startRowIndex: lunch.headerRow,
							endRowIndex: lunch.totalRow - 1,
							startColumnIndex: LUNCH_COLS.date,
							endColumnIndex: LUNCH_COLS.amount + 1,
						},
						cell: {},
						fields: "userEnteredValue",
					},
				});
				lunchCleared = true;
			}
		} catch (err) {
			lunchWarning = err instanceof Error ? err.message : String(err);
		}
	}

	const kept: string[] = [];
	const cleared: string[] = [];
	const rowsToDelete: number[] = [];
	for (let r = 3; r < totalRow; r++) {
		const item = String(values[r - 1]?.[MONTH_COLS.item] ?? "").trim();
		if (item === "") continue;
		if (RECURRING_ITEMS.has(item)) kept.push(item);
		else {
			cleared.push(item);
			rowsToDelete.push(r);
		}
	}
	// Ad-hoc income rows are one-offs too: keep 沛還/薪水, delete the rest.
	// Same lockstep argument as the carry-over writes above: these deletes run
	// after the updateCells requests, so earlier writes shift with their rows.
	const clearedIncomes: string[] = [];
	const incomeWin = findIncomeWindow(values);
	if (incomeWin !== null) {
		for (let r = incomeWin.start; r <= incomeWin.end; r++) {
			const incomeItem = String(values[r - 1]?.[MONTH_COLS.item] ?? "").trim();
			if (incomeItem === "" || RECURRING_INCOME.has(incomeItem)) continue;
			clearedIncomes.push(incomeItem);
			rowsToDelete.push(r);
		}
	}

	// Bottom-up so earlier deletions don't shift later indices. Scoped to A–F:
	// a whole-row delete would rip through the 乾坤大挪移 / 中餐預算 sections
	// (G–Q) that share these sheet rows; references across the column boundary
	// adjust on their own in both directions.
	for (const r of [...rowsToDelete].sort((a, b) => b - a)) {
		requests.push({
			deleteRange: {
				range: {
					sheetId,
					startRowIndex: r - 1,
					endRowIndex: r,
					startColumnIndex: 0,
					endColumnIndex: MONTH_COLS.paidWith + 1,
				},
				shiftDimension: "ROWS",
			},
		});
	}
	await client.batchUpdate(requests);

	return { tab: newTab, duplicatedFrom: prevTab, kept, cleared, clearedIncomes, lunchCleared, lunchWarning };
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

const TRIP_READ = "A1:AL200";
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

	// The block's 分類總花費 row (endRow when terminated by one) and its two total cells.
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

	if (insertNeeded || rewrites.length > 0) {
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
		await client.batchUpdate(requests);
	}

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

/** Discover trip category blocks: header row (日期+店鋪), label on the next row, region bounded by 分類總花費 / next header / scan cap. */
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
			let endRow = firstDataRow + TRIP_MAX_BLOCK_ROWS;
			for (let br = firstDataRow; br < firstDataRow + TRIP_MAX_BLOCK_ROWS && br <= values.length; br++) {
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
