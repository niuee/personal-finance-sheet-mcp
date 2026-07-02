import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
		"Read cell values from the spreadsheet using A1 notation (e.g. 'Transactions!A1:F200', or just a tab name for the whole tab). Large results are truncated; the response says so via `truncated: true` — narrow the range to see the rest.",
		{
			range: z
				.string()
				.min(1)
				.describe("A1 notation range, e.g. Transactions!A1:F200 or a bare tab name"),
		},
		async ({ range }) => {
			try {
				return ok(await client.readRange(range));
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
		"OVERWRITE the cells in a range with new values. This destroys the existing contents of those cells — read the range first and double-check before updating. Returns the range and cell count actually written.",
		{
			range: z.string().min(1).describe("A1 notation range to overwrite, e.g. Transactions!B7"),
			values: rowsSchema.describe("Replacement values; outer array = rows, inner = cells"),
		},
		async ({ range, values }) => {
			try {
				return ok(await client.updateRange(range, values));
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
