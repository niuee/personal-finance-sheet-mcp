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

	/** Every cell of `range` (A1, e.g. "K7:AY40") in `tab` that carries a data-validation rule (any kind): 1-indexed row, 0-indexed column. */
	async dataValidationCells(tab: string, range: string): Promise<Array<{ row: number; col: number }>> {
		const a1 = `${this.quoteTab(tab)}!${range}`;
		const data = await this.request(
			`?ranges=${encodeURIComponent(a1)}&fields=sheets.data(startRow,startColumn,rowData.values.dataValidation)`,
		);
		const cells: Array<{ row: number; col: number }> = [];
		for (const grid of data.sheets?.[0]?.data ?? []) {
			const firstRow = (grid.startRow ?? 0) + 1;
			const firstCol = grid.startColumn ?? 0;
			(grid.rowData ?? []).forEach((row: any, i: number) => {
				(row.values ?? []).forEach((cell: any, j: number) => {
					if (cell?.dataValidation?.condition?.type) cells.push({ row: firstRow + i, col: firstCol + j });
				});
			});
		}
		return cells;
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

	/**
	 * Sheets validates and applies a batch atomically: when it rejects one
	 * request (a 400 naming `requests[i]`), none of the others took effect
	 * either — said outright in the error, so a caller never has to wonder
	 * whether the requests before `i` left the sheet half-written. Other
	 * failures (5xx, network) make no such claim.
	 */
	async batchUpdate(requests: object[]): Promise<any> {
		try {
			return await this.request(":batchUpdate", {
				method: "POST",
				body: JSON.stringify({ requests }),
			});
		} catch (err) {
			if (err instanceof SheetsApiError && err.status === 400) {
				const applied =
					requests.length === 1 ? "its one request did not take effect" : `none of its ${requests.length} requests took effect`;
				throw new SheetsApiError(`${err.message} (Sheets applies a batchUpdate atomically — ${applied}.)`, err.status);
			}
			throw err;
		}
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

	/**
	 * Delete `count` rows starting AT 1-indexed `row`; everything below shifts
	 * up. `band` (0-indexed, `endCol` exclusive) scopes the delete to one
	 * column span — a "delete cells, shift up" over the section's own columns,
	 * the mirror image of the band inserts the tailored ops use. Monthly and
	 * trip tabs are mosaics of side-by-side blocks, so a whole-row delete
	 * inside one section tears whatever block straddles the row in the other
	 * columns; scoping keeps the neighbours in place. References adjust the
	 * same way either way — ranges spanning the deleted rows shrink, single
	 * cells pointing INTO them become #REF! (safeDeleteRows checks for those
	 * before this method is ever called).
	 */
	async deleteRows(
		tab: string,
		row: number,
		count: number,
		band?: { startCol: number; endCol: number },
	): Promise<{ deletedAt: number; count: number }> {
		const sheetId = await this.getSheetId(tab);
		const request =
			band === undefined
				? {
						deleteDimension: {
							range: { sheetId, dimension: "ROWS", startIndex: row - 1, endIndex: row - 1 + count },
						},
					}
				: {
						deleteRange: {
							range: {
								sheetId,
								startRowIndex: row - 1,
								endRowIndex: row - 1 + count,
								startColumnIndex: band.startCol,
								endColumnIndex: band.endCol,
							},
							shiftDimension: "ROWS",
						},
					};
		await this.batchUpdate([request]);
		return { deletedAt: row, count };
	}

	/** Rename a tab. Sheets rewrites every formula that refers to it, on any tab. Refuses a missing tab or a taken name. */
	async renameTab(from: string, to: string): Promise<{ from: string; to: string; sheetId: number }> {
		const data = await this.request("?fields=sheets.properties");
		const sheets: Array<{ properties: { title: string; sheetId: number } }> = data.sheets ?? [];
		const sheet = sheets.find((s) => s.properties.title === from);
		if (!sheet) throw new SheetsApiError(`Tab "${from}" not found`, 404);
		if (sheets.some((s) => s.properties.title === to)) throw new SheetsApiError(`A tab named "${to}" already exists`, 409);
		const sheetId = sheet.properties.sheetId;
		await this.batchUpdate([{ updateSheetProperties: { properties: { sheetId, title: to }, fields: "title" } }]);
		return { from, to, sheetId };
	}

	async addTab(title: string): Promise<{ title: string; sheetId: number }> {
		const data = await this.batchUpdate([{ addSheet: { properties: { title } } }]);
		const props = data.replies?.[0]?.addSheet?.properties;
		return { title: props?.title ?? title, sheetId: props?.sheetId ?? -1 };
	}
}
