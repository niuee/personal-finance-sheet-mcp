# Safety Tools (v4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three safety affordances born from a real overwrite incident: `update_range` gains a read-before-write seatbelt (`expect_empty`) and returns `previousValues`; a new `find_cells` tool returns exact A1 addresses; `read_range` responses carry real sheet row numbers.

**Architecture:** Three ops in `src/finance-ops.ts` — pure `annotateRows` (+ `colIndex` inverse of `colLetter`), `safeUpdateRange` (read → optional emptiness check → write → previous values), `findCells` (tab sweep with cap/truncation flags) — wired in `src/tools.ts`. `SheetsClient` unchanged.

**Tech Stack:** Existing stack (TypeScript, Workers, vitest, bun). Branch: `safety-tools`.

**Spec:** `docs/superpowers/specs/2026-07-02-safety-tools-v4-design.md`

## Global Constraints

- Use bun, not npm: `bun run test`, `bun run type-check`.
- `SheetsClient` and all existing internal ops (month/trip logic) unchanged — this is ops + tool-layer work only.
- Fail-closed: `expect_empty` violations name the occupied cells (A1 + value) and write NOTHING; truncated reads refuse before writing; `find_cells` never silently drops matches (cap and per-tab read truncation both set `truncated: true`).
- `expect_empty` defaults to `false`. `find_cells` cap is 50, `match` defaults to `"contains"` (case-insensitive); `"exact"` is trimmed, case-sensitive.
- Suite currently 68 tests; existing tests must pass unchanged.
- 1-indexed rows everywhere in outputs.
- Commit per task on `safety-tools`; push only at the final ship step (main auto-deploys via Workers Builds now).

---

### Task 1: `annotateRows`, `colIndex`, `safeUpdateRange`

**Files:**
- Modify: `src/finance-ops.ts` (append), `test/finance-ops.test.ts` (append)

**Interfaces:**
- Consumes: `SheetsClient.readRange(range, renderOption)`, `.updateRange(range, values)`; existing `colLetter`.
- Produces (exact signatures Task 3 wires):

```ts
export interface AnnotatedRows {
	startRow: number;
	rows: Array<{ row: number; values: unknown[] }>;
}
export function annotateRows(range: string, values: unknown[][]): AnnotatedRows
export function colIndex(letter: string): number   // "A"→0, "I"→8, "AA"→26
export function safeUpdateRange(client: SheetsClient, range: string, values: unknown[][], expectEmpty?: boolean):
	Promise<{ updatedRange: string; updatedCells: number; previousValues: AnnotatedRows }>
```

- [ ] **Step 1: Write the failing tests**

Append to `test/finance-ops.test.ts` (extend the finance-ops import with `annotateRows`, `colIndex`, `safeUpdateRange`):

