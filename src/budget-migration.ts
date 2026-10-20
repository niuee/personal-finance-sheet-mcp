/**
 * One-off move of a budget-month tab from single-currency blocks (one mixed
 * 編列預算 / 總和 / 剩餘 converted to NTD) to per-currency ones (a 美金 row and
 * a 新臺幣 row per block, two budget rows per category, split 超支 rows).
 * See docs/superpowers/specs/2026-10-20-per-currency-budget-blocks-design.md.
 *
 * planBudgetSplit is pure: it reads one tab's FORMULA render and returns the
 * single batchUpdate that migrates it, or throws on anything it doesn't
 * recognise — a refusal writes nothing, so no number on the sheet can move.
 *
 * Only function declarations cross the finance-ops / budget-layout imports;
 * nothing here reads an imported binding at module load.
 */

import {
	findBudgetTransferSection,
	findRateRow,
	isBudgetMonth,
	isLegacyBudgetBlock,
	scanBudgetBlockHeaders,
	type BudgetBlockHeader,
} from "./budget-layout";
import {
	BLOCK_NTD_ROW_LABEL,
	BLOCK_REMAINING_LABEL,
	BLOCK_USD_ROW_LABEL,
	BUDGET_ALLOCATED_LABEL,
	BUDGET_NTD_LINE_SUFFIX,
	BUDGET_USD_LINE_SUFFIX,
	MONTH_COLS,
	MONTH_NTD_NET_LABELS,
	MONTH_USD_NET_LABELS,
	NTD_OVERSPEND_LABEL,
	NTD_OVERSPEND_NET_LABEL,
	OVERSPEND_LABEL,
	OVERSPEND_NET_LABEL,
	PREV_NTD_OVERDRAFT_LABEL,
	PREV_USD_OVERDRAFT_LABEL,
	TOTAL_SPENDING_LABEL,
	USD_OVERSPEND_LABEL,
	USD_OVERSPEND_NET_LABEL,
} from "./conventions";
import { cellData, colLetter, findRowByLabels, findRowByValue } from "./finance-ops";

/** How USD cells read once migrated ($71.37). */
export const USD_DISPLAY_PATTERN = '"$"#,##0.00';
/** How NTD cells read once migrated (NTD 10,700), matching 本月新臺幣收支狀況 today. */
export const NTD_DISPLAY_PATTERN = '"NTD "#,##0';

export interface BudgetSplitPlan {
	/** The one batchUpdate that migrates the tab, in order: unmerge, move the rate row, writes, formats. */
	requests: object[];
	/** The 本月匯率 row after the move. */
	rateRow: number;
	/** Budget-list categories, top to bottom. */
	categories: string[];
}

type Line = { row: number; category: string; currency: "USD" | "TWD" };

function cell(g: unknown[][], row: number, col: number): unknown {
	return g[row - 1]?.[col];
}

function text(g: unknown[][], row: number, col: number): string {
	return String(cell(g, row, col) ?? "").trim();
}

function blank(v: unknown): boolean {
	return v === "" || v === null || v === undefined;
}

function a1(row: number, col: number): string {
	return `${colLetter(col)}${row}`;
}

