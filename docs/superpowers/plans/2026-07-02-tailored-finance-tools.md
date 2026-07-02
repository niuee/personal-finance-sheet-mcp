# Tailored Finance Tools (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six new MCP tools that encode Vincent's actual spreadsheet conventions (log expenses, summarize months, open new month tabs, log trip purchases, expose conventions + row-insert primitives) on the already-deployed `sheets-mcp` Worker.

**Architecture:** A `src/conventions.ts` module is the single source of truth for the sheet layout. A `src/finance-ops.ts` module holds pure, unit-testable operations (anchor finding, formula surgery, request building) that call `SheetsClient`. `src/tools.ts` gains a `registerTailoredTools` function wiring ops to MCP. `SheetsClient` grows three generic methods (`batchUpdate`, `getSheetId`, `insertRows`) and a `valueRenderOption` parameter on `readRange`.

**Tech Stack:** Existing project stack — TypeScript on Cloudflare Workers, Google Sheets v4 REST via `fetch`, zod v4 tool schemas, vitest, **bun** for all commands (`bun run test`, `bun run type-check`).

**Spec:** `docs/superpowers/specs/2026-07-02-tailored-finance-tools-design.md` (the "observed sheet layout" section there is ground truth for all anchors and formulas used below).

## Global Constraints

- Use bun, not npm: `bun run test`, `bun run type-check`, `bun run dev`, `bunx wrangler …`.
- No new dependencies.
- All category/recurring/layout knowledge lives ONLY in `src/conventions.ts` — no other file may hardcode a Chinese label or row/column number from the sheet.
- Category formula cells are located by searching column E for the label — never by hardcoded cell address.
- Fail-closed: every op validates all anchors and builds its full request list BEFORE the first write call; anchor-miss errors must name what was searched for and where.
- `add_expense` is one atomic `batchUpdate` (insert + cell writes + category formula together).
- Existing 14 tests must keep passing untouched (except the two `readRange`-URL assertions Task 1 legitimately extends).
- tsconfig excludes the dom lib — fix test-only type friction with test-local `as` assertions, never tsconfig changes.
- Commits after every task; author `niuee <vntchang@gmail.com>` (already configured). Pushing to `main` auto-deploys via Cloudflare Workers Builds — during Tasks 1–6 commit locally but push only when the task's tests pass.
- 1-indexed rows in all public function signatures and returns; convert to 0-indexed only inside Sheets API request bodies.

---

### Task 1: SheetsClient generic additions

**Files:**
- Modify: `src/sheets-client.ts`
- Test: `test/sheets-client.test.ts` (append a new describe block; also extend the type alias usage as shown)

**Interfaces:**
- Consumes: existing `SheetsClient` internals (`request()` helper), `SheetsApiError`.
- Produces (later tasks call these exact signatures):
  - `batchUpdate(requests: object[]): Promise<any>` — POST `:batchUpdate`, returns parsed response
  - `getSheetId(title: string): Promise<number>` — throws `SheetsApiError(404)` if tab missing
  - `insertRows(tab: string, row: number, count: number): Promise<{ insertedAt: number; count: number }>` — 1-indexed `row` = where the first new row lands; `inheritFromBefore: true`
  - `readRange(range: string, renderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA")` — default `FORMATTED_VALUE` keeps today's URL (no query param)

- [ ] **Step 1: Write the failing tests**

Append to `test/sheets-client.test.ts` (uses the existing `BASE`, `makeClient`, `jsonResponse`, `FetchMock`, `parsedBody` helpers already in the file):

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `batchUpdate is not a function` (and the other four); existing 14 still pass.

- [ ] **Step 3: Implement in `src/sheets-client.ts`**

Change `readRange`'s signature (the body below it is unchanged except the URL line):

```ts
	async readRange(
		range: string,
		renderOption: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA" = "FORMATTED_VALUE",
	): Promise<{ range: string; values: unknown[][]; truncated: boolean }> {
		const query = renderOption === "FORMATTED_VALUE" ? "" : `?valueRenderOption=${renderOption}`;
		const data = await this.request(`/values/${encodeURIComponent(range)}${query}`);
```

Add the three methods inside the class (and refactor `addTab` onto `batchUpdate` — its request body and return are unchanged, so its existing test still passes):

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test && bun run type-check`
Expected: 19 tests PASS (14 existing + 5 new); type-check exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/sheets-client.ts test/sheets-client.test.ts
git commit -m "feat: sheets client batchUpdate/getSheetId/insertRows and render options"
```

---

### Task 2: Conventions module

**Files:**
- Create: `src/conventions.ts`
- Test: `test/conventions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact exports later tasks import):
  - `TOTAL_ROW_LABEL: string` (= `"花費總額"`)
  - `CATEGORIES: Record<string, string>` — short name → exact sheet label
  - `DEFAULT_CATEGORY: string` (= `"額外雜支"`)
  - `RECURRING_ITEMS: Set<string>`
  - `monthTabName(month: number): string` → `"N 月"`, throws on non-integer or out of 1–12
  - `currentMonthTab(now?: Date): string`
  - `previousMonth(month: number): number` — 1 → 12
  - `TRIP_CATEGORY_ROW: number` (= 2), `TRIP_BLOCK_WIDTH: number` (= 8, 7 data columns + 1 spacer)
  - `CONVENTIONS_TEXT: string`

- [ ] **Step 1: Write the failing tests**

Create `test/conventions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	CATEGORIES,
	CONVENTIONS_TEXT,
	currentMonthTab,
	DEFAULT_CATEGORY,
	monthTabName,
	previousMonth,
	RECURRING_ITEMS,
	TOTAL_ROW_LABEL,
} from "../src/conventions";