```ts
describe("annotateRows", () => {
	it("derives the start row from the echoed range and numbers rows", () => {
		const result = annotateRows("'9 月'!A3:F60", [["a"], [], ["c", 5]]);
		expect(result).toEqual({
			startRow: 3,
			rows: [
				{ row: 3, values: ["a"] },
				{ row: 5, values: ["c", 5] },
			],
		});
	});

	it("defaults to row 1 for bare tab names and column-only ranges", () => {
		expect(annotateRows("Transactions", [["x"]]).startRow).toBe(1);
		expect(annotateRows("'9 月'!A:F", [["x"]]).startRow).toBe(1);
	});

	it("omits rows whose cells are all empty", () => {
		const result = annotateRows("'T'!B10:D12", [["", "", ""], ["v"]]);
		expect(result.rows).toEqual([{ row: 11, values: ["v"] }]);
	});
});

describe("colIndex", () => {
	it("inverts colLetter", () => {
		expect(colIndex("A")).toBe(0);
		expect(colIndex("I")).toBe(8);
		expect(colIndex("Z")).toBe(25);
		expect(colIndex("AA")).toBe(26);
		expect(colIndex("AF")).toBe(31);
	});
});

describe("safeUpdateRange", () => {
	function updateClient(readResult: { range: string; values: unknown[][]; truncated?: boolean }): SheetsClient {
		return {
			readRange: vi.fn(async () => ({ truncated: false, ...readResult })),
			updateRange: vi.fn(async () => ({ updatedRange: readResult.range, updatedCells: 3 })),
		} as unknown as SheetsClient;
	}

	it("returns the previous values, row-annotated with formulas", async () => {
		const client = updateClient({ range: "'京都'!Q29:W29", values: [["Haruka", "", "=U29*0.22"]] });

		const result = await safeUpdateRange(client, "'京都'!Q29:W29", [["new", "", 1]]);

		expect((client.readRange as any).mock.calls[0]).toEqual(["'京都'!Q29:W29", "FORMULA"]);
		expect((client.updateRange as any).mock.calls[0]).toEqual(["'京都'!Q29:W29", [["new", "", 1]]]);
		expect(result).toEqual({
			updatedRange: "'京都'!Q29:W29",
			updatedCells: 3,
			previousValues: { startRow: 29, rows: [{ row: 29, values: ["Haruka", "", "=U29*0.22"] }] },
		});
	});

	it("expect_empty refuses when any target cell is occupied, naming the cells", async () => {
		const client = updateClient({ range: "'京都'!Q29:W29", values: [["Haruka", "", "=U29*0.22"]] });

		const promise = safeUpdateRange(client, "'京都'!Q29:W29", [["x"]], true);
		await expect(promise).rejects.toThrow("Q29=Haruka");
		await expect(promise).rejects.toThrow("S29==U29*0.22");
		expect((client.updateRange as any).mock.calls.length).toBe(0);
	});

	it("expect_empty writes when the target is genuinely empty", async () => {
		const client = updateClient({ range: "'京都'!Q30:W30", values: [] });

		const result = await safeUpdateRange(client, "'京都'!Q30:W30", [["x"]], true);

		expect((client.updateRange as any).mock.calls.length).toBe(1);
		expect(result.previousValues).toEqual({ startRow: 30, rows: [] });
	});

	it("refuses when the pre-write read was truncated", async () => {
		const client = updateClient({ range: "'T'!A1:Z999", values: [["x"]], truncated: true });

		await expect(safeUpdateRange(client, "'T'!A1:Z999", [["y"]])).rejects.toThrow("truncated");
		expect((client.updateRange as any).mock.calls.length).toBe(0);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `annotateRows`/`colIndex`/`safeUpdateRange` not exported; existing 68 pass.

- [ ] **Step 3: Implement in `src/finance-ops.ts`** (append)

```ts
export interface AnnotatedRows {
	startRow: number;
	rows: Array<{ row: number; values: unknown[] }>;
}

/** Row-number a values grid using the A1 range the API echoed ("'9 月'!A3:F60" → startRow 3). Empty rows are omitted. */
export function annotateRows(range: string, values: unknown[][]): AnnotatedRows {
	const m = range.match(/![A-Z]*(\d+)/);
	const startRow = m ? Number(m[1]) : 1;
	const rows: Array<{ row: number; values: unknown[] }> = [];
	for (let i = 0; i < values.length; i++) {
		const row = values[i] ?? [];
		if (row.some((c) => c !== "" && c != null)) {
			rows.push({ row: startRow + i, values: row });
		}
	}
	return { startRow, rows };
}

/** "A" → 0, "I" → 8, "AA" → 26 — the inverse of colLetter. */
export function colIndex(letter: string): number {
	let n = 0;
	for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n - 1;
}

/**
 * update_range with a seatbelt: reads the target first (the read IS the
 * safety mechanism — two calls, deliberately not atomic), optionally refuses
 * non-empty targets, and always returns what was there before the write.
 */
