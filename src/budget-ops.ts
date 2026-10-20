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

import { serialToIso } from "./conventions";
import type { AddExpenseParams } from "./finance-ops";
import { assertNotTruncated, cellData, quoteTab } from "./finance-ops";
import { BUDGET_GRID_READ, findBudgetBlocks, findRateRow, firstEmptyEntryRow, resolveBudgetBlock } from "./budget-layout";
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
