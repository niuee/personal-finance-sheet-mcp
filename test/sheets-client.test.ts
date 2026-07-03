import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoogleAuth } from "../src/google-auth";
import { MAX_READ_CHARS, SheetsApiError, SheetsClient } from "../src/sheets-client";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets/SHEET_ID";
const auth = { getToken: async () => "test-token" } as unknown as GoogleAuth;

function makeClient(): SheetsClient {
	return new SheetsClient(auth, "SHEET_ID");
}

function jsonResponse(data: unknown): Response {
	return new Response(JSON.stringify(data), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

describe("SheetsClient reads", () => {
	it("listTabs returns tab names and dimensions", async () => {
		const fetchMock = vi.fn<FetchMock>(async () =>
			jsonResponse({
				sheets: [
					{ properties: { title: "Transactions", gridProperties: { rowCount: 500, columnCount: 8 } } },
					{ properties: { title: "Budget", gridProperties: { rowCount: 100, columnCount: 4 } } },
				],
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const tabs = await makeClient().listTabs();

		expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}?fields=sheets.properties`);
		expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer test-token" });
		expect(tabs).toEqual([
			{ title: "Transactions", rowCount: 500, columnCount: 8 },
			{ title: "Budget", rowCount: 100, columnCount: 4 },
		]);
	});

	it("readRange URL-encodes the range and returns values", async () => {
		const fetchMock = vi.fn<FetchMock>(async () =>
			jsonResponse({ range: "Transactions!A1:B2", values: [["date", "amount"], ["2026-07-01", 42]] }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await makeClient().readRange("Transactions!A1:B2");

		expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/values/Transactions!A1%3AB2`);
		expect(result).toEqual({
			range: "Transactions!A1:B2",
			values: [["date", "amount"], ["2026-07-01", 42]],
			truncated: false,
		});
	});

	it("readRange truncates oversized results and flags it", async () => {
		const bigRow = ["x".repeat(500)];
		const rows = Array.from({ length: 500 }, () => bigRow);
		vi.stubGlobal(
			"fetch",
			vi.fn<FetchMock>(async () => jsonResponse({ range: "Log!A1:A500", values: rows })),
		);

		const result = await makeClient().readRange("Log!A1:A500");

		expect(result.truncated).toBe(true);
		expect(result.values.length).toBeLessThan(500);
		expect(result.values.length).toBeGreaterThan(0);
		expect(JSON.stringify(result.values).length).toBeLessThanOrEqual(MAX_READ_CHARS);
	});

	it("surfaces Google's error message with the status", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<FetchMock>(async () =>
				new Response(JSON.stringify({ error: { message: "Unable to parse range: Nope!A1" } }), {
					status: 400,
				}),
			),
		);

		const promise = makeClient().readRange("Nope!A1");
		await expect(promise).rejects.toThrow("Unable to parse range: Nope!A1");
		await expect(promise).rejects.toBeInstanceOf(SheetsApiError);
	});

	it("falls back to a generic message when the error body is not JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<FetchMock>(async () => new Response("<html>Server Error</html>", { status: 502 })),
		);

		const promise = makeClient().readRange("Transactions!A1");
		await expect(promise).rejects.toThrow("Sheets API error (502)");
		await expect(promise).rejects.toBeInstanceOf(SheetsApiError);
	});
});

/**
 * `RequestInit.body` is typed as `BodyInit | null | undefined`; our client
 * always passes a JSON string, so this narrows just enough to call
 * `JSON.parse` — and fails loudly if the body is ever not a JSON string.
 */
function parsedBody(init: RequestInit | undefined): unknown {
	return JSON.parse(init?.body as string);
}

