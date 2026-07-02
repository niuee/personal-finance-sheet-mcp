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

	async readRange(range: string): Promise<{ range: string; values: unknown[][]; truncated: boolean }> {
		const data = await this.request(`/values/${encodeURIComponent(range)}`);
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

	async addTab(title: string): Promise<{ title: string; sheetId: number }> {
		const data = await this.request(":batchUpdate", {
			method: "POST",
			body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
		});
		const props = data.replies?.[0]?.addSheet?.properties;
		return { title: props?.title ?? title, sheetId: props?.sheetId ?? -1 };
	}
}
