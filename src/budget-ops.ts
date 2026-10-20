/**
 * Client-calling operations on budget months. Each public op in finance-ops
 * reads its tab as usual, and when isBudgetMonth() says so, hands off here;
 * these re-read the wider BUDGET_GRID_READ (the blocks and 乾坤大挪移 sit far
 * to the right of the old A1:S window).
 *
 * Every write is scoped to one section's own columns — the budget list,
 * income and nine blocks share sheet rows, so a whole-row insert or delete
 * would tear all of them. Conversions reference the 本月匯率 cell, never a
 * live rate.
 *
 * finance-ops imports this module and this module imports finance-ops, so
 * only function declarations cross that boundary and no imported binding is
 * read at module load.
 */

import {
	BUDGET_SUM_LABEL,
	MONTH_COLS,
	MONTH_NTD_NET_LABELS,
	MONTH_USD_NET_LABELS,
	OVERSPEND_LABEL,
	OVERSPEND_NET_LABEL,
	PREV_NTD_OVERDRAFT_LABEL,
	PREV_USD_OVERDRAFT_LABEL,
	RATE_LABEL,
	serialToIso,
	TOTAL_SPENDING_LABEL,
} from "./conventions";
import type { AddExpenseParams, AddTransferParams, AddTransferResult, DeleteExpenseParams } from "./finance-ops";
import {
	assertNotTruncated,
	cellData,
	findIncomeWindow,
	findRowByLabels,
	findRowByValue,
	pinTransferRate,
	quoteTab,
	round2,
	transferRowCells,
} from "./finance-ops";
import {
	blockEntries,
	BUDGET_GRID_READ,
	BUDGET_SUM_VALUE_COL,
	findBudgetBlocks,
	findBudgetTransferSection,
	findRateRow,
	firstEmptyEntryRow,
	RATE_VALUE_COL,
	resolveBudgetBlock,
} from "./budget-layout";
import type { SheetsClient } from "./sheets-client";

async function readBudgetGrid(
	client: SheetsClient,
	tab: string,
	render: "FORMULA" | "UNFORMATTED_VALUE",
): Promise<unknown[][]> {
	const { values, truncated } = await client.readRange(`${quoteTab(tab)}!${BUDGET_GRID_READ}`, render);
	assertNotTruncated(truncated, tab, BUDGET_GRID_READ);
	return values;
}

export interface BudgetExpenseResult {
	tab: string;
	layout: "budget";
	category: string;
	row: number;
	item: string;
	amount: number | string;
	currency: "USD" | "TWD";
	date: string | null;
	convertedAtMonthRate: boolean;
}

/** add_expense on a budget month: append into the tag's block. */
export async function addBudgetExpense(
	client: SheetsClient,
	tab: string,
	p: AddExpenseParams,
	dateSerialValue: number | null,
): Promise<BudgetExpenseResult> {
	if (p.card !== undefined) {
		throw new Error(
			`${tab} is a budget month — it has no card reconciliation, so 支付方式 (card) is not accepted. Log the expense without card.`,
		);
	}
	const values = await readBudgetGrid(client, tab, "FORMULA");
	const blocks = findBudgetBlocks(values, tab);
	if (p.tag === undefined || p.tag.trim() === "") {
		throw new Error(
			`${tab} is a budget month — tag is required and picks the category block: ${blocks.map((b) => b.category).join(", ")}.`,
		);
	}
	const block = resolveBudgetBlock(blocks, p.tag, tab);
	const row = firstEmptyEntryRow(values, block);

	const paidWith = p.paidWith ?? p.currency;
	const convertedAtMonthRate = p.currency === "USD" && paidWith === "TWD";
	const amount: number | string = convertedAtMonthRate ? `=${p.amount}*$C$${findRateRow(values, tab)}` : p.amount;
	const currency: "USD" | "TWD" = convertedAtMonthRate ? "TWD" : p.currency;

	const sheetId = await client.getSheetId(tab);
	const requests: object[] = [
		{
			updateCells: {
				start: { sheetId, rowIndex: row - 1, columnIndex: block.startCol + 1 },
				rows: [{ values: [cellData(p.item), cellData(amount), cellData(currency)] }],
				fields: "userEnteredValue",
			},
		},
	];
	if (dateSerialValue !== null) {
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: row - 1, columnIndex: block.startCol },
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
	await client.batchUpdate(requests);
	return {
		tab,
		layout: "budget",
		category: block.category,
		row,
		item: p.item,
		amount,
		currency,
		date: dateSerialValue === null ? null : serialToIso(dateSerialValue),
		convertedAtMonthRate,
	};
}