/** The single batchUpdate that moves `tab` to per-currency budgets. Throws, writing nothing, on anything it doesn't recognise. */
export function planBudgetSplit(formulas: unknown[][], tab: string, sheetId: number): BudgetSplitPlan {
	const refuse = (why: string): never => {
		throw new Error(`Can't migrate ${tab} to per-currency budgets: ${why}`);
	};
	if (!isBudgetMonth(formulas)) refuse("it is not a budget month (no 本月匯率 in column B).");

	// Blocks: every one must still be in the old shape, rows 3–5 holding only today's cells.
	const blocks = scanBudgetBlockHeaders(formulas, tab);
	if (blocks.length === 0) refuse("it has no category blocks.");
	for (const b of blocks) {
		if (!isLegacyBudgetBlock(formulas, b)) {
			const split = [b.titleRow + 1, b.titleRow + 2, b.titleRow + 3].some((r) => text(formulas, r, b.startCol) === BLOCK_USD_ROW_LABEL);
			refuse(
				split
					? `it already uses per-currency budgets (the ${b.title} block has a ${BLOCK_USD_ROW_LABEL} row).`
					: `the ${b.title} block at ${a1(b.headerRow, b.startCol)} has no ${BUDGET_ALLOCATED_LABEL} label to migrate from.`,
			);
		}
		if (b.headerRow - b.titleRow !== 4) refuse(`the ${b.title} block doesn't have exactly three rows between its title and its header.`);
		const [labelRow, valueRow, totalRow] = [b.titleRow + 1, b.titleRow + 2, b.titleRow + 3];
		const allowed = new Set([
			a1(labelRow, b.startCol),
			a1(labelRow, b.startCol + 2),
			a1(valueRow, b.startCol),
			a1(valueRow, b.startCol + 2),
			a1(totalRow, b.startCol + 1),
			a1(totalRow, b.startCol + 2),
		]);
		for (const r of [labelRow, valueRow, totalRow]) {
			for (let c = b.startCol; c < b.startCol + 4; c++) {
				if (!blank(cell(formulas, r, c)) && !allowed.has(a1(r, c))) {
					refuse(`${a1(r, c)} in the ${b.title} block holds "${String(cell(formulas, r, c))}", which today's layout doesn't have there.`);
				}
			}
		}
	}

	// The old budget list: "<類別>預算" lines between 上月新臺幣透支 and 本月匯率.
	const oldRateRow = findRateRow(formulas, tab);
	const ntdCarryRow = findRowByValue(formulas, MONTH_COLS.item, PREV_NTD_OVERDRAFT_LABEL) ?? refuse(`no ${PREV_NTD_OVERDRAFT_LABEL} row.`);
	const usdCarryRow = findRowByValue(formulas, MONTH_COLS.item, PREV_USD_OVERDRAFT_LABEL) ?? refuse(`no ${PREV_USD_OVERDRAFT_LABEL} row.`);
	const lines: Line[] = [];
	for (let r = ntdCarryRow + 1; r < oldRateRow; r++) {
		if (!text(formulas, r, MONTH_COLS.item).endsWith("預算")) continue;
		const currency = text(formulas, r, MONTH_COLS.paidWith);
		if (currency !== "USD" && currency !== "TWD") refuse(`the budget line at row ${r} has 支付幣別 "${currency}", not USD or TWD.`);
		lines.push({ row: r, category: text(formulas, r, MONTH_COLS.tag), currency: currency as Line["currency"] });
	}
	if (lines.length === 0) refuse("it has no budget lines above 本月匯率.");
	const categories: string[] = [];
	for (const line of lines) {
		if (!categories.includes(line.category)) categories.push(line.category);
		if (lines.filter((l) => l.category === line.category && l.currency === line.currency).length > 1) {
			refuse(`${line.category} has two ${line.currency} budget lines; merge them into one by hand first.`);
		}
	}
	const blockCategories = blocks.map((b) => b.category);
	if (blockCategories.length !== categories.length || !categories.every((c) => blockCategories.includes(c))) {
		refuse(`the budget list's categories (${categories.join(", ")}) don't match the blocks' (${blockCategories.join(", ")}).`);
	}

	// Room: the list grows to two rows per category; the rate row lands right below.
	const listStart = lines[0]!.row;
	const listEnd = listStart + 2 * categories.length - 1;
	const rateRow = listEnd + 1;
	if (rateRow <= oldRateRow) refuse(`the new list would end above the current 本月匯率 row ${oldRateRow}.`);
	for (let r = oldRateRow + 1; r <= rateRow; r++) {
		for (let c = MONTH_COLS.item; c <= MONTH_COLS.paidWith; c++) {
			if (!blank(cell(formulas, r, c))) refuse(`${a1(r, c)} isn't empty, and the budget list needs rows ${oldRateRow + 1}–${rateRow}.`);
		}
	}

	// Amounts, as typed. A TWD line whose E converts the rate carries 0 when its D is blank.
	const rateRef = new RegExp(`\\$?C\\$?${oldRateRow}(?!\\d)`);
	const amounts = categories.map((category) => {
		const usdLine = lines.find((l) => l.category === category && l.currency === "USD");
		const ntdLine = lines.find((l) => l.category === category && l.currency === "TWD");
		const usdRaw = usdLine ? cell(formulas, usdLine.row, MONTH_COLS.usd) : undefined;
		let ntdRaw = ntdLine ? cell(formulas, ntdLine.row, MONTH_COLS.twd) : undefined;
		if (ntdLine && typeof ntdRaw === "string" && rateRef.test(ntdRaw)) {
			if (!blank(cell(formulas, ntdLine.row, MONTH_COLS.usd))) {
				refuse(`${category}'s TWD budget line (row ${ntdLine.row}) converts a filled USD amount at the rate; move it to a USD line by hand first.`);
			}
			ntdRaw = 0;
		}
		const asCell = (v: unknown): string | number => (blank(v) ? 0 : typeof v === "number" ? v : String(v));
		return { category, usd: asCell(usdRaw), ntd: asCell(ntdRaw) };
	});

	// Summary rows, by label.
	const need = (labels: readonly string[]): number =>
		findRowByLabels(formulas, MONTH_COLS.item, labels) ?? refuse(`no "${labels[0]}" row in column B.`);
	const usdNetRow = need(MONTH_USD_NET_LABELS);
	const ntdNetRow = need(MONTH_NTD_NET_LABELS);
	const usdOverRow = need([USD_OVERSPEND_LABEL]);
	const ntdOverRow = need([NTD_OVERSPEND_LABEL]);
	const usdNetOverRow = need([OVERSPEND_LABEL]);
	const ntdNetOverRow = need([OVERSPEND_NET_LABEL]);
	const totalRow = need([TOTAL_SPENDING_LABEL]);
	const income = /^=SUMIF\(C(\d+):C(\d+),/i.exec(String(cell(formulas, usdNetRow, MONTH_COLS.usd) ?? ""));
	if (!income) refuse(`the ${MONTH_USD_NET_LABELS[0]} cell doesn't start with =SUMIF(Cstart:Cend, so the income window is unknown.`);
	const [a, b] = [income![1], income![2]];
	const transfer = findBudgetTransferSection(formulas, tab);
	const fee = a1(transfer.totalRow, transfer.dateCol + 5);

	// New block rows: the label row, then 美金, then 新臺幣.
	const [labelRow, usdRow, ntdRow] = [blocks[0]!.titleRow + 1, blocks[0]!.titleRow + 2, blocks[0]!.titleRow + 3];
	const D = (r: number) => `D${r}`;
	const per = (b: BudgetBlockHeader, off: number, row: number) => a1(row, b.startCol + off);
	const sumOf = (cells: string[], join: string) => cells.join(join);
	const remaining = (row: number) => blocks.map((b) => per(b, 3, row));
	const totals = (row: number) => blocks.map((b) => per(b, 2, row));
	const rate = `$C$${rateRow}`;
	/** The budget list's rows in one column, absolute: $B$5:$B$22. */
	const B = (col: string) => `$${col}$${listStart}:$${col}$${listEnd}`;

	const requests: object[] = [];
	const range = (r0: number, r1: number, c0: number, c1: number) => ({
		sheetId,
		startRowIndex: r0 - 1,
		endRowIndex: r1,
		startColumnIndex: c0,
		endColumnIndex: c1 + 1,
	});
	const write = (row: number, col: number, rows: Array<Array<string | number | null>>) =>
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: row - 1, columnIndex: col },
				rows: rows.map((values) => ({ values: values.map((v) => cellData(v)) })),
				fields: "userEnteredValue",
			},
		});
	const format = (r0: number, r1: number, c0: number, c1: number, pattern: string) =>
		requests.push({
			repeatCell: {
				range: range(r0, r1, c0, c1),
				cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern } } },
				fields: "userEnteredFormat.numberFormat",
			},
		});

	// 1. Unmerge every block's money rows (today H3:I3, H4:I4, … are merged).
	for (const blk of blocks) requests.push({ unmergeCells: { range: range(labelRow, ntdRow, blk.startCol, blk.startCol + 3) } });

	// 2. Move 本月匯率 / 預算總額 below the list; every reference to them follows.
	requests.push({
		cutPaste: {
			source: range(oldRateRow, oldRateRow, MONTH_COLS.item, MONTH_COLS.twd),
			destination: { sheetId, rowIndex: rateRow - 1, columnIndex: MONTH_COLS.item },
			pasteType: "PASTE_NORMAL",
		},
	});

	// 3. Values.
	write(
		listStart,
		MONTH_COLS.item,
		amounts.flatMap(({ category, usd, ntd }, i) => {
			const r = listStart + 2 * i;
			return [
				[`${category}${BUDGET_USD_LINE_SUFFIX}`, category, usd, `=D${r}*${rate}`, "USD"],
				[`${category}${BUDGET_NTD_LINE_SUFFIX}`, category, null, ntd, "TWD"],
			];
		}),
	);
	write(rateRow, MONTH_COLS.twd, [[`=SUM(E${listStart}:E${listEnd})`]]);
	for (const blk of blocks) {
		const category = blk.category;
		const [budget, total, amt, cur] = [colLetter(blk.startCol + 1), colLetter(blk.startCol + 2), colLetter(blk.startCol + 2), colLetter(blk.startCol + 3)];
		const entries = blk.headerRow + 1;
		write(labelRow, blk.startCol, [
			[null, BUDGET_ALLOCATED_LABEL, "總和", BLOCK_REMAINING_LABEL],
			[
				BLOCK_USD_ROW_LABEL,
				`=SUMIF(${B("B")},"${category}${BUDGET_USD_LINE_SUFFIX}",${B("D")})`,
				`=SUMIF(${cur}${entries}:${cur},"USD",${amt}${entries}:${amt})`,
				`=ROUND(${budget}${usdRow}-${total}${usdRow},2)`,
			],
			[
				BLOCK_NTD_ROW_LABEL,
				`=SUMIF(${B("B")},"${category}${BUDGET_NTD_LINE_SUFFIX}",${B("E")})`,
				`=SUMIF(${cur}${entries}:${cur},"<>USD",${amt}${entries}:${amt})`,
				`=${budget}${ntdRow}-${total}${ntdRow}`,
			],
		]);
	}
	write(usdNetRow, MONTH_COLS.usd, [
		[`=SUMIF(C${a}:C${b},"USD",D${a}:D${b})-${D(usdCarryRow)}-SUMIF(F${listStart}:F${listEnd},"USD",D${listStart}:D${listEnd})+${D(usdOverRow)}`],
	]);
	write(ntdNetRow, MONTH_COLS.usd, [
		[
			`=SUMIF(C${a}:C${b},"TWD",D${a}:D${b})-E${ntdCarryRow}-SUMIF(F${listStart}:F${listEnd},"TWD",E${listStart}:E${listEnd})+${D(ntdOverRow)}-${fee}`,
		],
	]);
	write(usdOverRow, MONTH_COLS.usd, [[`=${sumOf(remaining(usdRow).map((c) => `MIN(0,${c})`), "+")}`]]);
	write(ntdOverRow, MONTH_COLS.usd, [[`=${sumOf(remaining(ntdRow).map((c) => `MIN(0,${c})`), "+")}`]]);
	write(usdNetOverRow, MONTH_COLS.item, [[USD_OVERSPEND_NET_LABEL, null, `=${sumOf(remaining(usdRow), "+")}`]]);
	write(ntdNetOverRow, MONTH_COLS.item, [[NTD_OVERSPEND_NET_LABEL, null, `=${sumOf(remaining(ntdRow), "+")}`]]);
	write(totalRow, MONTH_COLS.usd, [[`=SUM(${sumOf(totals(usdRow), ",")})*${rate}+SUM(${sumOf(totals(ntdRow), ",")})+${fee}`]]);

	// 4. Display formats.
	format(listStart, listEnd, MONTH_COLS.usd, MONTH_COLS.usd, USD_DISPLAY_PATTERN);
	format(listStart, listEnd, MONTH_COLS.twd, MONTH_COLS.twd, NTD_DISPLAY_PATTERN);
	for (const blk of blocks) {
		format(usdRow, usdRow, blk.startCol + 1, blk.startCol + 3, USD_DISPLAY_PATTERN);
		format(ntdRow, ntdRow, blk.startCol + 1, blk.startCol + 3, NTD_DISPLAY_PATTERN);
	}
	for (const r of [usdNetRow, usdOverRow, usdNetOverRow]) format(r, r, MONTH_COLS.usd, MONTH_COLS.usd, USD_DISPLAY_PATTERN);
	for (const r of [ntdNetRow, ntdOverRow, ntdNetOverRow, totalRow]) format(r, r, MONTH_COLS.usd, MONTH_COLS.usd, NTD_DISPLAY_PATTERN);

	return { requests, rateRow, categories };
}
