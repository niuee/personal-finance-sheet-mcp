import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONVENTIONS_TEXT, KNOWN_TAGS } from "./conventions";
import {
	addExpense,
	addLunch,
	addTransfer,
	addTripEntry,
	annotateRows,
	findCells,
	getCategories,
	monthSummary,
	safeUpdateRange,
	setIncome,
	startMonth,
} from "./finance-ops";
import type { SheetsClient } from "./sheets-client";

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rowsSchema = z.array(z.array(cellValue).min(1)).min(1);

type ToolResult = {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
};

function ok(data: unknown): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function toError(e: unknown): ToolResult {
	const message = e instanceof Error ? e.message : String(e);
	return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

export function registerFinanceTools(server: McpServer, client: SheetsClient): void {
	server.tool(
		"list_tabs",
		"List the tabs (sheets) in the personal-finance spreadsheet with their row/column counts. Call this first to orient yourself.",
		{},
		async () => {
			try {
				return ok(await client.listTabs());
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"read_range",
		"Read cell values using A1 notation (e.g. 'Transactions!A1:F200', or a tab name for the whole tab). Every returned row carries its REAL sheet row number (empty rows are omitted) — use those numbers directly, never count rows yourself. mode 'raw' returns unformatted numbers for math; 'formulas' returns cell formulas. truncated:true means narrow the range to see the rest.",
		{
			range: z
				.string()
				.min(1)
				.describe("A1 notation range, e.g. Transactions!A1:F200 or a bare tab name"),
			mode: z
				.enum(["formatted", "raw", "formulas"])
				.optional()
				.describe("formatted (default) = display strings; raw = unformatted numbers; formulas = cell formulas"),
		},
		async ({ range, mode }) => {
			const render = { formatted: "FORMATTED_VALUE", raw: "UNFORMATTED_VALUE", formulas: "FORMULA" } as const;
			try {
				const r = await client.readRange(range, render[mode ?? "formatted"]);
				const { startRow, rows } = annotateRows(r.range, r.values);
				return ok({ range: r.range, startRow, rows, truncated: r.truncated });
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"append_rows",
		"Append new rows below the existing data in a tab. Values are parsed as if typed by a user (dates and numbers become real dates/numbers). Returns the exact range that was written.",
		{
			tab: z.string().min(1).describe("Tab name, e.g. Transactions"),
			rows: rowsSchema.describe(
				"Rows to append; each row is an array of cell values in column order",
			),
		},
		async ({ tab, rows }) => {
			try {
				return ok(await client.appendRows(tab, rows));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"update_range",
		"OVERWRITE the cells in a range with new values. This destroys the existing contents — pass expect_empty:true whenever you believe the target is empty (it refuses if anything is there), and read the range first when editing existing cells. The response includes previousValues (what was overwritten, with formulas) so any mistake can be reverted. To clear a cell, write an empty string \"\" — a null cell value leaves the existing cell unchanged.",
		{
			range: z.string().min(1).describe("A1 notation range to overwrite, e.g. Transactions!B7"),
			values: rowsSchema.describe("Replacement values; outer array = rows, inner = cells"),
			expect_empty: z
				.boolean()
				.optional()
				.describe("true = refuse to write if ANY target cell is currently non-empty (use for append-like writes)"),
		},
		async ({ range, values, expect_empty }) => {
			try {
				return ok(await safeUpdateRange(client, range, values, expect_empty ?? false));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"add_tab",
		"Create a new empty tab (sheet) in the spreadsheet.",
		{
			title: z.string().min(1).describe("Title for the new tab"),
		},
		async ({ title }) => {
			try {
				return ok(await client.addTab(title));
			} catch (e) {
				return toError(e);
			}
		},
	);
}

const monthParam = z.number().int().min(1).max(12);

export function registerTailoredTools(server: McpServer, client: SheetsClient): void {
	server.tool(
		"add_expense",
		"Log an expense into a monthly tab (defaults to the current month). Writes into the expense window so 花費總額 picks it up, converts USD via GOOGLEFINANCE, and tags the row's 類別 cell. Use this instead of append_rows/update_range for monthly expenses.",
		{
			item: z.string().min(1).describe("Expense name, e.g. 晚餐 or Netflix"),
			amount: z.number().describe("The amount, in the given currency"),
			currency: z.enum(["TWD", "USD"]),
			tag: z
				.string()
				.min(1)
				.optional()
				.describe(
					`The row's 類別 tag — call get_categories for the live dropdown list (typically ${KNOWN_TAGS.join(", ")}). Free text, new tags allowed; omit only if none fits.`,
				),
			date: z
				.string()
				.min(1)
				.optional()
				.describe(
					"Expense date: M/D, MM/DD, or YYYY-MM-DD (year defaults to the current Taipei year). Omit to leave the 日期 cell blank, like recurring rows.",
				),
			month: monthParam.optional().describe("Target month 1-12 (default: current month)"),
			paid_with: z
				.enum(["TWD", "USD"])
				.optional()
				.describe(
					"Which real account paid the row — written to the 支付幣別 column (F); defaults to currency. Use currency USD + paid_with TWD for a USD-priced expense paid from the NTD account (the reverse, TWD-priced + USD-paid, is rejected).",
				),
			card: z
				.string()
				.min(1)
				.optional()
				.describe(
					"Credit card that charged the row — written to the 支付方式 column (G); the 信用卡帳單對帳區 FILTERs mirror the row into the card's statement bucket (dated rows only). One of: 國泰 CUBE, CHASE Amazon, CHASE Freedom Unlimited, Apple Card. Omit for cash/bank-transfer rows. Sets 支付幣別 to the card's billing currency unless paid_with is given.",
				),
		},
		async ({ paid_with, ...p }) => {
			try {
				return ok(await addExpense(client, { ...p, paidWith: paid_with }));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"set_income",
		"Fill in an income row on a monthly tab (defaults to the current month): updates the row if the 項目 already exists (薪水, 沛還, …), otherwise inserts a new ad-hoc income row with its 幣別 — the 本月美金收入/本月新臺幣收入 SUMIFs keep covering every row. Old-layout tabs (6月 2026 and earlier) are frozen history and refused.",
		{
			item: z.string().min(1).describe("Income name, e.g. 薪水, 沛還, 股息"),
			amount: z.number().describe("The amount, in the given currency"),
			currency: z.enum(["TWD", "USD"]).describe("The income's 幣別 — routes it into 新臺幣收入 or 美金收入"),
			month: monthParam.optional().describe("Target month 1-12 (default: current month)"),
		},
		async (p) => {
			try {
				return ok(await setIncome(client, p));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"month_summary",
		"Get a month's numbers as clean JSON (unformatted): 花費總額, the carried overdrafts (上月美金透支/上月新臺幣透支, or legacy 上月透支), per-類別 tag totals, the 午餐預算 lunch block (編列預算/總和/剩餘) and 午餐超支或回補, the income list (item/幣別/amount), 薪水, 沛還, 本月美金收支狀況/本月新臺幣收支狀況, plus the 銀行餘額 block (本月美金收入/本月美金支出/本月初美金餘額/本月底美金餘額, the NTD counterparts, and 保守預計本月底新臺幣餘額; old tabs report 剩餘 instead). Defaults to the current month. Fields the sheet doesn't have come back null.",
		{ month: monthParam.optional().describe("Month 1-12 (default: current month)") },
		async ({ month }) => {
			try {
				return ok(await monthSummary(client, month));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"get_categories",
		"List the canonical 類別 tags from the dropdown (data validation) on a monthly tab's 類別 column. Call this before add_expense when unsure which tag to use. Defaults to the current month.",
		{ month: monthParam.optional().describe("Month 1-12 (default: current month)") },
		async ({ month }) => {
			try {
				return ok(await getCategories(client, month));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"start_month",
		"Open a new month: duplicates the previous month's tab (keeping all formulas and recurring items like subscriptions), rewires the 上月…透支 carries to the month just ended's 本月…收支狀況 cells and 本月初新臺幣餘額 to its 本月底新臺幣餘額, clears one-off expenses and ad-hoc income, and empties the 午餐預算 lunch log so the budget's 剩餘 resets. Refuses if the tab already exists.",
		{ month: monthParam.describe("The month to create, 1-12") },
		async ({ month }) => {
			try {
				return ok(await startMonth(client, month));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"add_trip_entry",
		"Log a purchase into a trip tab (e.g. 2026/07/25 京都東京). Finds the category block anywhere in the tab's mosaic layout (模型, 書, 餐(當下吃的), 機票住宿, 雜支, 衣服/鞋子, 吃的伴手禮, 紀念品小物, 交通, 送禮, 入場券, 電子產品, ...), writes into the block's first empty row — inserting block-scoped cells if it is full — and keeps the 分類總花費 totals covering the new entry. Provide EXACTLY ONE of jpy (¥-priced purchase) or twd (NTD-direct row, 機票住宿-style).",
		{
			tab: z.string().min(1).describe("Trip tab name, exactly as it appears"),
			category: z.string().min(1).describe("Block title, e.g. 模型 or 電子產品"),
			date: z.string().min(1).describe("Date/time as you write it, e.g. 10/08 16:03"),
			shop: z.string().describe("Store name (may be empty)"),
			item: z.string().min(1).describe("What was bought"),
			payment_method: z.string().describe("e.g. Suica, 現金, 信用卡, 已算在預算"),
			jpy: z.number().optional().describe("Price in Japanese yen — exactly one of jpy/twd"),
			twd: z.number().optional().describe("Price in NTD for TWD-direct rows — exactly one of jpy/twd"),
		},
		async ({ tab, category, date, shop, item, payment_method, jpy, twd }) => {
			try {
				return ok(await addTripEntry(client, { tab, category, date, shop, item, paymentMethod: payment_method, jpy, twd }));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"add_transfer",
		"Log a 乾坤大挪移 NTD→USD transfer into a monthly tab (defaults to the current month): writes the entry into the transfer block (columns H-N), pins 當下美金/匯差 to the USDTWD spot rate at entry time, and keeps the 總和 sums covering every row. The 銀行餘額 ledgers pick it up automatically: +實際美金 into 本月底美金餘額, −新臺幣 from 本月底新臺幣餘額, and 匯差+手續費 into 本月新臺幣支出 as this month's NTD spending. Use this instead of update_range for transfers.",
		{
			ntd: z.number().positive().describe("NTD debited from the bank (新臺幣)"),
			usd: z.number().positive().describe("USD that actually arrived (實際美金)"),
			fee: z.number().min(0).describe("手續費 in NTD"),
			date: z
				.string()
				.min(1)
				.optional()
				.describe("Transfer date: M/D, MM/DD, or YYYY-MM-DD (defaults to today in Taipei)"),
			month: monthParam.optional().describe("Target month 1-12 (default: current month)"),
		},
		async (p) => {
			try {
				return ok(await addTransfer(client, p));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"add_lunch",
		"Log a lunch into the 午餐預算 section of a monthly tab (titled 中餐預算 on early tabs — both work) (columns P-R; defaults to the current month): writes 日期/項目/金額 and keeps the section's 總和 covering every row. The month's lunch BUDGET is the recurring 中餐 row in the expense list — never also add_expense a lunch. The leftover (剩餘 = 編列預算 − 總和) feeds the 銀行餘額 block's 午餐超支或回補 row: unspent budget returns to 本月底新臺幣餘額, an overdraft deducts more. Returns budget/spent/leftover after the entry.",
		{
			amount: z.number().positive().describe("金額 in NTD"),
			item: z.string().min(1).optional().describe("項目 (default: 中餐)"),
			date: z
				.string()
				.min(1)
				.optional()
				.describe("Lunch date: M/D, MM/DD, or YYYY-MM-DD (defaults to today in Taipei)"),
			month: monthParam.optional().describe("Target month 1-12 (default: current month)"),
		},
		async (p) => {
			try {
				return ok(await addLunch(client, p));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"get_sheet_conventions",
		"How this spreadsheet is organized: monthly tab layout, anchors like 花費總額, category formulas, trip blocks. Read this before doing raw range operations on unfamiliar tabs.",
		{},
		async () => ok({ conventions: CONVENTIONS_TEXT }),
	);

	server.tool(
		"insert_rows",
		"Insert empty rows at a 1-indexed position (existing rows shift down; formulas that span the position auto-extend). Prefer add_expense/add_trip_entry for their use cases.",
		{
			tab: z.string().min(1),
			row: z.number().int().min(2).describe("1-indexed row where the first new row will land"),
			count: z.number().int().min(1).max(50).default(1),
		},
		async ({ tab, row, count }) => {
			try {
				return ok(await client.insertRows(tab, row, count));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"find_cells",
		"Find cells whose DISPLAYED text contains a query (formatted values — '13,603.67' not 13603.67; formulas not searched) and get their exact A1 addresses — use this instead of reading big ranges and counting rows. Searches one tab, or every tab if tab is omitted. Returns at most 50 matches; truncated:true means there may be more (narrow the query or name a tab).",
		{
			query: z.string().min(1).describe("Text to look for, e.g. Haruka or 交通"),
			tab: z.string().optional().describe("Tab to search; omit to search all tabs"),
			match: z
				.enum(["contains", "exact"])
				.optional()
				.describe("contains (default, case-insensitive substring) or exact (trimmed, case-sensitive)"),
		},
		async ({ query, tab, match }) => {
			try {
				return ok(await findCells(client, { query, tab, match }));
			} catch (e) {
				return toError(e);
			}
		},
	);
}