/** delete_expense on a budget month: remove one entry, shifting only its own block's entries up. */
export async function deleteBudgetExpense(
	client: SheetsClient,
	tab: string,
	p: DeleteExpenseParams,
): Promise<{ tab: string; layout: "budget"; category: string; row: number; item: string; deleted: unknown[] }> {
	const item = p.item.trim();
	const values = await readBudgetGrid(client, tab, "FORMULA");
	const blocks = findBudgetBlocks(values, tab);
	const searched = p.tag !== undefined ? [resolveBudgetBlock(blocks, p.tag, tab)] : blocks;
	let candidates = searched.flatMap((block) =>
		blockEntries(values, block)
			.filter((e) => e.item === item)
			.map((e) => ({ block, row: e.row })),
	);
	if (p.row !== undefined) candidates = candidates.filter((c) => c.row === p.row);
	if (candidates.length === 0) {
		const scope = p.tag !== undefined ? `the ${searched[0]!.category} block` : "any block";
		throw new Error(`No "${item}" entry${p.row !== undefined ? ` at row ${p.row}` : ""} in ${scope} of ${tab}.`);
	}
	if (candidates.length > 1) {
		// A delete is not reversible by re-running it: never guess.
		throw new Error(
			`Multiple "${item}" entries match in ${tab} (${candidates.map((c) => `${c.block.category} row ${c.row}`).join(", ")}) — pass tag (and row) to pick one.`,
		);
	}
	const { block, row } = candidates[0]!;
	const deleted = (values[row - 1] ?? []).slice(block.startCol, block.startCol + 4);
	const sheetId = await client.getSheetId(tab);
	await client.batchUpdate([
		{
			deleteRange: {
				range: {
					sheetId,
					startRowIndex: row - 1,
					endRowIndex: row,
					startColumnIndex: block.startCol,
					endColumnIndex: block.startCol + 4,
				},
				shiftDimension: "ROWS",
			},
		},
	]);
	return { tab, layout: "budget", category: block.category, row, item, deleted };
}

/** add_transfer (USD) on a budget month: first empty row of the 乾坤大挪移 log; its 總和 is open-ended, so it is never rewritten. */
export async function addBudgetTransfer(
	client: SheetsClient,
	tab: string,
	p: AddTransferParams,
	dateSerialValue: number,
): Promise<AddTransferResult> {
	const received = p.usd!;
	const values = await readBudgetGrid(client, tab, "FORMULA");
	const { dateCol, headerRow } = findBudgetTransferSection(values, tab);
	let row = headerRow + 1;
	while ((values[row - 1] ?? []).slice(dateCol, dateCol + 7).some((c) => c !== "" && c != null)) row++;

	const cols = {
		date: dateCol,
		ntd: dateCol + 1,
		spot: dateCol + 2,
		actual: dateCol + 3,
		spread: dateCol + 4,
		fee: dateCol + 5,
		extra: dateCol + 6,
	};
	const sheetId = await client.getSheetId(tab);
	const rate = await pinTransferRate(client, tab, sheetId, [], row, cols.spot, "USDTWD");
	await client.batchUpdate([
		{
			updateCells: {
				start: { sheetId, rowIndex: row - 1, columnIndex: cols.date },
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
				start: { sheetId, rowIndex: row - 1, columnIndex: cols.ntd },
				rows: [{ values: transferRowCells(cols, row, p.ntd, received, rate, p.fee) }],
				fields: "userEnteredValue",
			},
		},
	]);
	const spread = p.ntd - received * rate;
	return {
		tab,
		layout: "budget",
		row,
		inserted: false,
		date: serialToIso(dateSerialValue),
		ntd: p.ntd,
		rate,
		spread: round2(spread),
		fee: p.fee,
		extraCost: round2(spread + p.fee),
		usd: received,
		spotUsd: round2(p.ntd / rate),
	};
}