export async function safeUpdateRange(
	client: SheetsClient,
	range: string,
	values: unknown[][],
	expectEmpty = false,
): Promise<{ updatedRange: string; updatedCells: number; previousValues: AnnotatedRows }> {
	const before = await client.readRange(range, "FORMULA");
	if (before.truncated) {
		throw new Error(`Refusing to write: reading ${range} back was truncated, so its current contents cannot be verified.`);
	}
	const echoed = before.range || range;
	const previousValues = annotateRows(echoed, before.values);

	if (expectEmpty) {
		const colMatch = echoed.match(/!([A-Z]+)\d*/);
		const startCol = colMatch ? colIndex(colMatch[1]) : 0;
		const occupied: string[] = [];
		for (const r of previousValues.rows) {
			r.values.forEach((c, j) => {
				if (c !== "" && c != null) {
					occupied.push(`${colLetter(startCol + j)}${r.row}=${String(c).slice(0, 40)}`);
				}
			});
		}
		if (occupied.length > 0) {
			const listed = occupied.slice(0, 10).join(", ");
			const more = occupied.length > 10 ? ` (+${occupied.length - 10} more)` : "";
			throw new Error(
				`expect_empty: target range ${range} is not empty — refusing to overwrite. Occupied: ${listed}${more}`,
			);
		}
	}

	const result = await client.updateRange(range, values);
	return { ...result, previousValues };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test && bun run type-check`
Expected: 76 tests PASS (68 + 8 new); type-check exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: annotateRows and safeUpdateRange with expect_empty seatbelt"
```

---

### Task 2: `findCells`

**Files:**
- Modify: `src/finance-ops.ts` (append), `test/finance-ops.test.ts` (append)

**Interfaces:**
- Consumes: `SheetsClient.readRange` (default FORMATTED render), `.listTabs()`; `colLetter`, `quoteTab`.
- Produces: `findCells(client, { query, tab?, match? }): Promise<{ matches: Array<{ tab, cell, row, column, value }>; truncated: boolean }>`; exported `FIND_CELLS_CAP = 50`.

- [ ] **Step 1: Write the failing tests**

Append (add `findCells`, `FIND_CELLS_CAP` to the import):

```ts
describe("findCells", () => {
	function searchClient(tabGrids: Record<string, unknown[][]>): SheetsClient {
		return {
			listTabs: vi.fn(async () =>
				Object.keys(tabGrids).map((title) => ({ title, rowCount: 100, columnCount: 26 })),
			),
			readRange: vi.fn(async (range: string) => {
				const title = range.replace(/^'|'$/g, "").replace(/''/g, "'");
				return { range, values: tabGrids[title] ?? [], truncated: false };
			}),
		} as unknown as SheetsClient;
	}

	it("finds cells by case-insensitive substring with exact addresses", async () => {
		const client = searchClient({
			京都: [[], ["", "", "", "haruka 特急"], ["Haruka"]],
		});

		const result = await findCells(client, { query: "HARUKA", tab: "京都" });

		expect(result).toEqual({
			matches: [
				{ tab: "京都", cell: "D2", row: 2, column: "D", value: "haruka 特急" },
				{ tab: "京都", cell: "A3", row: 3, column: "A", value: "Haruka" },
			],
			truncated: false,
		});
		expect((client.readRange as any).mock.calls[0][0]).toBe("'京都'");
	});

	it("exact match trims and is case-sensitive", async () => {
		const client = searchClient({
			T: [["Haruka ", "haruka", "the Haruka train"]],
		});

		const result = await findCells(client, { query: "Haruka", tab: "T", match: "exact" });

		expect(result.matches).toEqual([{ tab: "T", cell: "A1", row: 1, column: "A", value: "Haruka " }]);
	});

	it("sweeps every tab when tab is omitted", async () => {
		const client = searchClient({
			"9 月": [["Netflix"]],
			京都: [["", "Netflix Store"]],
		});

		const result = await findCells(client, { query: "netflix" });

		expect(result.matches.map((m) => `${m.tab}!${m.cell}`)).toEqual(["9 月!A1", "京都!B1"]);
	});

	it("caps at FIND_CELLS_CAP and flags truncation", async () => {
		const grid = Array.from({ length: FIND_CELLS_CAP + 5 }, () => ["hit"]);
		const client = searchClient({ T: grid });

		const result = await findCells(client, { query: "hit", tab: "T" });

		expect(result.matches).toHaveLength(FIND_CELLS_CAP);
		expect(result.truncated).toBe(true);
	});

	it("flags truncation when a tab read was cut off", async () => {
		const client = {
			readRange: vi.fn(async (range: string) => ({ range, values: [["x"]], truncated: true })),
		} as unknown as SheetsClient;

		const result = await findCells(client, { query: "zzz", tab: "T" });

		expect(result.matches).toEqual([]);
		expect(result.truncated).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `findCells` not exported.

- [ ] **Step 3: Implement in `src/finance-ops.ts`** (append)

```ts
export const FIND_CELLS_CAP = 50;

export interface FindCellsParams {
	query: string;
	tab?: string;
	match?: "contains" | "exact";
}

/** Find cells by text and return exact A1 addresses — the alternative to reading big ranges and counting rows. */
export async function findCells(client: SheetsClient, p: FindCellsParams) {
	const mode = p.match ?? "contains";
	const needle = mode === "contains" ? p.query.toLowerCase() : p.query.trim();
	const tabs = p.tab !== undefined ? [p.tab] : (await client.listTabs()).map((t) => t.title);

	const matches: Array<{ tab: string; cell: string; row: number; column: string; value: string }> = [];
	let truncated = false;
	outer: for (const tab of tabs) {
		const { values, truncated: readTruncated } = await client.readRange(quoteTab(tab));
		if (readTruncated) truncated = true;
		for (let i = 0; i < values.length; i++) {
			const row = values[i] ?? [];
			for (let j = 0; j < row.length; j++) {
				const raw = String(row[j] ?? "");
				if (raw === "") continue;
				const hit = mode === "contains" ? raw.toLowerCase().includes(needle) : raw.trim() === needle;
				if (!hit) continue;
				if (matches.length >= FIND_CELLS_CAP) {
					truncated = true;
					break outer;
				}
				matches.push({ tab, cell: `${colLetter(j)}${i + 1}`, row: i + 1, column: colLetter(j), value: raw });
			}
		}
	}
	return { matches, truncated };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test && bun run type-check`
Expected: 81 tests PASS (76 + 5); type-check exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: findCells text search returning exact A1 addresses"
```

---

### Task 3: Tool wiring + README

**Files:**
- Modify: `src/tools.ts`, `README.md`

**Interfaces:**
- Consumes: `annotateRows`, `safeUpdateRange`, `findCells` (Tasks 1–2).

- [ ] **Step 1: `read_range` returns annotated rows**

In `src/tools.ts`, add `annotateRows, findCells, safeUpdateRange` to the finance-ops import. Replace the `read_range` handler body (schema unchanged except description):

```ts
	server.tool(
		"read_range",
		"Read cell values using A1 notation (e.g. 'Transactions!A1:F200', or a tab name for the whole tab). Every returned row carries its REAL sheet row number (empty rows are omitted) — use those numbers directly, never count rows yourself. mode 'raw' returns unformatted numbers for math; 'formulas' returns cell formulas. truncated:true means narrow the range to see the rest.",
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
				const r = await client.readRange(range, render[mode ?? "formatted"]);
				const { startRow, rows } = annotateRows(r.range, r.values);
				return ok({ range: r.range, startRow, rows, truncated: r.truncated });
			} catch (e) {
				return toError(e);
			}
		},
	);
```

- [ ] **Step 2: `update_range` gains the seatbelt**

Replace the `update_range` registration:

```ts
	server.tool(
		"update_range",
		"OVERWRITE the cells in a range with new values. This destroys the existing contents — pass expect_empty:true whenever you believe the target is empty (it refuses if anything is there), and read the range first when editing existing cells. The response includes previousValues (what was overwritten, with formulas) so any mistake can be reverted. To clear a cell, write an empty string \"\" — a null cell value leaves the existing cell unchanged.",
		{
			range: z.string().min(1).describe("A1 notation range to overwrite, e.g. Transactions!B7"),
			values: rowsSchema.describe("Replacement values; outer array = rows, inner = cells"),
			expect_empty: z
				.boolean()
				.optional()
				.describe("true = refuse to write if ANY target cell is currently non-empty (use for append-like writes)"),
		},
		async ({ range, values, expect_empty }) => {
			try {
				return ok(await safeUpdateRange(client, range, values, expect_empty ?? false));
			} catch (e) {
				return toError(e);
			}
		},
	);
```

- [ ] **Step 3: Register `find_cells`** (in `registerTailoredTools`, after `insert_rows`)

```ts
	server.tool(
		"find_cells",
		"Find cells containing a text and get their exact A1 addresses — use this instead of reading big ranges and counting rows. Searches one tab, or every tab if tab is omitted. Returns at most 50 matches; truncated:true means there may be more (narrow the query or name a tab).",
		{
			query: z.string().min(1).describe("Text to look for, e.g. Haruka or 交通"),
			tab: z.string().optional().describe("Tab to search; omit to search all tabs"),
			match: z
				.enum(["contains", "exact"])
				.optional()
				.describe("contains (default, case-insensitive substring) or exact (trimmed, case-sensitive)"),
		},
		async ({ query, tab, match }) => {
			try {
				return ok(await findCells(client, { query, tab, match }));
			} catch (e) {
				return toError(e);
			}
		},
	);
```

- [ ] **Step 4: README** — add a `find_cells` bullet, note `read_range`'s numbered rows and `update_range`'s `expect_empty`/`previousValues` (tool count is now 12).

- [ ] **Step 5: Verify**

Run: `bun run test && bun run type-check`
Expected: 81 tests PASS; exit 0 (tool layer is glue over the tested ops; the gate is Task 4's integration).

- [ ] **Step 6: Commit**

```bash
git add src/tools.ts README.md
git commit -m "feat: find_cells tool, numbered read_range rows, update_range seatbelt"
```

---

### Task 4: Integration, final review, ship

- [ ] **Step 1: Scripted integration against the COPY sheet** (service account, no OAuth needed):
1. `findCells` for a known trip-tab string (e.g. "Haruka") → exact address matches reality; sweep-all-tabs works.
2. `safeUpdateRange` with `expectEmpty: true` against an occupied cell → refusal naming the cell; against an empty cell → writes and `previousValues.rows` is empty; then restore by writing `[""]` back.
3. `read_range`-equivalent: `annotateRows` output row numbers match the sheet.
4. Clean up any test writes.

- [ ] **Step 2: Whole-branch review** (most capable model) → fix loop if needed.

- [ ] **Step 3: Ship**: merge `safety-tools` → `main`, `bun run test` on main, push — Workers Builds auto-deploys; watch for the new version, then toggle the Claude web connector. Acceptance: "find the Haruka row in the trip tab" resolves in one `find_cells` call.
