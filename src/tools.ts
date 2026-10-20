import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONVENTIONS_TEXT, KNOWN_TAGS } from "./conventions";
import {
	addExpense,
	addTransfer,
	addTripEntry,
	annotateRows,
	deleteExpense,
	findCells,
	getCategories,
	monthSummary,
	safeDeleteRows,
	safeUpdateRange,
	setIncome,
	startMonth,
	tripBudgetStatus,
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
		"Log an expense into a budget month (defaults to the current month): the entry goes into its category block's first empty row — tag picks the block (中餐 or 午餐 → the 午餐 block) — with 日期 (optional, stamped mm/dd), 項目, 金額 and 幣別, and the block's 總和 / 剩餘 and the month's 超支 and 收支狀況 rows pick it up. 幣別 is the account that PAID: a USD-priced expense paid from the NTD account (currency USD + paid_with TWD) is written as 幣別 TWD with 金額 = amount × 本月匯率. Use this instead of append_rows/update_range for monthly expenses. Old-layout months (5 月–9 月) are read-only and refused.",
		{
			item: z.string().min(1).describe("Expense name, e.g. 晚餐 or Netflix"),
			amount: z.number().describe("The amount, in the given currency"),
			currency: z.enum(["TWD", "USD"]),
			tag: z
				.string()
				.min(1)
				.optional()
				.describe(
					`Required: the category block — call get_categories for the month's blocks (typically ${KNOWN_TAGS.join(", ")}; 中餐 and 午餐 both mean the lunch block).`,
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
					"Which real account paid — the entry's 幣別; defaults to currency. Use currency USD + paid_with TWD for a USD-priced expense paid from the NTD account (the reverse, TWD-priced + USD-paid, is rejected).",
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
		"delete_expense",
		"Delete an expense entry from a budget month ENTIRELY — the entry disappears and the entries below it in the same block move up, leaving no blank gap (update_range can only blank the cells, which leaves a hole). Finds the entry by exact 項目 across every block; tag narrows the search to one block, and row picks between duplicate names (it never guesses). The delete is scoped to that block's own four columns, so no other block moves. Returns the deleted cells so a mistake can be re-entered. Old-layout months (5 月–9 月) are read-only and refused.",
		{
			item: z.string().min(1).describe("項目 of the expense row to delete, exactly as written"),
			month: monthParam.optional().describe("Target month 1-12 (default: current month)"),
			row: z.number().int().min(3).optional().describe("1-indexed sheet row, to disambiguate duplicate 項目 names"),
			tag: z
				.string()
				.min(1)
				.optional()
				.describe(
					"The category block to search (e.g. 訂閱). Every block has entries on the same sheet rows, so row alone can't pick one.",
				),
		},
		async (p) => {
			try {
				return ok(await deleteExpense(client, p));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"set_income",
		"Fill in an income row on a budget month (defaults to the current month): updates the row if the 項目 already exists (薪水, 沛還, …), otherwise adds a new ad-hoc income row with its 幣別 inside the income list — both 收支狀況 lines keep covering every row. Old-layout months (5 月–9 月) are read-only and refused.",
		{
			item: z.string().min(1).describe("Income name, e.g. 薪水, 沛還, 股息"),
			amount: z.number().describe("The amount, in the given currency"),
			currency: z.enum(["TWD", "USD"]).describe("The income's 幣別 — routes it into 本月新臺幣收支狀況 or 本月美金收支狀況"),
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
		"Get a month's numbers as clean JSON (unformatted): 花費總額, the carried overdrafts (上月美金透支/上月新臺幣透支, or legacy 上月透支), per-類別 tag totals, the 午餐預算 lunch block (編列預算/總和/剩餘) and 午餐超支或回補, the income list (item/幣別/amount), 薪水, 沛還, 本月美金收支狀況/本月新臺幣收支狀況, plus the 銀行餘額 block (本月美金收入/本月美金支出/本月初美金餘額/本月底美金餘額, the NTD counterparts, and 保守預計本月底新臺幣餘額; old tabs report 剩餘 instead). Defaults to the current month. Fields the sheet doesn't have come back null. On BUDGET MONTHS (from 11 月 2026) it returns layout:'budget' instead: per-block 美金 and 新臺幣 編列預算/總和/剩餘 (budgets: USD in USD, NTD in NTD), 本月匯率, the carries, 預算總額, the income list, both 收支狀況 lines, 本月美金超支 / 本月新臺幣超支 (each currency's overspend, ≤ 0, already included in its line), 本月美金超支（加上回補） / 本月新臺幣超支（加上回補）, 總支出, and the 乾坤大挪移 totals.",
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
		"List a budget month's category blocks — the tags add_expense accepts (source BUDGET_BLOCKS; the 午餐 block is reported as 中餐). Call this before add_expense when unsure which tag to use. Defaults to the current month. Old-layout months (5 月–9 月) are refused.",
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
		"Open a new month: duplicates the previous month's tab (keeping all formulas and recurring items like subscriptions), rewires the 上月…透支 carries to the month just ended's 本月…收支狀況 cells and 本月初新臺幣餘額 to its 本月底新臺幣餘額, clears one-off expenses and ad-hoc income, empties the 午餐預算 lunch log so the budget's 剩餘 resets, rolls the 信用卡帳單對帳區 forward (結帳日/繳款日 +1 month, 本月需繳款 rewired across the two months it covers), and pads every card bucket's spill area to 20 blank rows — headroom for hand-entered card rows, which no tool write would otherwise grow a bucket for. Refuses if the tab already exists. When a 'Budget Based' tab exists (budget months, from 11 月 2026), it builds the month by COPYING THAT TEMPLATE instead: the template's starting entries and budgets carry over as they are, the title is set, 上月美金透支/上月新臺幣透支 point at the previous month's 本月…收支狀況 cells (0 when that tab is missing), and 本月匯率 gets a formula that shows the live USDTWD rate until the 1st and then locks to the 1st's rate.",
		{
			month: monthParam.describe("The month to create, 1-12"),
			replace_old_layout: z
				.boolean()
				.optional()
				.describe(
					"Budget template only: rebuild an EXISTING old-layout month from the template — the old tab is renamed 'N 月 DEP' first. Never replaces a budget-layout month, and refuses when 'N 月 DEP' already exists.",
				),
		},
		async ({ month, replace_old_layout }) => {
			try {
				return ok(await startMonth(client, month, { replaceOldLayout: replace_old_layout }));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"add_trip_entry",
		"Log a purchase into a trip tab (e.g. 2026/07/25 京都東京). Finds the category block anywhere in the tab's mosaic layout (模型, 書, 餐(當下吃的), 機票住宿, 雜支, 衣服/鞋子, 吃的伴手禮, 紀念品小物, 交通, 送禮, 入場券, 電子產品, ...), writes into the block's first empty row — inserting block-scoped cells if it is full — keeps the …總花費 totals (分類總花費, 食總花費, …) covering the new entry, and stamps the row with the band's canonical formats (日期 as mm/dd hh:mm, ¥ / NTD currency signs, centered 店鋪/品項). Provide EXACTLY ONE of jpy (¥-priced purchase) or twd (NTD-direct row, 機票住宿-style).",
		{
			tab: z.string().min(1).describe("Trip tab name, exactly as it appears"),
			category: z.string().min(1).describe("Block title, e.g. 模型 or 電子產品"),
			date: z.string().min(1).describe("Date/time, e.g. 10/08 16:03 — include the time; the cell renders as mm/dd hh:mm"),
			shop: z.string().describe("Store name (may be empty)"),
			item: z.string().min(1).describe("What was bought"),
			payment_method: z
				.string()
				.describe(
					"支付方式 — use one of the block's existing dropdown options (e.g. Suica, 現金, 信用卡, 已算在預算) so it renders as a chip; the tool copies that column's dropdown onto the new cell.",
				),
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
		"trip_budget_status",
		"Read a trip tab's 目前實際開銷 budget-vs-actual summary (the bottom-right block, e.g. AI46:AM60 on 2026/07/25 京都東京): per-分類 金額 (spent so far), 預算, 預算餘額 (what's left), and 餘額 JP (the remainder in JPY), plus totals summed from the category rows. Amounts are unformatted numbers (NTD unless noted). Use this instead of read_range to check how much room is left in each trip budget category.",
		{
			tab: z.string().min(1).describe("Trip tab name, exactly as it appears, e.g. 2026/07/25 京都東京"),
		},
		async ({ tab }) => {
			try {
				return ok(await tripBudgetStatus(client, { tab }));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"add_transfer",
		"Log a 乾坤大挪移 currency transfer. Default currency:'usd' targets a budget month (default: current month): writes into the 乾坤大挪移 log at BA-BG with 當下美金/匯差 pinned to the USDTWD spot rate at entry time; its 總和 sits above the open-ended list and is never rewritten, and only the 手續費 counts as spending (本月新臺幣收支狀況, 總支出). Old-layout months (5 月–9 月) are read-only and refused. currency:'jpy' targets a TRIP tab (tab required, e.g. 2026/07/25 京都東京): writes into that tab's 乾坤大挪移 section (columns A-G) pinned to the JPYTWD rate, and wires the NTD side per entry into the month the date falls in (−新臺幣 from 本月底/保守預計新臺幣餘額, +手續費 into 本月新臺幣支出); the JPY received is trip cash and joins no bank ledger. A jpy transfer dated in a budget month is written to the trip tab but NOT linked into that month (the result says so in wiringNote). Use this instead of update_range for transfers.",
		{
			currency: z.enum(["usd", "jpy"]).optional().describe("Transfer destination currency (default usd)"),
			tab: z.string().min(1).optional().describe("Trip tab name, exactly as it appears — required for currency:'jpy'"),
			ntd: z.number().positive().describe("NTD debited from the bank (新臺幣)"),
			usd: z.number().positive().optional().describe("USD that actually arrived (實際美金) — usd transfers only"),
			jpy: z.number().positive().optional().describe("JPY that actually arrived (實際日幣) — jpy transfers only"),
			fee: z.number().min(0).describe("手續費 in NTD"),
			date: z
				.string()
				.min(1)
				.optional()
				.describe("Transfer date: M/D, MM/DD, or YYYY-MM-DD (defaults to today in Taipei)"),
			month: monthParam.optional().describe("Target month 1-12 (default: current month) — usd transfers only"),
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
		"delete_rows",
		"Delete rows for real — the row goes away and everything below moves up, which no other tool does (update_range only blanks cells, leaving an empty row behind). ALWAYS pass columns on a monthly or trip tab: those tabs are mosaics of side-by-side blocks (expense list A-G, 乾坤大挪移 and 信用卡帳單對帳區 H-N, 午餐預算 P-S; trip bands A-G, I-O, Q-W, Z-AF), and a whole-row delete tears every block that shares the row — scoping the delete to one band shifts only that section. Prefer delete_expense for expense rows. Refuses when a formula points straight at a cell being deleted (it would turn into #REF!) unless force:true; SUM/SUMIF ranges spanning the rows are fine, they shrink. Returns deletedValues (with formulas) so the rows can be re-entered.",
		{
			tab: z.string().min(1).describe("Tab name, e.g. 9 月"),
			row: z.number().int().min(2).describe("1-indexed first row to delete"),
			count: z.number().int().min(1).max(50).default(1),
			columns: z
				.string()
				.optional()
				.describe(
					'Column band to scope the delete to, e.g. "A:G" (expense list), "P:S" (午餐預算), "H:N" (乾坤大挪移 / 對帳區) or a single "R". Omit ONLY on a tab with nothing beside the rows — omitting it deletes the whole sheet row.',
				),
			force: z
				.boolean()
				.optional()
				.describe("true = delete even though formulas point straight at the deleted cells (they will show #REF!)"),
		},
		async (p) => {
			try {
				return ok(await safeDeleteRows(client, p));
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