export interface BudgetMonthSummary {
	tab: string;
	layout: "budget";
	本月匯率: number | null;
	上月美金透支: number | null;
	上月新臺幣透支: number | null;
	budgets: Array<{ category: string; 編列預算: number | null; 總和: number | null; 剩餘: number | null }>;
	預算總額: number | null;
	incomes: Array<{ item: string; currency: string | null; amount: number | null }>;
	本月美金收支狀況: number | null;
	本月新臺幣收支狀況: number | null;
	本月超支: number | null;
	"本月超支（加上回補）": number | null;
	總支出: number | null;
	乾坤大挪移: { 新臺幣: number | null; 實際美金: number | null; 手續費: number | null; 當筆總額外花費: number | null } | null;
}

/** month_summary on a budget month: every number read by its label (numbers only; anything else is null). */
export async function budgetMonthSummary(client: SheetsClient, tab: string): Promise<BudgetMonthSummary> {
	const values = await readBudgetGrid(client, tab, "UNFORMATTED_VALUE");
	const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
	const at = (row: number | null, col: number): number | null => (row === null ? null : num(values[row - 1]?.[col]));
	const byLabel = (labels: readonly string[]) => at(findRowByLabels(values, MONTH_COLS.budgetLabel, labels), MONTH_COLS.budgetValue);

	const incomes: BudgetMonthSummary["incomes"] = [];
	const win = findIncomeWindow(values);
	if (win !== null) {
		for (let r = win.start; r <= win.end; r++) {
			const item = String(values[r - 1]?.[MONTH_COLS.item] ?? "").trim();
			if (item === "") continue;
			const currency = String(values[r - 1]?.[MONTH_COLS.tag] ?? "").trim();
			incomes.push({ item, currency: currency === "" ? null : currency, amount: num(values[r - 1]?.[MONTH_COLS.budgetValue]) });
		}
	}

	let transfer: BudgetMonthSummary["乾坤大挪移"] = null;
	try {
		const t = findBudgetTransferSection(values, tab);
		transfer = {
			新臺幣: at(t.totalRow, t.dateCol + 1),
			實際美金: at(t.totalRow, t.dateCol + 3),
			手續費: at(t.totalRow, t.dateCol + 5),
			當筆總額外花費: at(t.totalRow, t.dateCol + 6),
		};
	} catch {
		transfer = null;
	}

	return {
		tab,
		layout: "budget",
		本月匯率: at(findRowByValue(values, MONTH_COLS.budgetLabel, RATE_LABEL), RATE_VALUE_COL),
		上月美金透支: at(findRowByValue(values, MONTH_COLS.item, PREV_USD_OVERDRAFT_LABEL), MONTH_COLS.usd),
		上月新臺幣透支: at(findRowByValue(values, MONTH_COLS.item, PREV_NTD_OVERDRAFT_LABEL), MONTH_COLS.twd),
		budgets: findBudgetBlocks(values, tab).map((b) => ({
			category: b.category,
			編列預算: at(b.budgetRow, b.startCol),
			總和: at(b.totalRow, b.startCol + 2),
			剩餘: at(b.budgetRow, b.startCol + 2),
		})),
		預算總額: at(findRowByValue(values, MONTH_COLS.totalLabel, BUDGET_SUM_LABEL), BUDGET_SUM_VALUE_COL),
		incomes,
		本月美金收支狀況: byLabel(MONTH_USD_NET_LABELS),
		本月新臺幣收支狀況: byLabel(MONTH_NTD_NET_LABELS),
		本月超支: byLabel([OVERSPEND_LABEL]),
		"本月超支（加上回補）": byLabel([OVERSPEND_NET_LABEL]),
		總支出: byLabel([TOTAL_SPENDING_LABEL]),
		乾坤大挪移: transfer,
	};
}

/** get_categories on a budget month: the category blocks, left to right. */
export async function budgetCategories(
	client: SheetsClient,
	tab: string,
): Promise<{ tab: string; categories: string[]; source: "BUDGET_BLOCKS" }> {
	const values = await readBudgetGrid(client, tab, "FORMULA");
	return { tab, categories: findBudgetBlocks(values, tab).map((b) => b.category), source: "BUDGET_BLOCKS" };
}
