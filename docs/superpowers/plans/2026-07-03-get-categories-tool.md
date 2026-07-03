# get_categories Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new read-only MCP tool `get_categories` that returns the live 類別 tag list from the dropdown (data validation) on a monthly tab's 類別 column.

**Architecture:** Three thin layers, matching the existing codebase: a raw Sheets-API method on `SheetsClient` (`getDataValidation`), a convention-aware op in `finance-ops.ts` (`getCategories`), and a tool registration in `tools.ts`. The client probes cells C3:C15 of the month tab with one field-limited `spreadsheets.get` call and returns the first validation rule found; the op turns that rule into a category list (following the referenced range for `ONE_OF_RANGE` rules).

**Tech Stack:** TypeScript on Cloudflare Workers, Google Sheets REST API v4, `@modelcontextprotocol/sdk`, zod, vitest. Package manager is **bun** (`bun run test`, `bun run type-check`).

**Spec:** `docs/superpowers/specs/2026-07-03-get-categories-tool-design.md`

## Global Constraints

- Read-only: `add_expense` behavior is unchanged except for its `tag` param description text.
- `KNOWN_TAGS` in conventions.ts stays as-is (documentation/fallback).
- No-rule error message exactly: `No data validation found on the 類別 column of "{tab}" — the tab may predate the 類別 dropdown.`
- Run tests with `bun run test`, types with `bun run type-check`.
- Commit messages follow the repo's `feat:` / `docs:` convention and end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `SheetsClient.getDataValidation`