describe("conventions", () => {
	it("builds month tab names with the space Vincent uses", () => {
		expect(monthTabName(9)).toBe("9 月");
		expect(monthTabName(12)).toBe("12 月");
	});

	it("rejects invalid months", () => {
		expect(() => monthTabName(0)).toThrow("Invalid month");
		expect(() => monthTabName(13)).toThrow("Invalid month");
		expect(() => monthTabName(1.5)).toThrow("Invalid month");
	});

	it("derives the current month tab from a date", () => {
		expect(currentMonthTab(new Date("2026-07-02T12:00:00"))).toBe("7 月");
		expect(currentMonthTab(new Date("2026-12-31T12:00:00"))).toBe("12 月");
	});

	it("wraps January's previous month to December", () => {
		expect(previousMonth(1)).toBe(12);
		expect(previousMonth(10)).toBe(9);
	});

	it("maps short category names to the exact sheet labels", () => {
		expect(CATEGORIES["訂閱費"]).toBe("訂閱費");
		expect(CATEGORIES["交通中餐雜支"]).toBe("交通中餐等等雜支");
		expect(CATEGORIES["額外雜支"]).toBe("本月額外雜支");
		expect(CATEGORIES[DEFAULT_CATEGORY]).toBeDefined();
	});

	it("knows the recurring items and the total-row anchor", () => {
		expect(TOTAL_ROW_LABEL).toBe("花費總額");
		for (const item of ["Google Cloud", "Netflix", "電話費", "上月透支", "Claude"]) {
			expect(RECURRING_ITEMS.has(item)).toBe(true);
		}
		expect(RECURRING_ITEMS.has("近鐵 80000系")).toBe(false);
	});

	it("conventions text mentions the anchors Claude needs", () => {
		for (const needle of ["花費總額", "GOOGLEFINANCE", "上月透支", "insert", "0.22"]) {
			expect(CONVENTIONS_TEXT).toContain(needle);
		}
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `../src/conventions`.

- [ ] **Step 3: Implement `src/conventions.ts`**

```ts
/**
 * Single source of truth for the layout of Vincent's personal-finance
 * spreadsheet. Every tailored tool reads its anchors, labels, and lists from
 * here — when the sheet layout changes, this file (and only this file)
 * changes with it.
 */

export const TOTAL_ROW_LABEL = "花費總額";

/** Short category name (tool parameter) → exact label text in column E. */
export const CATEGORIES: Record<string, string> = {
	訂閱費: "訂閱費",
	交通中餐雜支: "交通中餐等等雜支",
	額外雜支: "本月額外雜支",
};

export const DEFAULT_CATEGORY = "額外雜支";

/** Items start_month keeps when opening a new month; everything else is a one-off. */
export const RECURRING_ITEMS = new Set<string>([
	"上月透支",
	"Google Cloud",
	"ElevenLabs",
	"iCloud",
	"Google One",
	"Netflix",
	"ECSI Loan",
	"Fed Loan",
	"Cursor",
	"每月銀行管理",
	"電話費",
	"公車儲值",
	"中餐",
	"荒野亂鬥月票",
	"中餐額外",
	"ChatGPT",
	"GitHub Action Minutes",
	"Claude",
	"基本生活費",
]);

export function monthTabName(month: number): string {
	if (!Number.isInteger(month) || month < 1 || month > 12) {
		throw new Error(`Invalid month: ${month} (expected an integer 1-12)`);
	}
	return `${month} 月`;
}

export function currentMonthTab(now: Date = new Date()): string {
	return monthTabName(now.getMonth() + 1);
}

export function previousMonth(month: number): number {
	return month === 1 ? 12 : month - 1;
}

/** Trip tabs: row 2 holds the category block titles (模型, 書, ...). */
export const TRIP_CATEGORY_ROW = 2;
/** Each block is 7 data columns (日期 店鋪 品項 支付方式 日幣原價 臺幣匯率 臺幣進位) + 1 spacer. */
export const TRIP_BLOCK_WIDTH = 8;

export const CONVENTIONS_TEXT = `How this personal-finance spreadsheet is organized:

MONTHLY TABS — named "N 月" (e.g. "9 月", with a space).
- Expense list in columns A-C from row 3 down: A=item, B=美金 (USD), C=新臺幣 (TWD).
- USD rows convert with C = B*GOOGLEFINANCE("CURRENCY:USDTWD").
- The list ends at the "花費總額" row (label in column B, total in C, formula SUM over the window). New expenses must land INSIDE that window — write into an empty row above 花費總額, or insert a row inside the window so the SUM extends. Never append below 花費總額.
- Row 3 "上月透支" carries last month's overdraft via a cross-tab formula.
- Summary block, labels in column E / values in F: 訂閱費, 基本房租生活費 (fixed rent, not a sum), 交通中餐等等雜支, 本月額外雜支. The sums reference hand-picked cells (e.g. sum(C22,C3)) — adding an expense to a category means splicing its C-cell into that formula.
- Below the list: 總預算 / 沛還 / 薪水 / 剩餘 / 美金支付 (labels in column A, values in B).

TRIP TABS — e.g. "2026/07/25 京都東京".
- Side-by-side category blocks (模型, 書, ...), block titles in row 2, one spacer column between blocks.
- Block columns: 日期, 店鋪, 品項, 支付方式, 日幣原價, 臺幣 0.22 匯率, 臺幣 進位.

OTHER — "火車模型" is a hobby purchase planner; monthly tabs may cross-reference its cells.

Prefer the tailored tools (add_expense, month_summary, start_month, add_trip_entry) over raw range edits. For math, read with mode "raw" — default reads return locale-formatted strings like "13,603.67".`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test && bun run type-check`
Expected: 26 tests PASS; type-check exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts test/conventions.test.ts
git commit -m "feat: conventions module encoding the sheet layout"
```

---

### Task 3: Finance-ops helpers (formula surgery + anchors)

**Files:**
- Create: `src/finance-ops.ts`
- Test: `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: nothing yet (pure functions; the module gains client-calling ops in Tasks 4–5).
- Produces (exact signatures; Tasks 4–5 build on these):
  - `spliceIntoSum(formula: string, cellRef: string): string` — throws if not a `sum(...)`
  - `adjustColumnRefsForInsert(formula: string, column: string, insertedAt: number): string`
  - `stripRefErrors(formula: string): string`
  - `adaptRowFormula(formula: string, fromRow: number, toRow: number): string`
  - `findRowByValue(values: unknown[][], colIndex: number, needle: string): number | null` — returns 1-indexed row
  - `cellData(v: string | number | null): object` — Sheets `CellData` (`formulaValue` for `=`-strings, `numberValue`, `stringValue`, `{}` for null)
  - `colLetter(index0: number): string` — 0 → "A", 8 → "I"

- [ ] **Step 1: Write the failing tests**

Create `test/finance-ops.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	adaptRowFormula,
	adjustColumnRefsForInsert,
	cellData,
	colLetter,
	findRowByValue,
	spliceIntoSum,
	stripRefErrors,
} from "../src/finance-ops";

describe("formula surgery", () => {
	it("splices a cell ref into a sum formula", () => {
		expect(spliceIntoSum("=sum(C22,C3)", "C24")).toBe("=sum(C22,C3,C24)");
		expect(spliceIntoSum("=sum(C4,C5,C6,C7,C8,C9,C10,C11,C12,C18,C20,C16)", "C23")).toBe(
			"=sum(C4,C5,C6,C7,C8,C9,C10,C11,C12,C18,C20,C16,C23)",
		);
		expect(spliceIntoSum("=SUM(C13,C14)", "C15")).toBe("=SUM(C13,C14,C15)");
	});

	it("refuses to splice into a non-sum formula", () => {
		expect(() => spliceIntoSum("=20000", "C9")).toThrow("not a sum");
	});

	it("shifts C-refs at/below the insertion row down by one", () => {
		expect(adjustColumnRefsForInsert("=sum(C22,C3)", "C", 24)).toBe("=sum(C22,C3)");
		expect(adjustColumnRefsForInsert("=sum(C22,C3)", "C", 22)).toBe("=sum(C23,C3)");
		expect(adjustColumnRefsForInsert("=SUM(C3:C24)", "C", 10)).toBe("=SUM(C3:C25)");
	});

	it("strips #REF! entries left by row deletions", () => {
		expect(stripRefErrors("=sum(#REF!,C3)")).toBe("=sum(C3)");
		expect(stripRefErrors("=sum(C4,#REF!,C6)")).toBe("=sum(C4,C6)");
		expect(stripRefErrors("=sum(C4,#REF!)")).toBe("=sum(C4)");
	});

	it("re-targets a single-row formula to another row", () => {
		expect(adaptRowFormula("=E5*0.22", 5, 9)).toBe("=E9*0.22");
		expect(adaptRowFormula("=CEILING(F12)", 12, 30)).toBe("=CEILING(F30)");
		// must not touch a different row number that merely contains the digits
		expect(adaptRowFormula("=E5*105", 5, 9)).toBe("=E9*105");
	});
});

describe("grid helpers", () => {
	it("findRowByValue returns the 1-indexed row of an exact match", () => {
		const values = [["9 月花費"], ["", "美金"], ["上月透支", "", "13,603.67"], ["", "花費總額", "72,127.21"]];
		expect(findRowByValue(values, 1, "花費總額")).toBe(4);
		expect(findRowByValue(values, 0, "上月透支")).toBe(3);
		expect(findRowByValue(values, 0, "missing")).toBeNull();
	});

	it("cellData picks the right CellData variant", () => {
		expect(cellData("中餐")).toEqual({ userEnteredValue: { stringValue: "中餐" } });
		expect(cellData(250)).toEqual({ userEnteredValue: { numberValue: 250 } });
		expect(cellData("=B4*2")).toEqual({ userEnteredValue: { formulaValue: "=B4*2" } });
		expect(cellData(null)).toEqual({});
	});

	it("colLetter converts 0-indexed columns", () => {
		expect(colLetter(0)).toBe("A");
		expect(colLetter(8)).toBe("I");
		expect(colLetter(26)).toBe("AA");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — cannot resolve `../src/finance-ops`.

- [ ] **Step 3: Implement the helpers in `src/finance-ops.ts`**

```ts
/**
 * Operations that understand Vincent's sheet conventions. Pure helpers here;
 * client-calling ops (addExpense, monthSummary, startMonth, addTripEntry)
 * live in this module too and are the only writers the tailored tools use.
 */

/** Append a cell ref inside the final closing paren: "=sum(C22,C3)" + "C24" → "=sum(C22,C3,C24)". */
export function spliceIntoSum(formula: string, cellRef: string): string {
	const i = formula.lastIndexOf(")");
	if (!formula.toLowerCase().includes("sum(") || i === -1) {
		throw new Error(`Category formula is not a sum(...) that can be extended: "${formula}"`);
	}
	return `${formula.slice(0, i)},${cellRef})`;
}

/**
 * Adjust a formula that was read BEFORE an insertDimension so it is correct
 * AFTER: 1-indexed refs to `column` at/below `insertedAt` shift down by one.
 */
export function adjustColumnRefsForInsert(formula: string, column: string, insertedAt: number): string {
	const re = new RegExp(`\\b${column}(\\d+)\\b`, "g");
	return formula.replace(re, (_m, n: string) => {
		const row = Number(n);
		return `${column}${row >= insertedAt ? row + 1 : row}`;
	});
}

/** Remove #REF! entries a row deletion leaves inside sum(...) lists. */
export function stripRefErrors(formula: string): string {
	return formula.replace(/#REF!\s*,\s*/g, "").replace(/,\s*#REF!/g, "");
}

/** Re-target a single-row formula: "=E5*0.22" from row 5 to row 9 → "=E9*0.22". */
export function adaptRowFormula(formula: string, fromRow: number, toRow: number): string {
	const re = new RegExp(`([A-Z]{1,2})${fromRow}(?![0-9])`, "g");
	return formula.replace(re, (_m, col: string) => `${col}${toRow}`);
}

/** 1-indexed row of the first exact (trimmed) match of `needle` in column `colIndex`, else null. */
export function findRowByValue(values: unknown[][], colIndex: number, needle: string): number | null {
	for (let i = 0; i < values.length; i++) {
		if (String(values[i]?.[colIndex] ?? "").trim() === needle) return i + 1;
	}
	return null;
}

/** Sheets CellData for updateCells requests. */
export function cellData(v: string | number | null): object {
	if (v === null) return {};
	if (typeof v === "number") return { userEnteredValue: { numberValue: v } };
	if (v.startsWith("=")) return { userEnteredValue: { formulaValue: v } };
	return { userEnteredValue: { stringValue: v } };
}

/** 0-indexed column → A1 letter ("A", "I", "AA"). */
export function colLetter(index0: number): string {
	let s = "";
	let i = index0 + 1;
	while (i > 0) {
		s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
		i = Math.floor((i - 1) / 26);
	}
	return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test && bun run type-check`
Expected: 34 tests PASS; type-check exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: formula surgery and grid helpers for tailored finance ops"
```

---

### Task 4: `addExpense` and `monthSummary` ops

**Files:**
- Modify: `src/finance-ops.ts` (append)
- Test: `test/finance-ops.test.ts` (append)

**Interfaces:**
- Consumes: Task 3 helpers; `SheetsClient.readRange(range, renderOption)`, `.getSheetId(title)`, `.batchUpdate(requests)`; conventions exports `TOTAL_ROW_LABEL`, `CATEGORIES`, `DEFAULT_CATEGORY`, `monthTabName`, `currentMonthTab`.
- Produces:
  - `addExpense(client: SheetsClient, p: { item: string; amount: number; currency: "TWD" | "USD"; category?: string; month?: number }): Promise<{ tab: string; row: number; inserted: boolean; item: string; amount: number; currency: string; category: string; categoryFormula: string }>`
  - `monthSummary(client: SheetsClient, month?: number): Promise<{ tab: string; 花費總額: number | null; 上月透支: number | null; categories: Record<string, number | null>; 薪水: number | null; 沛還: number | null; 剩餘: number | null; 美金支付: number | null }>`
  - (internal) `const GRID_READ = "A1:F60"` and `quoteTab(tab: string): string` (returns `'9 月'` style with `''`-escaped quotes) — exported for reuse in Task 5

- [ ] **Step 1: Write the failing tests**

Append to `test/finance-ops.test.ts` (add the new imports to the existing import statement: `addExpense`, `monthSummary`; also `import { vi } from "vitest"` — extend the existing vitest import — and `import type { SheetsClient } from "../src/sheets-client";`):

```ts
/** Grid mirroring the real 9月 layout (FORMULA render). Row = index+1. */
function monthGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["9 月花費"];
	g[1] = ["", "美金", "新臺幣"];
	g[2] = ["上月透支", "", "=IF(-'8 月'!B32 > 0, -'8 月'!B32, 0)"];
	g[3] = ["Google Cloud", 11.53, '=B4*GOOGLEFINANCE("CURRENCY:USDTWD")'];
	g[4] = ["ElevenLabs", 6, '=B5*GOOGLEFINANCE("CURRENCY:USDTWD")', "", "訂閱費", "=sum(C4,C5)"];
	g[5] = ["iCloud", 9.99, '=B6*GOOGLEFINANCE("CURRENCY:USDTWD")', "", "基本房租生活費", "=20000"];
	g[6] = ["電話費", "", 1261, "", "交通中餐等等雜支", "=sum(C7)"];
	g[7] = ["近鐵 80000系", "", "='火車模型'!C4", "", "本月額外雜支", "=sum(C8,C3)"];
	// rows 9-10 (indices 8-9) empty inside the window
	g[10] = ["", "花費總額", "=SUM(C3:C10)"];
	g[12] = ["沛還", 20500];
	g[13] = ["薪水", 63913];
	g[14] = ["剩餘", "=sum(B13:B14)-C11"];
	g[15] = ["美金支付", 640.42];
	return g;
}

function fakeClient(grid: unknown[][]): SheetsClient {
	return {
		readRange: vi.fn(async () => ({ range: "x", values: grid, truncated: false })),
		getSheetId: vi.fn(async () => 111),
		batchUpdate: vi.fn(async () => ({ replies: [{}] })),
	} as unknown as SheetsClient;
}

describe("addExpense", () => {
	it("writes a TWD expense into the first empty window row and splices the category formula", async () => {
		const client = fakeClient(monthGrid());

		const result = await addExpense(client, { item: "晚餐", amount: 250, currency: "TWD", month: 9 });

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:F60", "FORMULA"]);
		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests).toEqual([
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 8, columnIndex: 0 },
					rows: [{ values: [
						{ userEnteredValue: { stringValue: "晚餐" } },
						{},
						{ userEnteredValue: { numberValue: 250 } },
					] }],
					fields: "userEnteredValue",
				},
			},
			{
				updateCells: {
					start: { sheetId: 111, rowIndex: 7, columnIndex: 5 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=sum(C8,C3,C9)" } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
		expect(result).toMatchObject({ tab: "9 月", row: 9, inserted: false, category: "額外雜支", categoryFormula: "=sum(C8,C3,C9)" });
	});

	it("writes a USD expense with the GOOGLEFINANCE conversion formula", async () => {
		const client = fakeClient(monthGrid());

		await addExpense(client, { item: "API credits", amount: 30, currency: "USD", category: "訂閱費", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0].updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { stringValue: "API credits" } },
			{ userEnteredValue: { numberValue: 30 } },
			{ userEnteredValue: { formulaValue: '=B9*GOOGLEFINANCE("CURRENCY:USDTWD")' } },
		]);
		expect(requests[1].updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: "=sum(C4,C5,C9)" } },
		]);
	});

	it("inserts a row inside the SUM window when no empty row exists, adjusting formula refs", async () => {
		const grid = monthGrid();
		grid[8] = ["already", "", 1];
		grid[9] = ["full", "", 2];

		const client = fakeClient(grid);
		const result = await addExpense(client, { item: "加購", amount: 100, currency: "TWD", month: 9 });

		const requests = (client.batchUpdate as any).mock.calls[0][0];
		expect(requests[0]).toEqual({
			insertDimension: {
				range: { sheetId: 111, dimension: "ROWS", startIndex: 9, endIndex: 10 },
				inheritFromBefore: true,
			},
		});
		// new row is 10 (1-indexed); category 額外雜支 formula refs C8,C3 (< 10) stay put
		expect(requests[2].updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: "=sum(C8,C3,C10)" } },
		]);
		expect(result).toMatchObject({ row: 10, inserted: true });
	});

	it("rejects unknown categories and missing anchors without writing", async () => {
		const client = fakeClient(monthGrid());
		await expect(addExpense(client, { item: "x", amount: 1, currency: "TWD", category: "咖啡", month: 9 })).rejects.toThrow(
			'Unknown category "咖啡"',
		);

		const noTotal = fakeClient([["nothing here"]]);
		await expect(addExpense(noTotal, { item: "x", amount: 1, currency: "TWD", month: 9 })).rejects.toThrow("花費總額");
		expect((noTotal.batchUpdate as any).mock.calls.length).toBe(0);
	});
});

describe("monthSummary", () => {
	it("returns unformatted numbers keyed to the sheet's own labels", async () => {
		// UNFORMATTED render: numbers where the sheet computes values
		const grid = monthGrid();
		grid[2] = ["上月透支", "", 13603.67];
		grid[4] = ["ElevenLabs", 6, 191.43, "", "訂閱費", 26843.6];
		grid[6] = ["電話費", "", 1261, "", "交通中餐等等雜支", 5511];
		grid[7] = ["近鐵 80000系", "", 5690.37, "", "本月額外雜支", 19294.03];
		grid[10] = ["", "花費總額", 72127.21];
		grid[14] = ["剩餘", 12285.79];

		const client = fakeClient(grid);
		const result = await monthSummary(client, 9);

		expect((client.readRange as any).mock.calls[0]).toEqual(["'9 月'!A1:F60", "UNFORMATTED_VALUE"]);
		expect(result).toEqual({
			tab: "9 月",
			花費總額: 72127.21,
			上月透支: 13603.67,
			categories: { 訂閱費: 26843.6, 交通中餐雜支: 5511, 額外雜支: 19294.03 },
			薪水: 63913,
			沛還: 20500,
			剩餘: 12285.79,
			美金支付: 640.42,
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `addExpense` / `monthSummary` not exported.

- [ ] **Step 3: Implement in `src/finance-ops.ts`**

Add at the top of the file:

```ts
import {
	CATEGORIES,
	currentMonthTab,
	DEFAULT_CATEGORY,
	monthTabName,
	TOTAL_ROW_LABEL,
	TRIP_CATEGORY_ROW,
} from "./conventions";
import type { SheetsClient } from "./sheets-client";
```

Append:

```ts
/** The window that contains every anchor a monthly tab needs. */
export const GRID_READ = "A1:F60";

export function quoteTab(tab: string): string {
	return `'${tab.replace(/'/g, "''")}'`;
}

export interface AddExpenseParams {
	item: string;
	amount: number;
	currency: "TWD" | "USD";
	category?: string;
	month?: number;
}

export async function addExpense(client: SheetsClient, p: AddExpenseParams) {
	const tab = p.month !== undefined ? monthTabName(p.month) : currentMonthTab();
	const categoryKey = p.category ?? DEFAULT_CATEGORY;
	const categoryLabel = CATEGORIES[categoryKey];
	if (!categoryLabel) {
		throw new Error(`Unknown category "${p.category}". Valid categories: ${Object.keys(CATEGORIES).join(", ")}`);
	}

	const { values } = await client.readRange(`${quoteTab(tab)}!${GRID_READ}`, "FORMULA");

	const totalRow = findRowByValue(values, 1, TOTAL_ROW_LABEL);
	if (totalRow === null) {
		throw new Error(`Could not find the "${TOTAL_ROW_LABEL}" row in ${tab} (searched column B of ${GRID_READ}).`);
	}
	const categoryRow = findRowByValue(values, 4, categoryLabel);
	if (categoryRow === null) {
		throw new Error(`Could not find the category label "${categoryLabel}" in column E of ${tab}.`);
	}
	const categoryFormula = String(values[categoryRow - 1]?.[5] ?? "");

	// First fully-empty row inside the expense window (rows 3 .. totalRow-1).
	let targetRow: number | null = null;
	for (let r = 3; r < totalRow; r++) {
		const row = values[r - 1] ?? [];
		if (!row.some((c) => c !== "" && c != null)) {
			targetRow = r;
			break;
		}
	}

	const sheetId = await client.getSheetId(tab);
	const requests: object[] = [];
	const inserted = targetRow === null;
	if (targetRow === null) {
		// Insert INSIDE the SUM window (above its last row) so SUM(C3:Cn) auto-extends.
		targetRow = totalRow - 1;
		requests.push({
			insertDimension: {
				range: { sheetId, dimension: "ROWS", startIndex: targetRow - 1, endIndex: targetRow },
				inheritFromBefore: true,
			},
		});
	}

	const rowCells =
		p.currency === "USD"
			? [cellData(p.item), cellData(p.amount), cellData(`=B${targetRow}*GOOGLEFINANCE("CURRENCY:USDTWD")`)]
			: [cellData(p.item), cellData(null), cellData(p.amount)];
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: targetRow - 1, columnIndex: 0 },
			rows: [{ values: rowCells }],
			fields: "userEnteredValue",
		},
	});

	// The formula was read pre-insert; if we inserted, refs at/below the insert point shifted.
	const baseFormula = inserted ? adjustColumnRefsForInsert(categoryFormula, "C", targetRow) : categoryFormula;
	const categoryRowFinal = inserted && categoryRow >= targetRow ? categoryRow + 1 : categoryRow;
	const newCategoryFormula = spliceIntoSum(baseFormula, `C${targetRow}`);
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: categoryRowFinal - 1, columnIndex: 5 },
			rows: [{ values: [cellData(newCategoryFormula)] }],
			fields: "userEnteredValue",
		},
	});

	await client.batchUpdate(requests);
	return {
		tab,
		row: targetRow,
		inserted,
		item: p.item,
		amount: p.amount,
		currency: p.currency,
		category: categoryKey,
		categoryFormula: newCategoryFormula,
	};
}

