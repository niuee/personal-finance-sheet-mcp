/**
 * Pure finders for budget-month tabs (from 11 月 2026): the budget list and
 * income on the left (A–F), one block per category to the right (H…AY), and
 * the 乾坤大挪移 log after the last block (BA–BG). Every block keeps its money
 * ABOVE an open-ended entry list — a 美金 row and a 新臺幣 row, each with
 * 編列預算 / 總和 / 剩餘 — so nothing ever has to grow a block, and nothing
 * but entries may be written below one. Everything is located by its labels,
 * never by fixed rows.
 *
 * Only function declarations are exported: finance-ops imports this module
 * and this module imports finance-ops' helpers, so nothing here may read an
 * imported binding at module load.
 */

import {
	AMOUNT_HEADER_LABEL,
	BLOCK_NTD_ROW_LABEL,
	BLOCK_USD_ROW_LABEL,
	BUDGET_ALLOCATED_LABEL,
	BUDGET_BLOCK_TITLE_SUFFIX,
	BUDGET_CATEGORY_ALIASES,
	CURRENCY_HEADER_LABEL,
	DATE_HEADER_LABEL,
	INCOME_HEADER_LABEL,
	MONTH_COLS,
	MONTH_USD_NET_LABELS,
	RATE_LABEL,
	SHEET_TIMEZONE,
	TRANSFER_SECTION_LABEL,
	TRANSFER_TOTAL_LABEL,
} from "./conventions";
import { colLetter, findRowByLabels, findRowByValue } from "./finance-ops";

/** Wide enough for the 乾坤大挪移 log at BA–BG (the template is 62 columns, to BJ). Unbounded rows: entry lists are open-ended. */
export const BUDGET_GRID_READ = "A1:BJ";
/** Column C: the 本月匯率 value (label in B). */
export const RATE_VALUE_COL = 2;
/** Column E: the 預算總額 value (label in D). */
export const BUDGET_SUM_VALUE_COL = 4;
/** Blocks start at column H or further right; A–F is the budget list / income side. */
const BLOCK_MIN_COL = 7;

/** A block's anchors, whatever shape its money rows are in. */
export interface BudgetBlockHeader {
	/** The budget list's 類別 (午餐支出 → 中餐). */
	category: string;
	title: string;
	/** 0-indexed 日期 column; +1 項目, +2 金額, +3 幣別. */
	startCol: number;
	/** Row of the "…支出" title. */
	titleRow: number;
	/** Row of the 日期/項目/金額/幣別 header; entries start below it. */
	headerRow: number;
}

export interface BudgetBlock {
	/** The budget list's 類別 (午餐支出 → 中餐). */
	category: string;
	title: string;
	/** 0-indexed 日期 column; +1 項目, +2 金額, +3 幣別. In the money rows: the label, then +1 編列預算, +2 總和, +3 剩餘. */
	startCol: number;
	/** Row of the 美金 money (all in USD). */
	usdRow: number;
	/** Row of the 新臺幣 money (all in NTD). */
	ntdRow: number;
	/** Row of the 日期/項目/金額/幣別 header; entries start below it. */
	headerRow: number;
}

export interface BudgetEntry {
	row: number;
	date: unknown;
	item: string;
	amount: unknown;
	currency: string;
}

export interface BudgetTransferSection {
	/** 0-indexed 日期 column; +1 新臺幣, +2 當下美金, +3 實際美金, +4 匯差, +5 手續費, +6 當筆總額外花費. */
	dateCol: number;
	totalRow: number;
	headerRow: number;
}

function cell(values: unknown[][], row: number, col: number): unknown {
	return values[row - 1]?.[col];
}

function text(values: unknown[][], row: number, col: number): string {
	return String(cell(values, row, col) ?? "").trim();
}

function isBlank(v: unknown): boolean {
	return v === "" || v === null || v === undefined;
}

/** A budget month carries the 本月匯率 label in column B; old-layout months never do. */
export function isBudgetMonth(values: unknown[][]): boolean {
	return findRowByValue(values, MONTH_COLS.budgetLabel, RATE_LABEL) !== null;
}

