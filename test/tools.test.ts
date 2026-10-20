import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFinanceTools, registerTailoredTools } from "../src/tools";
import type { SheetsClient } from "../src/sheets-client";

/** Names of every tool the server registers. */
function registeredTools(): string[] {
	const tool = vi.fn();
	const server = { tool } as unknown as McpServer;
	registerFinanceTools(server, {} as SheetsClient);
	registerTailoredTools(server, {} as SheetsClient);
	return tool.mock.calls.map((c) => c[0] as string);
}

describe("registered tools", () => {
	it("no longer offers the old-layout-only tools", () => {
		const names = registeredTools();
		expect(names).not.toContain("add_lunch");
		expect(names).not.toContain("set_expense_date");
		expect(names).not.toContain("adjust_balance");
	});

	it("still offers the budget-month, trip and general tools", () => {
		expect(registeredTools()).toEqual(
			expect.arrayContaining([
				"month_summary",
				"add_expense",
				"delete_expense",
				"set_income",
				"add_transfer",
				"get_categories",
				"start_month",
				"add_trip_entry",
				"trip_budget_status",
				"read_range",
				"update_range",
				"delete_rows",
				"find_cells",
				"get_sheet_conventions",
				"rename_tab",
			]),
		);
	});
});