export async function monthSummary(client: SheetsClient, month?: number) {
	const tab = month !== undefined ? monthTabName(month) : currentMonthTab();
	const { values } = await client.readRange(`${quoteTab(tab)}!${GRID_READ}`, "UNFORMATTED_VALUE");

	const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
	const cellAt = (row: number | null, col: number): number | null =>
		row === null ? null : num(values[row - 1]?.[col]);
	const rowByA = (label: string) => findRowByValue(values, 0, label);

	const categories: Record<string, number | null> = {};
	for (const [key, label] of Object.entries(CATEGORIES)) {
		categories[key] = cellAt(findRowByValue(values, 4, label), 5);
	}

	return {
		tab,
		花費總額: cellAt(findRowByValue(values, 1, TOTAL_ROW_LABEL), 2),
		上月透支: cellAt(rowByA("上月透支"), 2),
		categories,
		薪水: cellAt(rowByA("薪水"), 1),
		沛還: cellAt(rowByA("沛還"), 1),
		剩餘: cellAt(rowByA("剩餘"), 1),
		美金支付: cellAt(rowByA("美金支付"), 1),
	};
}
```

(The `TRIP_CATEGORY_ROW` import is used in Task 5; if the linter complains at this point, keep it — Task 5 lands in the same file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test && bun run type-check`
Expected: 39 tests PASS; type-check exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: addExpense and monthSummary ops"
```

---

### Task 5: `startMonth` and `addTripEntry` ops

**Files:**
- Modify: `src/finance-ops.ts` (append)
- Test: `test/finance-ops.test.ts` (append)

**Interfaces:**
- Consumes: Task 3 helpers, Task 4's `GRID_READ`/`quoteTab`, conventions (`RECURRING_ITEMS`, `previousMonth`, `TRIP_CATEGORY_ROW`), `SheetsClient.listTabs/getSheetId/batchUpdate/readRange/updateRange`.
- Produces:
  - `startMonth(client: SheetsClient, month: number): Promise<{ tab: string; duplicatedFrom: string; kept: string[]; cleared: string[] }>`
  - `addTripEntry(client: SheetsClient, p: { tab: string; category: string; date: string; shop: string; item: string; paymentMethod: string; jpy: number }): Promise<{ tab: string; category: string; row: number; updatedRange: string }>`

- [ ] **Step 1: Write the failing tests**

Append to `test/finance-ops.test.ts` (add `addTripEntry`, `startMonth` to the finance-ops import; add `RECURRING_ITEMS` if wanted — not required):

```ts
describe("startMonth", () => {
	function startMonthClient(grid: unknown[][], tabs: string[]) {
		const batchUpdate = vi
			.fn()
			.mockResolvedValueOnce({ replies: [{ duplicateSheet: { properties: { sheetId: 555 } } }] })
			.mockResolvedValue({ replies: [{}] });
		return {
			listTabs: vi.fn(async () => tabs.map((title) => ({ title, rowCount: 1000, columnCount: 26 }))),
			getSheetId: vi.fn(async () => 111),
			readRange: vi.fn(async () => ({ range: "x", values: grid, truncated: false })),
			batchUpdate,
		} as unknown as SheetsClient;
	}

	it("duplicates the previous month, rewires 上月透支, and deletes one-off rows bottom-up", async () => {
		const client = startMonthClient(monthGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		const batch = (client.batchUpdate as any).mock.calls;
		expect(batch[0][0]).toEqual([
			{ duplicateSheet: { sourceSheetId: 111, insertSheetIndex: 0, newSheetName: "10 月" } },
		]);
		const requests = batch[1][0];
		expect(requests[0]).toEqual({
			updateCells: {
				start: { sheetId: 555, rowIndex: 0, columnIndex: 0 },
				rows: [{ values: [{ userEnteredValue: { stringValue: "10 月花費" } }] }],
				fields: "userEnteredValue",
			},
		});
		expect(requests[1]).toEqual({
			updateCells: {
				start: { sheetId: 555, rowIndex: 2, columnIndex: 2 },
				rows: [{ values: [{ userEnteredValue: { formulaValue: "=IF(-'9 月'!B32 > 0, -'9 月'!B32, 0)" } }] }],
				fields: "userEnteredValue",
			},
		});
		// 近鐵 80000系 (row 8) is the only non-recurring item in the fixture
		expect(requests[2]).toEqual({
			deleteDimension: { range: { sheetId: 555, dimension: "ROWS", startIndex: 7, endIndex: 8 } },
		});
		expect(result).toEqual({
			tab: "10 月",
			duplicatedFrom: "9 月",
			kept: ["上月透支", "Google Cloud", "ElevenLabs", "iCloud", "電話費"],
			cleared: ["近鐵 80000系"],
		});
	});

	it("scrubs #REF! from category formulas after deletions", async () => {
		const grid = monthGrid();
		const client = startMonthClient(grid, ["9 月", "8 月"]);
		// After the deletion batch, the re-read returns a grid whose 額外雜支 formula has a #REF!
		(client.readRange as any)
			.mockResolvedValueOnce({ range: "x", values: grid, truncated: false })
			.mockResolvedValueOnce({
				range: "x",
				values: (() => {
					const g = monthGrid();
					g[7] = ["", "", "", "", "本月額外雜支", "=sum(#REF!,C3)"];
					return g;
				})(),
				truncated: false,
			});

		await startMonth(client, 10);

		const batch = (client.batchUpdate as any).mock.calls;
		const scrub = batch[2][0];
		expect(scrub).toEqual([
			{
				updateCells: {
					start: { sheetId: 555, rowIndex: 7, columnIndex: 5 },
					rows: [{ values: [{ userEnteredValue: { formulaValue: "=sum(C3)" } }] }],
					fields: "userEnteredValue",
				},
			},
		]);
	});

	it("refuses to overwrite an existing tab and requires the previous month", async () => {
		const exists = startMonthClient(monthGrid(), ["10 月", "9 月"]);
		await expect(startMonth(exists, 10)).rejects.toThrow('"10 月" already exists');

		const noPrev = startMonthClient(monthGrid(), ["7 月"]);
		await expect(startMonth(noPrev, 10)).rejects.toThrow('"9 月" not found');
		expect((noPrev.batchUpdate as any).mock.calls.length).toBe(0);
	});
});

describe("addTripEntry", () => {
	/** Trip grid: 模型 block at cols A-G (0-6), 書 block at I-O (8-14). */
	function tripGrid(): unknown[][] {
		const g: unknown[][] = [];
		g[0] = ["日期", "店鋪", "品項", "支付方式", "日幣原價", "臺幣 0.22 匯率", "臺幣 進位", "", "日期", "店鋪", "品項", "支付方式", "日幣原價"];
		g[1] = ["模型", "", "", "", "", "", "", "", "書"];
		g[2] = ["10/08 16:03", "Yodobashi 京都", "鑷子", "Suica", 1373, "=E3*0.22", "=CEILING(F3)"];
		return g;
	}

	function tripClient(grid: unknown[][]): SheetsClient {
		return {
			readRange: vi.fn(async () => ({ range: "x", values: grid, truncated: false })),
			updateRange: vi.fn(async () => ({ updatedRange: "'京都'!A4:G4", updatedCells: 7 })),
		} as unknown as SheetsClient;
	}

	it("appends to the first empty row of the category block, adapting the previous row's formulas", async () => {
		const client = tripClient(tripGrid());

		const result = await addTripEntry(client, {
			tab: "京都",
			category: "模型",
			date: "10/09 11:00",
			shop: "Volks",
			item: "N規小物",
			paymentMethod: "Suica",
			jpy: 2200,
		});

		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!A4:G4",
			[["10/09 11:00", "Volks", "N規小物", "Suica", 2200, "=E4*0.22", "=CEILING(F4)"]],
		]);
		expect(result).toMatchObject({ row: 4, category: "模型" });
	});

	it("uses the 0.22 fallback when the block has no data rows, offset to the block's columns", async () => {
		const client = tripClient(tripGrid());

		await addTripEntry(client, {
			tab: "京都",
			category: "書",
			date: "10/09",
			shop: "京都鐵道博物館",
			item: "Guide Book",
			paymentMethod: "Suica",
			jpy: 1100,
		});

		expect((client.updateRange as any).mock.calls[0]).toEqual([
			"'京都'!I3:O3",
			[["10/09", "京都鐵道博物館", "Guide Book", "Suica", 1100, "=M3*0.22", "=CEILING(N3)"]],
		]);
	});

	it("names the available blocks when the category is missing", async () => {
		const client = tripClient(tripGrid());
		await expect(
			addTripEntry(client, { tab: "京都", category: "食物", date: "x", shop: "x", item: "x", paymentMethod: "x", jpy: 1 }),
		).rejects.toThrow("模型, 書");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `startMonth` / `addTripEntry` not exported.

- [ ] **Step 3: Implement in `src/finance-ops.ts`**

Add `previousMonth` and `RECURRING_ITEMS` to the conventions import, then append:

```ts
export async function startMonth(client: SheetsClient, month: number) {
	const newTab = monthTabName(month);
	const prevTab = monthTabName(previousMonth(month));

	const tabs = await client.listTabs();
	if (tabs.some((t) => t.title === newTab)) {
		throw new Error(`Tab "${newTab}" already exists — refusing to overwrite it.`);
	}
	if (!tabs.some((t) => t.title === prevTab)) {
		throw new Error(`Previous month tab "${prevTab}" not found — cannot duplicate it.`);
	}

	const prevSheetId = await client.getSheetId(prevTab);
	const dup = await client.batchUpdate([
		{ duplicateSheet: { sourceSheetId: prevSheetId, insertSheetIndex: 0, newSheetName: newTab } },
	]);
	const sheetId = dup.replies?.[0]?.duplicateSheet?.properties?.sheetId;
	if (sheetId == null) throw new Error("duplicateSheet did not return the new tab's sheetId.");

	const { values } = await client.readRange(`${quoteTab(newTab)}!${GRID_READ}`, "FORMULA");
	const totalRow = findRowByValue(values, 1, TOTAL_ROW_LABEL);
	if (totalRow === null) {
		throw new Error(`Could not find the "${TOTAL_ROW_LABEL}" row in the duplicated tab ${newTab}.`);
	}

	const requests: object[] = [
		{
			updateCells: {
				start: { sheetId, rowIndex: 0, columnIndex: 0 },
				rows: [{ values: [cellData(`${month} 月花費`)] }],
				fields: "userEnteredValue",
			},
		},
	];

	const overdraftRow = findRowByValue(values, 0, "上月透支");
	if (overdraftRow !== null) {
		const formula = String(values[overdraftRow - 1]?.[2] ?? "");
		const rewired = formula.replace(/'\d+ 月'/g, `'${prevTab}'`);
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: overdraftRow - 1, columnIndex: 2 },
				rows: [{ values: [cellData(rewired)] }],
				fields: "userEnteredValue",
			},
		});
	}

	const kept: string[] = [];
	const cleared: string[] = [];
	const rowsToDelete: number[] = [];
	for (let r = 3; r < totalRow; r++) {
		const item = String(values[r - 1]?.[0] ?? "").trim();
		if (item === "") continue;
		if (RECURRING_ITEMS.has(item)) kept.push(item);
		else {
			cleared.push(item);
			rowsToDelete.push(r);
		}
	}
	// Bottom-up so earlier deletions don't shift later indices.
	for (const r of [...rowsToDelete].sort((a, b) => b - a)) {
		requests.push({
			deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: r - 1, endIndex: r } },
		});
	}
	await client.batchUpdate(requests);

	// Deleting referenced rows leaves #REF! inside the hand-picked category sums — scrub them.
	if (rowsToDelete.length > 0) {
		const after = await client.readRange(`${quoteTab(newTab)}!${GRID_READ}`, "FORMULA");
		const fixes: object[] = [];
		for (const label of Object.values(CATEGORIES)) {
			const r = findRowByValue(after.values, 4, label);
			if (r === null) continue;
			const formula = String(after.values[r - 1]?.[5] ?? "");
			if (formula.includes("#REF!")) {
				fixes.push({
					updateCells: {
						start: { sheetId, rowIndex: r - 1, columnIndex: 5 },
						rows: [{ values: [cellData(stripRefErrors(formula))] }],
						fields: "userEnteredValue",
					},
				});
			}
		}
		if (fixes.length > 0) await client.batchUpdate(fixes);
	}

	return { tab: newTab, duplicatedFrom: prevTab, kept, cleared };
}

export interface TripEntryParams {
	tab: string;
	category: string;
	date: string;
	shop: string;
	item: string;
	paymentMethod: string;
	jpy: number;
}

export async function addTripEntry(client: SheetsClient, p: TripEntryParams) {
	const { values } = await client.readRange(`${quoteTab(p.tab)}!A1:AL200`, "FORMULA");

	const categoryRow = values[TRIP_CATEGORY_ROW - 1] ?? [];
	let startCol = -1;
	for (let c = 0; c < categoryRow.length; c++) {
		if (String(categoryRow[c] ?? "").trim() === p.category) {
			startCol = c;
			break;
		}
	}
	if (startCol === -1) {
		const blocks = categoryRow.map((v) => String(v ?? "").trim()).filter(Boolean);
		throw new Error(
			`Category block "${p.category}" not found in row ${TRIP_CATEGORY_ROW} of ${p.tab}. Blocks present: ${blocks.join(", ")}`,
		);
	}

	let targetRow = values.length + 1;
	let lastDataRow = -1;
	for (let r = TRIP_CATEGORY_ROW + 1; r <= values.length + 1; r++) {
		const block = (values[r - 1] ?? []).slice(startCol, startCol + 7);
		if (block.some((c) => c !== "" && c != null)) {
			lastDataRow = r;
		} else {
			targetRow = r;
			break;
		}
	}

	const jpyCol = colLetter(startCol + 4);
	const twdCol = colLetter(startCol + 5);
	let twdFormula = `=${jpyCol}${targetRow}*0.22`;
	let roundFormula = `=CEILING(${twdCol}${targetRow})`;
	if (lastDataRow > TRIP_CATEGORY_ROW) {
		const prevRow = values[lastDataRow - 1] ?? [];
		const prevTwd = String(prevRow[startCol + 5] ?? "");
		const prevRound = String(prevRow[startCol + 6] ?? "");
		if (prevTwd.startsWith("=")) twdFormula = adaptRowFormula(prevTwd, lastDataRow, targetRow);
		if (prevRound.startsWith("=")) roundFormula = adaptRowFormula(prevRound, lastDataRow, targetRow);
	}

	const range = `${quoteTab(p.tab)}!${colLetter(startCol)}${targetRow}:${colLetter(startCol + 6)}${targetRow}`;
	const result = await client.updateRange(range, [
		[p.date, p.shop, p.item, p.paymentMethod, p.jpy, twdFormula, roundFormula],
	]);
	return { tab: p.tab, category: p.category, row: targetRow, updatedRange: result.updatedRange };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test && bun run type-check`
Expected: 45 tests PASS; type-check exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: startMonth and addTripEntry ops"
```

---

### Task 6: Register the tailored tools

**Files:**
- Modify: `src/tools.ts` (add `registerTailoredTools`, extend `read_range` with `mode`)
- Modify: `src/index.ts` (one line: call `registerTailoredTools`)
- Modify: `README.md` (tools list)

**Interfaces:**
- Consumes: everything from Tasks 1–5; existing `ok`/`toError` helpers and `registerFinanceTools` in `src/tools.ts`.
- Produces: `registerTailoredTools(server: McpServer, client: SheetsClient): void`.

- [ ] **Step 1: Extend `read_range` with the `mode` parameter**

In `src/tools.ts`, replace the existing `read_range` registration with:

```ts
	server.tool(
		"read_range",
		"Read cell values from the spreadsheet using A1 notation (e.g. 'Transactions!A1:F200', or just a tab name for the whole tab). mode 'raw' returns unformatted numbers (use it for math — default 'formatted' returns locale strings like \"13,603.67\"); mode 'formulas' returns cell formulas. Large results are truncated; the response says so via `truncated: true` — narrow the range to see the rest.",
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
				return ok(await client.readRange(range, render[mode ?? "formatted"]));
			} catch (e) {
				return toError(e);
			}
		},
	);
```

- [ ] **Step 2: Add `registerTailoredTools` to `src/tools.ts`**

Add imports at the top:

```ts
import { CATEGORIES, CONVENTIONS_TEXT, DEFAULT_CATEGORY } from "./conventions";
import { addExpense, addTripEntry, monthSummary, startMonth } from "./finance-ops";
```

Append the function:

```ts
const monthParam = z.number().int().min(1).max(12);

export function registerTailoredTools(server: McpServer, client: SheetsClient): void {
	server.tool(
		"add_expense",
		"Log an expense into a monthly tab (defaults to the current month). Writes into the expense window so 花費總額 picks it up, converts USD via GOOGLEFINANCE, and adds the entry to the chosen category's sum formula. Use this instead of append_rows/update_range for monthly expenses.",
		{
			item: z.string().min(1).describe("Expense name, e.g. 晚餐 or Netflix"),
			amount: z.number().describe("The amount, in the given currency"),
			currency: z.enum(["TWD", "USD"]),
			category: z
				.enum(Object.keys(CATEGORIES) as [string, ...string[]])
				.optional()
				.describe(`Which summary category to add it to (default ${DEFAULT_CATEGORY})`),
			month: monthParam.optional().describe("Target month 1-12 (default: current month)"),
		},
		async (p) => {
			try {
				return ok(await addExpense(client, p));
			} catch (e) {
				return toError(e);
			}
		},
	);

	server.tool(
		"month_summary",
		"Get a month's numbers as clean JSON (unformatted): 花費總額, 上月透支, category totals, 薪水, 沛還, 剩餘, 美金支付. Defaults to the current month. Fields the sheet doesn't have yet come back null.",
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
		"start_month",
		"Open a new month: duplicates the previous month's tab (keeping all formulas and recurring items like subscriptions), rewires 上月透支 to the month just ended, and clears one-off expenses. Refuses if the tab already exists.",
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
		"Log a purchase into a trip tab (e.g. 2026/07/25 京都東京). Finds the category block (模型, 書, ...), appends to its first empty row, and fills the ¥→TWD conversion columns following the block's existing formulas.",
		{
			tab: z.string().min(1).describe("Trip tab name, exactly as it appears"),
			category: z.string().min(1).describe("Block title in row 2, e.g. 模型 or 書"),
			date: z.string().min(1).describe("Date/time as you write it, e.g. 10/08 16:03"),
			shop: z.string().describe("Store name"),
			item: z.string().min(1).describe("What was bought"),
			payment_method: z.string().describe("e.g. Suica, 現金, 信用卡"),
			jpy: z.number().describe("Price in Japanese yen"),
		},
		async ({ tab, category, date, shop, item, payment_method, jpy }) => {
			try {
				return ok(await addTripEntry(client, { tab, category, date, shop, item, paymentMethod: payment_method, jpy }));
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
}
```

- [ ] **Step 3: Wire it in `src/index.ts`**

Add to the imports: `import { registerFinanceTools, registerTailoredTools } from "./tools";` (replacing the existing tools import) and in `init()` directly after `registerFinanceTools(this.server, client);` add:

```ts
		registerTailoredTools(this.server, client);
```

- [ ] **Step 4: Update `README.md`**

In the tools list, add one line per new tool (same style as the existing five): `add_expense`, `month_summary`, `start_month`, `add_trip_entry`, `get_sheet_conventions`, `insert_rows`, and note `read_range`'s new `mode` parameter.

- [ ] **Step 5: Verify**

Run: `bun run test && bun run type-check`
Expected: 45 tests PASS; type-check exit 0 (the tools layer is thin glue over the tested ops — the gate for tool wiring is Task 7's integration pass).

- [ ] **Step 6: Commit**

```bash
git add src/tools.ts src/index.ts README.md
git commit -m "feat: register tailored finance tools and read_range modes"
```

---

### Task 7: Local integration against the copy sheet

Manual verification with MCP Inspector. `.dev.vars` already points `SPREADSHEET_ID` at the copy sheet and holds the dev GitHub OAuth app.

- [ ] **Step 1: Start dev server + Inspector**

```bash
bun run dev          # http://localhost:8788
bunx @modelcontextprotocol/inspector   # second terminal
```

Connect: Streamable HTTP → `http://localhost:8788/mcp` → OAuth as `niuee`.
Expected: 11 tools listed.

- [ ] **Step 2: Exercise the new tools** (verify each in the copy sheet in the browser)

1. `get_sheet_conventions` → returns the conventions text.
2. `month_summary` `{month: 9}` → numbers match the copy sheet's 9 月 (花費總額, categories, 剩餘 as real numbers).
3. `read_range` `{range: "9 月!C25", mode: "raw"}` → a number, not a string; `mode: "formulas"` → the SUM formula.
4. `add_expense` `{item: "整合測試", amount: 123, currency: "TWD", month: 9}` → row lands in an empty window row; 花費總額 increases by 123; 本月額外雜支 formula now includes the new cell.
5. `add_expense` `{item: "USD 測試", amount: 10, currency: "USD", category: "訂閱費", month: 9}` → B has 10, C has the GOOGLEFINANCE formula and computes; 訂閱費 includes it.
6. `start_month` `{month: 10}` → new tab `10 月` first in tab order; recurring items kept; one-offs (incl. the two test expenses) gone; `上月透支` references `'9 月'`; no `#REF!` anywhere in E-F block. Run `start_month` `{month: 10}` again → error "already exists".
7. `add_trip_entry` `{tab: "2026/07/25 京都東京", category: "書", date: "07/02", shop: "測試", item: "整合測試書", payment_method: "Suica", jpy: 500}` → lands in the 書 block's first empty row with working conversion formulas.
8. `insert_rows` `{tab: "10 月", row: 5, count: 1}` → row appears, formulas below shift correctly.
9. Error paths: `add_expense` with `month: 2` (no 2 月 tab) → tool error naming the tab; `add_trip_entry` with `category: "不存在"` → error listing the real blocks.

- [ ] **Step 3: Clean up the copy sheet**

Delete the `10 月` test tab, the trip test row, and any leftover test expenses (in the browser).

- [ ] **Step 4: Commit any fixes found**

```bash
git add -A && git commit -m "fix: issues found during v2 integration testing"
```

---

### Task 8: Ship + acceptance

- [ ] **Step 1: Push (CI runs tests, Workers Builds deploys)**

```bash
git push
```

Watch: GitHub Actions run goes green; Cloudflare dashboard → sheets-mcp → Build shows a successful deploy. (If Workers Builds isn't connected yet, deploy manually: `bun run deploy`.)

- [ ] **Step 2: Acceptance in Claude web (real sheet)**

Toggle the connector off/on (or start a new chat) so Claude refetches the tool list, then:

1. "我今天晚餐花了 250" → Claude calls `add_expense`; verify the row and the 本月額外雜支 formula in the real current-month tab.
2. "How am I doing this month?" → Claude calls `month_summary` and reports real numbers.
3. Verify the entry, then remove the test expense row (and its formula splice) by hand or by asking Claude to fix it with `update_range`.

- [ ] **Step 3: Done**

Use the superpowers:finishing-a-development-branch skill if a branch was used; on main-direct workflow, work is already shipped.