**Files:**
- Modify: `src/sheets-client.ts` (add method after `readRange`, near line 71)
- Test: `test/sheets-client.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: existing `private request(path)` and `private quoteTab(tab)` on `SheetsClient`.
- Produces (Task 2 relies on this exact signature):
  ```ts
  getDataValidation(tab: string, startRow: number, endRow: number, col: string):
    Promise<{ type: string; values: string[] } | null>
  ```
  For `ONE_OF_LIST`, `values` are the dropdown entries in sheet order. For `ONE_OF_RANGE`, `values` is a one-element array holding the referenced range string exactly as the API returns it (e.g. `=Settings!A1:A20`). `null` when no cell in the window carries a rule.

- [ ] **Step 1: Write the failing tests**

Append to `test/sheets-client.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test test/sheets-client.test.ts`
Expected: the 4 new tests FAIL with `getDataValidation is not a function`; all pre-existing tests PASS.

- [ ] **Step 3: Implement `getDataValidation`**

In `src/sheets-client.ts`, add after the `quoteTab` method (so it can use it):

```ts
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
```

Note: `quoteTab` is currently declared below `appendRows`; adding the new method anywhere after it is fine — placement next to `quoteTab` keeps the A1-building code together.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test test/sheets-client.test.ts`
Expected: PASS (all, including the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/sheets-client.ts test/sheets-client.test.ts
git commit -m "feat: SheetsClient.getDataValidation reads a column's dropdown rule

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `getCategories` op in finance-ops

**Files:**
- Modify: `src/finance-ops.ts` (add the op after `monthSummary`, near line 285)
- Test: `test/finance-ops.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes:
  - `SheetsClient.getDataValidation(tab, startRow, endRow, col)` from Task 1 (signature above).
  - `SheetsClient.readRange(range)` (existing).
  - `monthTabName`, `currentMonthTab`, `MONTH_COLS` from `./conventions`; `colLetter` (already exported in finance-ops.ts, line 85).
- Produces (Task 3 relies on this exact signature):
  ```ts
  getCategories(client: SheetsClient, month?: number):
    Promise<{ tab: string; categories: string[]; source: "ONE_OF_LIST" | "ONE_OF_RANGE" }>
  ```

- [ ] **Step 1: Write the failing tests**

Append to `test/finance-ops.test.ts` (add `getCategories` to the existing `../src/finance-ops` import at the top of the file):

```ts
describe("getCategories", () => {
	function validationClient(rule: { type: string; values: string[] } | null, rangeValues?: unknown[][]) {
		return {
			getDataValidation: vi.fn(async () => rule),
			readRange: vi.fn(async () => ({ range: "x", values: rangeValues ?? [], truncated: false })),
		} as unknown as SheetsClient;
	}

	it("returns deduped ONE_OF_LIST values from the 類別 column probe", async () => {
		const client = validationClient({
			type: "ONE_OF_LIST",
			values: ["訂閱", "吃喝", "交通", "吃喝"],
		});

		const result = await getCategories(client, 7);

		expect((client.getDataValidation as any).mock.calls[0]).toEqual(["7 月", 3, 15, "C"]);
		expect(result).toEqual({ tab: "7 月", categories: ["訂閱", "吃喝", "交通"], source: "ONE_OF_LIST" });
		expect(client.readRange).not.toHaveBeenCalled();
	});

	it("follows a ONE_OF_RANGE rule and flattens non-empty string cells", async () => {
		const client = validationClient({ type: "ONE_OF_RANGE", values: ["=Settings!A1:A20"] }, [
			["訂閱"],
			["吃喝"],
			[""],
			["吃喝"],
			[42],
			["生活用品"],
		]);

		const result = await getCategories(client, 7);

		expect((client.readRange as any).mock.calls[0]).toEqual(["Settings!A1:A20"]);
		expect(result).toEqual({
			tab: "7 月",
			categories: ["訂閱", "吃喝", "生活用品"],
			source: "ONE_OF_RANGE",
		});
	});

	it("throws a tab-naming error when no rule exists", async () => {
		const client = validationClient(null);

		await expect(getCategories(client, 6)).rejects.toThrow(
			'No data validation found on the 類別 column of "6 月" — the tab may predate the 類別 dropdown.',
		);
	});

	it("throws on a rule type that is not a dropdown", async () => {
		const client = validationClient({ type: "NUMBER_GREATER", values: ["0"] });

		await expect(getCategories(client, 7)).rejects.toThrow(
			'類別 column validation on "7 月" is NUMBER_GREATER, not a dropdown list.',
		);
	});

	it("defaults to the current Taipei month when month is omitted", async () => {
		const client = validationClient({ type: "ONE_OF_LIST", values: ["訂閱"] });

		const result = await getCategories(client);

		expect(result.tab).toBe(currentMonthTab());
	});
});
```

Also add `currentMonthTab` to the `../src/conventions` import in the test file if it is not already imported.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test test/finance-ops.test.ts`
Expected: the 5 new tests FAIL (`getCategories` not exported); all pre-existing tests PASS.

- [ ] **Step 3: Implement `getCategories`**

In `src/finance-ops.ts`, add after `monthSummary` (the function ending near line 285):

```ts
/** Probe window for the 類別 dropdown: row 3 is 上月透支, so scan a few rows deep. */
const TAG_VALIDATION_ROWS = { start: 3, end: 15 } as const;

/** The live 類別 tag list, read from the dropdown (data validation) on a monthly tab's 類別 column. */
export async function getCategories(client: SheetsClient, month?: number) {
	const tab = month !== undefined ? monthTabName(month) : currentMonthTab();
	const rule = await client.getDataValidation(
		tab,
		TAG_VALIDATION_ROWS.start,
		TAG_VALIDATION_ROWS.end,
		colLetter(MONTH_COLS.tag),
	);
	if (!rule) {
		throw new Error(
			`No data validation found on the 類別 column of "${tab}" — the tab may predate the 類別 dropdown.`,
		);
	}
	if (rule.type === "ONE_OF_LIST") {
		return { tab, categories: [...new Set(rule.values)], source: "ONE_OF_LIST" as const };
	}
	if (rule.type === "ONE_OF_RANGE") {
		const range = (rule.values[0] ?? "").replace(/^=/, "");
		const { values } = await client.readRange(range);
		const categories = [
			...new Set(
				values.flat().filter((v): v is string => typeof v === "string" && v.trim() !== ""),
			),
		];
		return { tab, categories, source: "ONE_OF_RANGE" as const };
	}
	throw new Error(`類別 column validation on "${tab}" is ${rule.type}, not a dropdown list.`);
}
```

`monthTabName`, `currentMonthTab`, and `MONTH_COLS` are already imported from `./conventions` at the top of finance-ops.ts; `colLetter` is defined in this file. No new imports needed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test test/finance-ops.test.ts`
Expected: PASS (all, including the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: getCategories reads the live 類別 list from the column dropdown

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Register the `get_categories` tool

**Files:**
- Modify: `src/tools.ts` (register in `registerTailoredTools`; tweak `add_expense`'s `tag` description)

**Interfaces:**
- Consumes: `getCategories(client, month?)` from Task 2; existing `monthParam`, `ok`, `toError` in tools.ts.
- Produces: MCP tool `get_categories` with optional `month` (1-12). No downstream code consumes it.

There is no test file for tools.ts (registrations are thin wrappers, consistent with every other tool), so this task verifies via type-check plus the full suite.

- [ ] **Step 1: Register the tool**

In `src/tools.ts`:

1. Add `getCategories` to the `./finance-ops` import list (it is alphabetical: between `findCells` and `monthSummary`).
2. In `registerTailoredTools`, after the `month_summary` registration (near line 176), add:

```ts
	server.tool(
		"get_categories",
		"List the canonical 類別 tags from the dropdown (data validation) on a monthly tab's 類別 column. Call this before add_expense when unsure which tag to use. Defaults to the current month.",
		{ month: monthParam.optional().describe("Month 1-12 (default: current month)") },
		async ({ month }) => {
			try {
				return ok(await getCategories(client, month));
			} catch (e) {
				return toError(e);
			}
		},
	);
```

3. Update `add_expense`'s `tag` description (currently near line 139) from:

```ts
					.describe(
						`The row's 類別 tag — usually one of ${KNOWN_TAGS.join(", ")} (free text, new tags allowed). Omit only if none fits.`,
					),
```

to:

```ts
					.describe(
						`The row's 類別 tag — call get_categories for the live dropdown list (typically ${KNOWN_TAGS.join(", ")}). Free text, new tags allowed; omit only if none fits.`,
					),
```

- [ ] **Step 2: Type-check and run the full suite**

Run: `bun run type-check && bun run test`
Expected: tsc clean; all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/tools.ts
git commit -m "feat: get_categories tool exposes the 類別 dropdown list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
