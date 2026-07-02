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
			vi.fn(async () => new Response("<html>Server Error</html>", { status: 502 })),
		);

		const promise = makeClient().readRange("Transactions!A1");
		await expect(promise).rejects.toThrow("Sheets API error (502)");
		await expect(promise).rejects.toBeInstanceOf(SheetsApiError);
	});
});

/**
 * `RequestInit.body` is typed as `BodyInit | null | undefined`; our client
 * always passes a JSON string, so this narrows just enough to call
 * `JSON.parse`. This is the one cast Fix 4 keeps (see final-review-fixes.md).
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