describe("SheetsClient writes", () => {
	it("appendRows POSTs USER_ENTERED values to the quoted tab", async () => {
		const fetchMock = vi.fn<FetchMock>(async () =>
			jsonResponse({ updates: { updatedRange: "'My Tab'!A10:B11", updatedRows: 2 } }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await makeClient().appendRows("My Tab", [
			["2026-07-02", 12.5],
			["2026-07-02", -3],
		]);

		expect(fetchMock.mock.calls[0][0]).toBe(
			`${BASE}/values/'My%20Tab'!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
		);
		expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
		expect(parsedBody(fetchMock.mock.calls[0][1])).toEqual({
			values: [["2026-07-02", 12.5], ["2026-07-02", -3]],
		});
		expect(result).toEqual({ updatedRange: "'My Tab'!A10:B11", updatedRows: 2 });
	});

	it("appendRows escapes single quotes in tab names", async () => {
		const fetchMock = vi.fn<FetchMock>(async () =>
			jsonResponse({ updates: { updatedRange: "x", updatedRows: 1 } }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await makeClient().appendRows("Bob's Tab", [["a"]]);

		expect(String(fetchMock.mock.calls[0][0])).toContain("/values/'Bob''s%20Tab'!A1:append");
	});

	it("updateRange PUTs USER_ENTERED values", async () => {
		const fetchMock = vi.fn<FetchMock>(async () =>
			jsonResponse({ updatedRange: "Budget!B2", updatedCells: 1 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await makeClient().updateRange("Budget!B2", [[99]]);

		expect(fetchMock.mock.calls[0][0]).toBe(
			`${BASE}/values/Budget!B2?valueInputOption=USER_ENTERED`,
		);
		expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT");
		expect(parsedBody(fetchMock.mock.calls[0][1])).toEqual({ values: [[99]] });
		expect(result).toEqual({ updatedRange: "Budget!B2", updatedCells: 1 });
	});

	it("addTab issues a batchUpdate addSheet request", async () => {
		const fetchMock = vi.fn<FetchMock>(async () =>
			jsonResponse({ replies: [{ addSheet: { properties: { title: "2027", sheetId: 12345 } } }] }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await makeClient().addTab("2027");

		expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}:batchUpdate`);
		expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
		expect(parsedBody(fetchMock.mock.calls[0][1])).toEqual({
			requests: [{ addSheet: { properties: { title: "2027" } } }],
		});
		expect(result).toEqual({ title: "2027", sheetId: 12345 });
	});
});

describe("SheetsClient generic additions", () => {
	it("batchUpdate POSTs the requests array to :batchUpdate", async () => {
		const fetchMock = vi.fn<FetchMock>(async () => jsonResponse({ replies: [{}] }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await makeClient().batchUpdate([{ foo: { bar: 1 } }]);

		expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}:batchUpdate`);
		expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
		expect(parsedBody(fetchMock.mock.calls[0][1])).toEqual({ requests: [{ foo: { bar: 1 } }] });
		expect(result).toEqual({ replies: [{}] });
	});

	it("getSheetId resolves a tab title to its numeric sheetId", async () => {
		const fetchMock = vi.fn<FetchMock>(async () =>
			jsonResponse({
				sheets: [
					{ properties: { title: "9 月", sheetId: 111 } },
					{ properties: { title: "火車模型", sheetId: 222 } },
				],
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		expect(await makeClient().getSheetId("火車模型")).toBe(222);
		expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}?fields=sheets.properties`);
	});

	it("getSheetId throws a SheetsApiError naming the missing tab", async () => {
		vi.stubGlobal("fetch", vi.fn<FetchMock>(async () => jsonResponse({ sheets: [] })));

		const promise = makeClient().getSheetId("Nope");
		await expect(promise).rejects.toThrow('Tab "Nope" not found');
		await expect(promise).rejects.toBeInstanceOf(SheetsApiError);
	});

	it("insertRows issues insertDimension with 0-indexed bounds and inheritFromBefore", async () => {
		const fetchMock = vi
			.fn<FetchMock>()
			.mockResolvedValueOnce(jsonResponse({ sheets: [{ properties: { title: "9 月", sheetId: 111 } }] }))
			.mockResolvedValueOnce(jsonResponse({ replies: [{}] }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await makeClient().insertRows("9 月", 24, 2);

		expect(parsedBody(fetchMock.mock.calls[1][1])).toEqual({
			requests: [
				{
					insertDimension: {
						range: { sheetId: 111, dimension: "ROWS", startIndex: 23, endIndex: 25 },
						inheritFromBefore: true,
					},
				},
			],
		});
		expect(result).toEqual({ insertedAt: 24, count: 2 });
	});

	it("readRange passes valueRenderOption only for non-default modes", async () => {
		const fetchMock = vi.fn<FetchMock>(async () => jsonResponse({ range: "x", values: [] }));
		vi.stubGlobal("fetch", fetchMock);

		const client = makeClient();
		await client.readRange("A1");
		await client.readRange("A1", "UNFORMATTED_VALUE");
		await client.readRange("A1", "FORMULA");

		expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/values/A1`);
		expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/values/A1?valueRenderOption=UNFORMATTED_VALUE`);
		expect(fetchMock.mock.calls[2][0]).toBe(`${BASE}/values/A1?valueRenderOption=FORMULA`);
	});
});

describe("SheetsClient.getDataValidation", () => {
	it("requests only dataValidation fields for the probe range and extracts a ONE_OF_LIST rule", async () => {
		const fetchMock = vi.fn<FetchMock>(async () =>
			jsonResponse({
				sheets: [
					{
						data: [
							{
								startRow: 2,
								rowData: [
									{}, // C3: no validation (recurring row)
									{
										values: [
											{
												dataValidation: {
													condition: {
														type: "ONE_OF_LIST",
														values: [
															{ userEnteredValue: "訂閱" },
															{ userEnteredValue: "吃喝" },
															{ userEnteredValue: "交通" },
														],
													},
												},
											},
										],
									},
								],
							},
						],
					},
				],
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const rule = await makeClient().getDataValidation("7 月", 3, 15, "C");

		expect(fetchMock.mock.calls[0][0]).toBe(
			`${BASE}?ranges=${encodeURIComponent("'7 月'!C3:C15")}&fields=sheets.data(startRow,rowData.values.dataValidation)`,
		);
		expect(rule).toEqual({ type: "ONE_OF_LIST", values: ["訂閱", "吃喝", "交通"] });
	});

	it("returns the range string for a ONE_OF_RANGE rule", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<FetchMock>(async () =>
				jsonResponse({
					sheets: [
						{
							data: [
								{
									startRow: 2,
									rowData: [
										{
											values: [
												{
													dataValidation: {
														condition: {
															type: "ONE_OF_RANGE",
															values: [{ userEnteredValue: "=Settings!A1:A20" }],
														},
													},
												},
											],
										},
									],
								},
							],
						},
					],
				}),
			),
		);

		const rule = await makeClient().getDataValidation("7 月", 3, 15, "C");

		expect(rule).toEqual({ type: "ONE_OF_RANGE", values: ["=Settings!A1:A20"] });
	});

	it("returns null when no cell in the window has a rule", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<FetchMock>(async () =>
				jsonResponse({ sheets: [{ data: [{ startRow: 2, rowData: [{}, { values: [{}] }] }] }] }),
			),
		);

		expect(await makeClient().getDataValidation("6 月", 3, 15, "C")).toBeNull();
	});

	it("returns null when the response has no grid data at all", async () => {
		vi.stubGlobal("fetch", vi.fn<FetchMock>(async () => jsonResponse({})));

		expect(await makeClient().getDataValidation("6 月", 3, 15, "C")).toBeNull();
	});
});
