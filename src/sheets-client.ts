import type { GoogleAuth } from "./google-auth";

const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
export const MAX_READ_CHARS = 50_000;

export class SheetsApiError extends Error {
	constructor(
		message: string,
		public status: number,
	) {
		super(message);
		this.name = "SheetsApiError";
	}
}

export class SheetsClient {
	constructor(
		private auth: GoogleAuth,
		private spreadsheetId: string,
	) {}

	private async request(path: string, init: RequestInit = {}): Promise<any> {
		const token = await this.auth.getToken();
		const resp = await fetch(`${API_BASE}/${this.spreadsheetId}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		});
		if (!resp.ok) {
			let message = `Sheets API error (${resp.status})`;
			try {
				const body = (await resp.json()) as { error?: { message?: string } };
				if (body.error?.message) message = body.error.message;
			} catch {
				// non-JSON error body; keep the generic message
			}
			throw new SheetsApiError(message, resp.status);
		}
		return resp.json();
	}

	async listTabs(): Promise<Array<{ title: string; rowCount: number; columnCount: number }>> {
		const data = await this.request("?fields=sheets.properties");
		return (data.sheets ?? []).map((s: any) => ({
			title: s.properties.title,
			rowCount: s.properties.gridProperties?.rowCount ?? 0,
			columnCount: s.properties.gridProperties?.columnCount ?? 0,
		}));
	}

	async readRange(
		range: string,
		renderOption: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA" = "FORMATTED_VALUE",
	): Promise<{ range: string; values: unknown[][]; truncated: boolean }> {
		const query = renderOption === "FORMATTED_VALUE" ? "" : `?valueRenderOption=${renderOption}`;
		const data = await this.request(`/values/${encodeURIComponent(range)}${query}`);
		const values: unknown[][] = data.values ?? [];
		let truncated = false;
		while (values.length > 0 && JSON.stringify(values).length > MAX_READ_CHARS) {
			// Drop the last quarter of rows until we fit
			values.splice(Math.max(1, Math.floor(values.length * 0.75)));
			truncated = true;
			if (values.length === 1 && JSON.stringify(values).length > MAX_READ_CHARS) {
				// A single row alone exceeds the cap; return it anyway rather than nothing
				break;
			}
		}
		return { range: data.range ?? range, values, truncated };
	}

	/** Quote a tab name for A1 notation: 'Bob''s Tab' */
	private quoteTab(tab: string): string {
		return `'${tab.replace(/'/g, "''")}'`;
	}

	/**
	 * First data-validation rule found in the single-column window
	 * `{col}{startRow}:{col}{endRow}` of `tab`, or null. For ONE_OF_LIST rules
	 * `values` are the dropdown entries; for ONE_OF_RANGE (and anything else
	 * with condition values) they are the raw userEnteredValue strings, e.g.
	 * "=Settings!A1:A20".
	 */
	async getDataValidation(
		tab: string,
		startRow: number,
		endRow: number,
		col: string,
	): Promise<{ type: string; values: string[] } | null> {
		const range = `${this.quoteTab(tab)}!${col}${startRow}:${col}${endRow}`;
		const data = await this.request(
			`?ranges=${encodeURIComponent(range)}&fields=sheets.data(startRow,rowData.values.dataValidation)`,
		);
		for (const grid of data.sheets?.[0]?.data ?? []) {
			for (const row of grid.rowData ?? []) {
				const condition = row.values?.[0]?.dataValidation?.condition;
				if (!condition?.type) continue;
				const values = (condition.values ?? [])
					.map((v: any) => v.userEnteredValue)
					.filter((v: unknown): v is string => typeof v === "string");
				return { type: condition.type, values };
			}
		}
		return null;
	}

	async appendRows(tab: string, rows: unknown[][]): Promise<{ updatedRange: string; updatedRows: number }> {
		const range = encodeURIComponent(`${this.quoteTab(tab)}!A1`);
		const data = await this.request(
			`/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
			{ method: "POST", body: JSON.stringify({ values: rows }) },
		);
		return {
			updatedRange: data.updates?.updatedRange ?? "",
			updatedRows: data.updates?.updatedRows ?? 0,
		};
	}

	async updateRange(range: string, values: unknown[][]): Promise<{ updatedRange: string; updatedCells: number }> {
		const data = await this.request(
			`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
			{ method: "PUT", body: JSON.stringify({ values }) },
		);
		return {
			updatedRange: data.updatedRange ?? range,
			updatedCells: data.updatedCells ?? 0,
		};
	}

	async batchUpdate(requests: object[]): Promise<any> {
		return this.request(":batchUpdate", {
			method: "POST",
			body: JSON.stringify({ requests }),
		});
	}

	async getSheetId(title: string): Promise<number> {
		const data = await this.request("?fields=sheets.properties");
		const sheet = (data.sheets ?? []).find((s: any) => s.properties.title === title);
		if (!sheet) throw new SheetsApiError(`Tab "${title}" not found`, 404);
		return sheet.properties.sheetId;
	}

	/** Insert `count` empty rows so the first lands AT 1-indexed `row`; existing rows shift down. */
	async insertRows(tab: string, row: number, count: number): Promise<{ insertedAt: number; count: number }> {
		const sheetId = await this.getSheetId(tab);
		await this.batchUpdate([
			{
				insertDimension: {
					range: { sheetId, dimension: "ROWS", startIndex: row - 1, endIndex: row - 1 + count },
					inheritFromBefore: true,
				},
			},
		]);
		return { insertedAt: row, count };
	}

	async addTab(title: string): Promise<{ title: string; sheetId: number }> {
		const data = await this.batchUpdate([{ addSheet: { properties: { title } } }]);
		const props = data.replies?.[0]?.addSheet?.properties;
		return { title: props?.title ?? title, sheetId: props?.sheetId ?? -1 };
	}
}