/** Every block's header, title and category, left to right. Throws on a header without a title and on a duplicate category. */
export function scanBudgetBlockHeaders(values: unknown[][], tab: string): BudgetBlockHeader[] {
	const headers: BudgetBlockHeader[] = [];
	for (let r = 1; r <= values.length; r++) {
		const row = values[r - 1] ?? [];
		for (let c = BLOCK_MIN_COL; c + 3 < row.length; c++) {
			if (
				text(values, r, c) !== DATE_HEADER_LABEL ||
				text(values, r, c + 1) !== INCOME_HEADER_LABEL ||
				text(values, r, c + 2) !== AMOUNT_HEADER_LABEL ||
				text(values, r, c + 3) !== CURRENCY_HEADER_LABEL
			) {
				continue;
			}
			let titleRow: number | null = null;
			for (let t = r - 1; t >= 1; t--) {
				if (text(values, t, c).endsWith(BUDGET_BLOCK_TITLE_SUFFIX)) {
					titleRow = t;
					break;
				}
			}
			if (titleRow === null) {
				throw new Error(
					`The budget block whose header sits at ${colLetter(c)}${r} in ${tab} has no "…${BUDGET_BLOCK_TITLE_SUFFIX}" title above it.`,
				);
			}
			const title = text(values, titleRow, c);
			const stem = title.slice(0, -BUDGET_BLOCK_TITLE_SUFFIX.length);
			const category = BUDGET_CATEGORY_ALIASES[stem] ?? stem;
			if (headers.some((h) => h.category === category)) {
				throw new Error(`Two budget blocks in ${tab} hold the category "${category}".`);
			}
			headers.push({ category, title, startCol: c, titleRow, headerRow: r });
		}
	}
	return headers.sort((a, b) => a.startCol - b.startCol);
}

/** True when a block still has the single-currency shape: 編列預算 labelled in its first column. */
export function isLegacyBudgetBlock(values: unknown[][], h: BudgetBlockHeader): boolean {
	for (let t = h.titleRow + 1; t < h.headerRow; t++) {
		if (text(values, t, h.startCol) === BUDGET_ALLOCATED_LABEL) return true;
	}
	return false;
}

/** Every category block, left to right. Throws on a torn block, a duplicate category, or a tab still in the single-currency shape. */
export function findBudgetBlocks(values: unknown[][], tab: string): BudgetBlock[] {
	return scanBudgetBlockHeaders(values, tab).map((h) => {
		if (isLegacyBudgetBlock(values, h)) {
			throw new Error(`${tab} still has the old single-currency budget blocks, which the tools no longer read — rebuild its blocks on the per-currency layout of the "Budget Based" template.`);
		}
		const where = `${colLetter(h.startCol)}${h.headerRow}`;
		let usdRow: number | null = null;
		let ntdRow: number | null = null;
		for (let t = h.titleRow + 1; t < h.headerRow; t++) {
			const label = text(values, t, h.startCol);
			if (label === BLOCK_USD_ROW_LABEL) usdRow = t;
			if (label === BLOCK_NTD_ROW_LABEL) ntdRow = t;
		}
		if (usdRow === null) throw new Error(`The budget block whose header sits at ${where} in ${tab} is missing its ${BLOCK_USD_ROW_LABEL} row.`);
		if (ntdRow === null) throw new Error(`The budget block whose header sits at ${where} in ${tab} is missing its ${BLOCK_NTD_ROW_LABEL} row.`);
		return { category: h.category, title: h.title, startCol: h.startCol, usdRow, ntdRow, headerRow: h.headerRow };
	});
}

/** The block for a 類別 tag (trimmed; 午餐 means 中餐). Throws with the available categories when none matches. */
export function resolveBudgetBlock(blocks: BudgetBlock[], tag: string, tab: string): BudgetBlock {
	const trimmed = tag.trim();
	const category = BUDGET_CATEGORY_ALIASES[trimmed] ?? trimmed;
	const block = blocks.find((b) => b.category === category);
	if (!block) {
		throw new Error(`No "${trimmed}" block in ${tab} — categories: ${blocks.map((b) => b.category).join(", ")}.`);
	}
	return block;
}

/** First row below the header whose 日期, 項目 and 金額 are all empty (a pre-typed 幣別 doesn't count). */
export function firstEmptyEntryRow(values: unknown[][], block: BudgetBlock): number {
	for (let r = block.headerRow + 1; ; r++) {
		if (
			isBlank(cell(values, r, block.startCol)) &&
			isBlank(cell(values, r, block.startCol + 1)) &&
			isBlank(cell(values, r, block.startCol + 2))
		) {
			return r;
		}
	}
}

/** Every row below the header with a 項目 or a 金額. */
export function blockEntries(values: unknown[][], block: BudgetBlock): BudgetEntry[] {
	const entries: BudgetEntry[] = [];
	for (let r = block.headerRow + 1; r <= values.length; r++) {
		const item = cell(values, r, block.startCol + 1);
		const amount = cell(values, r, block.startCol + 2);
		if (isBlank(item) && isBlank(amount)) continue;
		entries.push({
			row: r,
			date: cell(values, r, block.startCol),
			item: String(item ?? "").trim(),
			amount,
			currency: text(values, r, block.startCol + 3),
		});
	}
	return entries;
}

