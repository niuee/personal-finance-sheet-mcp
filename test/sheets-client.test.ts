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

describe("SheetsClient reads", () => {
	it("listTabs returns tab names and dimensions", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				sheets: [
					{ properties: { title: "Transactions", gridProperties: { rowCount: 500, columnCount: 8 } } },
					{ properties: { title: "Budget", gridProperties: { rowCount: 100, columnCount: 4 } } },
				],
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const tabs = await makeClient().listTabs();

		expect((fetchMock.mock.calls[0] as any)[0]).toBe(`${BASE}?fields=sheets.properties`);
		expect((fetchMock.mock.calls[0] as any)[1].headers.Authorization).toBe("Bearer test-token");
		expect(tabs).toEqual([
			{ title: "Transactions", rowCount: 500, columnCount: 8 },
			{ title: "Budget", rowCount: 100, columnCount: 4 },
		]);
	});

	it("readRange URL-encodes the range and returns values", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ range: "Transactions!A1:B2", values: [["date", "amount"], ["2026-07-01", 42]] }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await makeClient().readRange("Transactions!A1:B2");

		expect((fetchMock.mock.calls[0] as any)[0]).toBe(`${BASE}/values/Transactions!A1%3AB2`);
		expect(result).toEqual({
			range: "Transactions!A1:B2",
			values: [["date", "amount"], ["2026-07-01", 42]],
			truncated: false,
		});
	});

	it("readRange truncates oversized results and flags it", async () => {
		const bigRow = ["x".repeat(500)];
		const rows = Array.from({ length: 500 }, () => bigRow);
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ range: "Log!A1:A500", values: rows })));

		const result = await makeClient().readRange("Log!A1:A500");

		expect(result.truncated).toBe(true);
		expect(result.values.length).toBeLessThan(500);
		expect(result.values.length).toBeGreaterThan(0);
		expect(JSON.stringify(result.values).length).toBeLessThanOrEqual(MAX_READ_CHARS);
	});

	it("surfaces Google's error message with the status", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(JSON.stringify({ error: { message: "Unable to parse range: Nope!A1" } }), {
					status: 400,
				}),
			),
		);

		const promise = makeClient().readRange("Nope!A1");
		await expect(promise).rejects.toThrow("Unable to parse range: Nope!A1");
		await expect(promise).rejects.toBeInstanceOf(SheetsApiError);
	});
});