/** The 乾坤大挪移 log on a budget month: title, 總和 row, then the header, entries open-ended below. */
export function findBudgetTransferSection(values: unknown[][], tab: string): BudgetTransferSection {
	for (let r = 1; r <= values.length; r++) {
		const row = values[r - 1] ?? [];
		for (let c = BLOCK_MIN_COL; c < row.length; c++) {
			if (text(values, r, c) !== TRANSFER_SECTION_LABEL) continue;
			let headerRow: number | null = null;
			for (let h = r + 1; h <= values.length; h++) {
				if (text(values, h, c) === DATE_HEADER_LABEL && text(values, h, c + 1) === "新臺幣") {
					headerRow = h;
					break;
				}
			}
			if (headerRow === null) {
				throw new Error(`No ${DATE_HEADER_LABEL}/新臺幣/… header under the ${TRANSFER_SECTION_LABEL} title at ${colLetter(c)}${r} in ${tab}.`);
			}
			for (let t = r + 1; t < headerRow; t++) {
				if (text(values, t, c) === TRANSFER_TOTAL_LABEL) return { dateCol: c, totalRow: t, headerRow };
			}
			throw new Error(`No ${TRANSFER_TOTAL_LABEL} row between the ${TRANSFER_SECTION_LABEL} title and its header in ${tab}.`);
		}
	}
	throw new Error(`No ${TRANSFER_SECTION_LABEL} section in ${tab}.`);
}

const BUDGET_INCOME_SUMIF_RE = /^=SUMIF\(C(\d+):C(\d+),/i;

/** The income rows the 收支狀況 SUMIFs cover, read from the 本月美金收支狀況 formula (header row excluded). */
export function findBudgetIncomeSumifWindow(values: unknown[][], tab: string): { start: number; end: number } {
	const row = findRowByLabels(values, MONTH_COLS.budgetLabel, MONTH_USD_NET_LABELS);
	if (row === null) {
		throw new Error(`Could not find the "${MONTH_USD_NET_LABELS[0]}" row in ${tab} — cannot locate the income window.`);
	}
	const formula = String(cell(values, row, MONTH_COLS.budgetValue) ?? "");
	const m = formula.match(BUDGET_INCOME_SUMIF_RE);
	if (!m) {
		throw new Error(
			`The "${MONTH_USD_NET_LABELS[0]}" cell in ${tab} does not start with =SUMIF(Cstart:Cend, …) (got "${formula}") — cannot locate the income window safely.`,
		);
	}
	let start = Number(m[1]);
	if (text(values, start, MONTH_COLS.item) === INCOME_HEADER_LABEL) start++;
	return { start, end: Number(m[2]) };
}

/** 1-indexed row of 本月匯率 (label in B, value in C). */
export function findRateRow(values: unknown[][], tab: string): number {
	const row = findRowByValue(values, MONTH_COLS.budgetLabel, RATE_LABEL);
	if (row === null) throw new Error(`No ${RATE_LABEL} row in ${tab} (column ${colLetter(MONTH_COLS.budgetLabel)}).`);
	return row;
}

/**
 * The year a month tab belongs to: the occurrence of `month` nearest to the
 * current Taipei month. Months are usually created ahead of time (January
 * built in December is next year's), but replace_old_layout also rebuilds
 * months that already started or just ended (November rebuilt in December
 * is this year's). Six months either way resolves to the coming one.
 */
export function rateYear(month: number, now: Date = new Date()): number {
	const parts = new Intl.DateTimeFormat("en-US", { timeZone: SHEET_TIMEZONE, year: "numeric", month: "numeric" }).formatToParts(now);
	const year = Number(parts.find((p) => p.type === "year")?.value);
	const current = Number(parts.find((p) => p.type === "month")?.value);
	let best = year;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of [year - 1, year, year + 1]) {
		const offset = candidate * 12 + month - (year * 12 + current);
		const distance = Math.abs(offset);
		if (distance < bestDistance || (distance === bestDistance && offset > 0)) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}

/** 本月匯率: the live rate up to and including the 1st, then locked to the 1st's close. */
export function rateFormula(year: number, month: number): string {
	return `=IF(TODAY()<=DATE(${year},${month},1),GOOGLEFINANCE("CURRENCY:USDTWD"),INDEX(GOOGLEFINANCE("CURRENCY:USDTWD","price",DATE(${year},${month},1)),2,2))`;
}
