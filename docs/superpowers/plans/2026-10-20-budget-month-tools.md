# Budget-Month Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the monthly MCP tools work on budget-based month tabs, and let `start_month` build those tabs from the "Budget Based" template.

**Architecture:**
- Two new modules hold the budget-month code:
  - `src/budget-layout.ts`: pure finders over a grid.
  - `src/budget-ops.ts`: client-calling operations.
- Every existing monthly op in `src/finance-ops.ts` keeps its first read (`A1:S`). Right after it, the op checks `isBudgetMonth(values)` and either hands off to the budget op, which re-reads the wider `A1:BJ`, or refuses. Old-layout paths are untouched.

**Tech Stack:** TypeScript on Cloudflare Workers, Google Sheets REST API v4 through `SheetsClient`, vitest, bun.

**Spec:** `docs/superpowers/specs/2026-10-19-budget-month-layout-design.md`

## Global Constraints

- **Never a whole-row insert or delete on a budget tab.** Every insert or delete is band-scoped (`insertRange` / `deleteRange` with `shiftDimension: "ROWS"`) to one section's own columns.
- **Never write below a block or below 乾坤大挪移** except into entry rows. Their 總和 formulas are open-ended (`=SUM(X7:X)` style).
- **No live rate.** Conversions on a budget tab reference the 本月匯率 cell (`$C$<rateRow>`). The only `GOOGLEFINANCE` writes are the rate formula itself and `add_transfer`'s existing entry-time pin.
- **Locate everything by its labels**, never by fixed row numbers.
- **Old-layout behavior is unchanged.** Every existing test passes. The one exception is the two `getCategories` readRange assertions that Task 6 updates.
- **Exact strings:**
  - template tab: `Budget Based`
  - DEP tab: `` `${month} 月 DEP` `` (e.g. `11 月 DEP`)
  - title: `` `${month} 月花費` ``
- **Rate formula, exactly:**
  `=IF(TODAY()<=DATE(Y,M,1),GOOGLEFINANCE("CURRENCY:USDTWD"),INDEX(GOOGLEFINANCE("CURRENCY:USDTWD","price",DATE(Y,M,1)),2,2))`
- **Carry formula, exactly (today's shape):** `=IF(-('<prev>'!D<row>) > 0, -('<prev>'!D<row>), 0)`
- **Module cycle:** `budget-ops.ts` and `budget-layout.ts` import helpers from `finance-ops.ts`, and `finance-ops.ts` imports `budget-ops.ts`. Only `export function` / `export async function` declarations may cross the cycle. Never read an imported `const` at module top level.
- **Checks:** `bun run type-check` and `bun run test` (CI runs `bun install --frozen-lockfile` first).
- **Commits:** every commit message ends with these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015ScjHfgNqjAU9TRqCWmGg7
  ```

## Review Focus

1. **A gap inside a block** (an entry deleted by hand, or a row holding only the pre-typed "TWD"). `add_expense` fills the first gap; it never skips to below the last entry. Tested in Task 1 and Task 2.
2. **The same 項目 in two blocks with no `tag`.** `delete_expense` refuses and names both blocks; it never deletes a guess. Tested in Task 3.
3. **Building a month whose previous tab doesn't exist.** Both carries become `0` and the month is still built. Tested in Task 8.
4. **December → January.** `start_month(1)` run in December locks to `DATE(next year,1,1)`. Tested in Task 1 (`rateYear`) and Task 8.
5. **A truncated wide read.** Refuse before any write. Tested in Task 2.

---

### Task 1: Budget-layout constants, finders and test fixture

**Files:**
- Modify: `src/conventions.ts` (new constants, next to the other label constants)
- Create: `src/budget-layout.ts`
- Create: `test/budget-fixtures.ts`
- Create: `test/budget-layout.test.ts`

**Interfaces:**
- Consumes: `findRowByValue`, `findRowByLabels`, `colLetter` from `src/finance-ops.ts`. `MONTH_COLS`, `MONTH_USD_NET_LABELS`, `DATE_HEADER_LABEL` (`日期`), `INCOME_HEADER_LABEL` (`項目`), `TRANSFER_SECTION_LABEL` (`乾坤大挪移`), `TRANSFER_TOTAL_LABEL` (`總和`) and `SHEET_TIMEZONE` from `src/conventions.ts`.
- Produces, in `src/conventions.ts`:
  ```ts
  export const BUDGET_TEMPLATE_TAB = "Budget Based";
  export const RATE_LABEL = "本月匯率";
  export const BUDGET_SUM_LABEL = "預算總額";
  export const BUDGET_ALLOCATED_LABEL = "編列預算";
  export const BUDGET_BLOCK_TITLE_SUFFIX = "支出";
  export const CURRENCY_HEADER_LABEL = "幣別";
  export const AMOUNT_HEADER_LABEL = "金額";
  export const OVERSPEND_LABEL = "本月超支";
  export const OVERSPEND_NET_LABEL = "本月超支（加上回補）";
  export const TOTAL_SPENDING_LABEL = "總支出";
  export const DEP_SUFFIX = " DEP";
  export const BUDGET_CATEGORY_ALIASES: Readonly<Record<string, string>> = { 午餐: "中餐" };
  ```
- Produces, in `src/budget-layout.ts`:
  ```ts
  export const BUDGET_GRID_READ = "A1:BJ";
  export const RATE_VALUE_COL = 2;        // C
  export const BUDGET_SUM_VALUE_COL = 4;  // E (label 預算總額 in D)
  export interface BudgetBlock { category: string; title: string; startCol: number; budgetRow: number; totalRow: number; headerRow: number }
  // startCol = 日期 column; +1 項目, +2 金額, +3 幣別. budgetRow holds 編列預算 at startCol and 剩餘 at startCol+2.
  // totalRow holds "總和" at startCol+1 and the total at startCol+2.
  export interface BudgetEntry { row: number; date: unknown; item: string; amount: unknown; currency: string }
  export interface BudgetTransferSection { dateCol: number; totalRow: number; headerRow: number }
  // dateCol = 日期; +1 新臺幣, +2 當下美金, +3 實際美金, +4 匯差, +5 手續費, +6 當筆總額外花費.
  export function isBudgetMonth(values: unknown[][]): boolean;
  export function findBudgetBlocks(values: unknown[][], tab: string): BudgetBlock[];
  export function resolveBudgetBlock(blocks: BudgetBlock[], tag: string, tab: string): BudgetBlock;
  export function firstEmptyEntryRow(values: unknown[][], block: BudgetBlock): number;
  export function blockEntries(values: unknown[][], block: BudgetBlock): BudgetEntry[];
  export function findBudgetTransferSection(values: unknown[][], tab: string): BudgetTransferSection;
  export function findBudgetIncomeSumifWindow(values: unknown[][], tab: string): { start: number; end: number };
  export function findRateRow(values: unknown[][], tab: string): number;
  export function rateYear(month: number, now?: Date): number;
  export function rateFormula(year: number, month: number): string;
  ```
- Produces, in `test/budget-fixtures.ts`: `budgetGrid()`, `oldMonthGrid()` and `BLOCK_START` (below). Every later test task uses them.

- [ ] **Step 1: Write the fixture file `test/budget-fixtures.ts`.** It is test data that mirrors the live "Budget Based" tab; reproduce it exactly.

```ts
/** 0-indexed start column of each block in the template, keyed by category. */
export const BLOCK_START = { 中餐: 7, 購物: 12, 吃喝: 17, 生活用品: 22, 訂閱: 27, 交通: 32, 娛樂: 37, 學貸: 42, 其他: 47 } as const;
const TITLES: Record<keyof typeof BLOCK_START, string> = {
	中餐: "午餐支出", 購物: "購物支出", 吃喝: "吃喝支出", 生活用品: "生活用品支出", 訂閱: "訂閱支出",
	交通: "交通支出", 娛樂: "娛樂支出", 學貸: "學貸支出", 其他: "其他支出",
};
const chr = (n: number) => String.fromCharCode(65 + n);
const L = (c: number) => (c < 26 ? chr(c) : chr(Math.floor(c / 26) - 1) + chr(c % 26)); // 0-indexed column → letters (BG = 58)

/** The "Budget Based" template as a FORMULA render (row = index+1), with its starting entries. */
export function budgetGrid(): unknown[][] {
	const g: unknown[][] = [];
	const put = (row: number, col: number, v: unknown) => { (g[row - 1] ??= [])[col] = v; };
	put(1, 0, "11 月花費");
	["日期", "項目", "類別", "美金", "新臺幣", "支付幣別"].forEach((v, c) => put(2, c, v));
	g[2] = ["", "上月美金透支", "透支", "=IF(-('10 月'!D43) > 0, -('10 月'!D43), 0)", "=D3*$C$15", "USD"];
	g[3] = ["", "上月新臺幣透支", "透支", "", "=IF(-('10 月'!D44) > 0, -('10 月'!D44), 0)", "TWD"];
	g[4] = ["", "生活用品預算", "生活用品", "", 31261, "TWD"];
	g[5] = ["", "吃喝預算", "吃喝", "", "=D6*$C$15", "TWD"];
	g[6] = ["", "購物預算", "購物", "", 0, "TWD"];
	g[7] = ["", "訂閱預算", "訂閱", "", 10700, "TWD"];
	g[8] = ["", "訂閱預算", "訂閱", 71.37, "=D9*$C$15", "USD"];
	g[9] = ["", "交通預算", "交通", "", 1000, "TWD"];
	g[10] = ["", "娛樂預算", "娛樂", "", 0, "TWD"];
	g[11] = ["", "學貸預算", "學貸", "=281.43 + 148.5", "=D12*$C$15", "USD"];
	g[12] = ["", "其他預算", "其他", 15, "=D13*$C$15", "USD"];
	g[13] = ["", "中餐預算", "中餐", "", 3900, "TWD"];
	g[14] = ["", "本月匯率", 32.4607, "預算總額", "=SUM(E5:E14)"];
	put(26, 1, "總預算");
	g[26] = ["", "項目", "幣別", "金額"];
	g[27] = ["", "薪水", "TWD", 65271];
	g[28] = ["", "沛還", "USD", 700];
	put(32, 1, "本月美金收支狀況");
	put(32, 3, '=SUMIF(C28:C31,"USD",D28:D31)-D3-(SUMIF(AE7:AE,"USD",AD7:AD))');
	put(33, 1, "本月新臺幣收支狀況");
	put(33, 3, '=SUMIF(C28:C31,"TWD",D28:D31)-E4-SUMIF(F5:F14,"TWD",E5:E14)-BF5');
	put(35, 1, "本月超支");
	put(36, 1, "本月超支（加上回補）");
	put(40, 1, "總支出");
	for (const [cat, c] of Object.entries(BLOCK_START)) {
		put(2, c, TITLES[cat as keyof typeof BLOCK_START]);
		put(3, c, "編列預算");
		put(3, c + 2, "剩餘 (負數會加回去支出）");
		put(4, c, `=SUMIF($B$3:$B$23,"${cat}預算",$E$3:$E$23)`);
		put(4, c + 2, `=${L(c)}4-${L(c + 2)}5`);
		put(5, c + 1, "總和");
		put(5, c + 2, `=SUMIF(${L(c + 3)}7:${L(c + 3)},"<>USD",${L(c + 2)}7:${L(c + 2)})+SUMIF(${L(c + 3)}7:${L(c + 3)},"USD",${L(c + 2)}7:${L(c + 2)})*$C$15`);
		["日期", "項目", "金額", "幣別"].forEach((v, i) => put(6, c + i, v));
		put(7, c + 3, "TWD");
		put(8, c + 3, "TWD");
	}
	const sub = BLOCK_START.訂閱;
	[["ElevenLabs", 6, "USD"], ["iCloud", 9.99, "USD"], ["Google One", 7.99, "USD"], ["Netflix", 26.99, "USD"], ["ChatGPT", 20.4, "USD"], ["Claude", "=200*$C$15", "TWD"]]
		.forEach(([item, amt, cur], i) => { put(7 + i, sub + 1, item); put(7 + i, sub + 2, amt); put(7 + i, sub + 3, cur); });
	const other = BLOCK_START.其他;
	put(7, other + 1, "每月銀行管理"); put(7, other + 2, 15); put(7, other + 3, "USD");
	put(2, 52, "乾坤大挪移");
	put(5, 52, "總和");
	for (let i = 1; i <= 6; i++) put(5, 52 + i, `=SUM(${L(52 + i)}7:${L(52 + i)})`);
	["日期", "新臺幣", "當下美金", "實際美金", "匯差", "手續費", "當筆總額外花費"].forEach((v, i) => put(6, 52 + i, v));
	return g;
}

/** An old-layout previous month (10 月 flavour): only the two 收支狀況 rows matter here. */
export function oldMonthGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["10 月花費"];
	g[34] = ["", "", "", "花費總額", "=SUM(E3:E34)"];
	g[42] = ["", "本月美金收支狀況", "", "=D50-D51"];
	g[43] = ["", "本月新臺幣收支狀況", "", "=D55-D56+D57"];
	return g;
}
```

- [ ] **Step 2: Write the failing tests in `test/budget-layout.test.ts`**

```ts
it("isBudgetMonth: true on the template, false on an old month", () => {
	expect(isBudgetMonth(budgetGrid())).toBe(true);
	expect(isBudgetMonth(oldMonthGrid())).toBe(false);
});
it("findBudgetBlocks finds all nine blocks in column order, 午餐支出 as 中餐", () => {
	const blocks = findBudgetBlocks(budgetGrid(), "11 月");
	expect(blocks.map((b) => b.category)).toEqual(["中餐", "購物", "吃喝", "生活用品", "訂閱", "交通", "娛樂", "學貸", "其他"]);
	expect(blocks[4]).toEqual({ category: "訂閱", title: "訂閱支出", startCol: 27, budgetRow: 4, totalRow: 5, headerRow: 6 });
});
it("findBudgetBlocks throws when a block lost its 總和 label", () => {
	const g = budgetGrid(); g[4]![28] = "";
	expect(() => findBudgetBlocks(g, "11 月")).toThrow(/AB6.*總和|總和.*AB6/);
});
it("resolveBudgetBlock: alias, trim, unknown tag lists categories", () => {
	const blocks = findBudgetBlocks(budgetGrid(), "11 月");
	expect(resolveBudgetBlock(blocks, " 午餐 ", "11 月").startCol).toBe(7);
	expect(resolveBudgetBlock(blocks, "中餐", "11 月").startCol).toBe(7);
	expect(() => resolveBudgetBlock(blocks, "旅遊", "11 月")).toThrow(/中餐.*購物.*其他/);
});
it("firstEmptyEntryRow ignores the pre-typed TWD and fills gaps", () => {
	const g = budgetGrid();
	const blocks = findBudgetBlocks(g, "11 月");
	expect(firstEmptyEntryRow(g, blocks[1]!)).toBe(7);            // 購物: rows 7-8 hold only "TWD"
	expect(firstEmptyEntryRow(g, blocks[4]!)).toBe(13);           // 訂閱: entries in 7-12
	g[8]![28] = ""; g[8]![29] = "";                                // blank iCloud (row 9) by hand
	expect(firstEmptyEntryRow(g, blocks[4]!)).toBe(9);
});
it("blockEntries lists 訂閱's six starting entries", () => {
	const g = budgetGrid();
	const entries = blockEntries(g, findBudgetBlocks(g, "11 月")[4]!);
	expect(entries.map((e) => e.item)).toEqual(["ElevenLabs", "iCloud", "Google One", "Netflix", "ChatGPT", "Claude"]);
	expect(entries[5]).toEqual({ row: 12, date: undefined, item: "Claude", amount: "=200*$C$15", currency: "TWD" });
});
it("findBudgetTransferSection: 總和 above the header", () => {
	expect(findBudgetTransferSection(budgetGrid(), "11 月")).toEqual({ dateCol: 52, totalRow: 5, headerRow: 6 });
});
it("findBudgetIncomeSumifWindow reads C28:C31 from 本月美金收支狀況", () => {
	expect(findBudgetIncomeSumifWindow(budgetGrid(), "11 月")).toEqual({ start: 28, end: 31 });
});
it("findRateRow finds 本月匯率", () => {
	expect(findRateRow(budgetGrid(), "11 月")).toBe(15);
});
it("rateYear: this year from the current month on, next year before it (Taipei)", () => {
	const oct20 = new Date("2026-10-20T04:00:00Z");
	expect(rateYear(11, oct20)).toBe(2026);
	expect(rateYear(10, oct20)).toBe(2026);
	expect(rateYear(1, new Date("2026-12-15T04:00:00Z"))).toBe(2027);
	expect(rateYear(1, new Date("2026-12-31T17:00:00Z"))).toBe(2027); // already 2027-01-01 in Taipei → current month
});
it("rateFormula is the exact self-locking formula", () => {
	expect(rateFormula(2026, 11)).toBe(
		'=IF(TODAY()<=DATE(2026,11,1),GOOGLEFINANCE("CURRENCY:USDTWD"),INDEX(GOOGLEFINANCE("CURRENCY:USDTWD","price",DATE(2026,11,1)),2,2))',
	);
});
```

Note on the last `rateYear` case: 2026-12-31T17:00Z is 2027-01-01 01:00 in Taipei. There the current month is 1, so `rateYear(1)` is the current Taipei year, 2027.

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `bun install --frozen-lockfile && bun run test test/budget-layout.test.ts`
Expected: FAIL, because `../src/budget-layout` can't be resolved.

- [ ] **Step 4: Add the constants to `src/conventions.ts` and implement `src/budget-layout.ts`**

How each finder works:
- **`isBudgetMonth`:** any column-B cell equals `RATE_LABEL`.
- **`findBudgetBlocks`:**
  - A block header is a row with `日期`/`項目`/`金額`/`幣別` at `c..c+3`, for `c >= 7`.
  - Title: scan up column `c` from `headerRow-1` for the first string ending in `支出`. The category is the title minus `支出`, mapped through `BUDGET_CATEGORY_ALIASES`.
  - `budgetRow`: the row after the `編列預算` label in column `c`, between the title and the header.
  - `totalRow`: the row between the title and the header with `總和` in `c+1`.
  - Throw naming the header cell (e.g. `AB6`) and the missing piece. Throw on a duplicate category.
  - Return blocks sorted by `startCol`.
- **`resolveBudgetBlock`:** trim the tag and apply the alias. When nothing matches, throw `No "<tag>" block in <tab> — categories: <list joined by ", ">`.
- **`firstEmptyEntryRow`:** the first `r > headerRow` where 日期, 項目 and 金額 are all `""`/`null`/`undefined`. 幣別 is ignored.
- **`blockEntries`:** rows `headerRow+1 .. values.length` whose 項目 or 金額 is non-empty.
- **`findBudgetTransferSection`:** the first `乾坤大挪移` cell at col `>= 7`. Header: the first row below it with `日期`/`新臺幣` at `c`/`c+1`. `總和`: in column `c`, strictly between the title and the header. Throw when absent.
- **`findBudgetIncomeSumifWindow`:** the row comes from `findRowByLabels(values, MONTH_COLS.budgetLabel, MONTH_USD_NET_LABELS)`. Its column-D formula must match `/^=SUMIF\(C(\d+):C(\d+),/i`. Skip a leading `項目` header row, as `findIncomeSumifWindow` does. Throw otherwise.
- **`findRateRow`:** throw when `本月匯率` is missing.
- **`rateYear`:** the Taipei year and month via `Intl.DateTimeFormat` with `SHEET_TIMEZONE`. Return the current year when `month >= currentMonth`, else the current year + 1.

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `bun run test test/budget-layout.test.ts && bun run type-check`
Expected: PASS, with no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/conventions.ts src/budget-layout.ts test/budget-fixtures.ts test/budget-layout.test.ts
git commit -m "feat: budget-month layout finders and template fixture"
```

---

### Task 2: `add_expense` on budget months

**Files:**
- Create: `src/budget-ops.ts`
- Modify: `src/finance-ops.ts` (`addExpense`; export `bandInsert`, `assertNotTruncated`, `round2`, which are module-private today)
- Modify: `src/tools.ts` (`add_expense` description)
- Test: `test/budget-ops.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's finders and constants. `cellData`, `colLetter`, `quoteTab`, `assertNotTruncated`, and `AddExpenseParams` from `finance-ops` (export the interface if it isn't exported).
- Produces:
  ```ts
  export interface BudgetExpenseResult { tab: string; layout: "budget"; category: string; row: number; item: string; amount: number | string; currency: "USD" | "TWD"; date: string | null; convertedAtMonthRate: boolean }
  export async function addBudgetExpense(client: SheetsClient, tab: string, p: AddExpenseParams, dateSerialValue: number | null): Promise<BudgetExpenseResult>;
  ```
- **Hook in `addExpense`:** right after its existing first read and `assertNotTruncated`, add `if (isBudgetMonth(values)) return addBudgetExpense(client, tab, p, dateSerialValue);`.

**Test client** (put it in `test/budget-ops.test.ts`; later tasks reuse it): `budgetClient(grids: Record<string, unknown[][]>, tabs?: string[])`. Every method is a `vi.fn`:
- `readRange(range)` resolves `{ range, values: grids[tabName], truncated: false }`, where the tab name is parsed from `'…'!` in the range.
- `getSheetId(title)` resolves `{ "Budget Based": 900 }[title] ?? 111`.
- `batchUpdate(reqs)` resolves `{ replies: [{ duplicateSheet: { properties: { sheetId: 555 } } }] }` when `reqs[0].duplicateSheet` is set, else `{ replies: [{}] }`.
- `listTabs()` returns `(tabs ?? Object.keys(grids))` as `{ title, rowCount: 1000, columnCount: 62 }` objects.

- [ ] **Step 1: Write the failing tests**

```ts
it("writes a TWD expense into its block's first empty row, with a mm/dd date", async () => {
	const client = budgetClient({ "11 月": budgetGrid() });
	const r = await addExpense(client, { item: "Kato 500系", amount: 8940, currency: "TWD", tag: "購物", date: "2026-11-05", month: 11 });
	expect((client.readRange as any).mock.calls[1]).toEqual(["'11 月'!A1:BJ", "FORMULA"]);
	const reqs = (client.batchUpdate as any).mock.calls[0][0];
	expect(reqs).toContainEqual({ updateCells: { start: { sheetId: 111, rowIndex: 6, columnIndex: 13 },
		rows: [{ values: [cellData("Kato 500系"), cellData(8940), cellData("TWD")] }], fields: "userEnteredValue" } });
	expect(reqs).toContainEqual({ updateCells: { start: { sheetId: 111, rowIndex: 6, columnIndex: 12 },
		rows: [{ values: [{ userEnteredValue: { numberValue: dateSerial(2026, 11, 5) }, userEnteredFormat: { numberFormat: { type: "DATE", pattern: "mm/dd" } } }] }],
		fields: "userEnteredValue,userEnteredFormat.numberFormat" } });
	expect(r).toMatchObject({ layout: "budget", category: "購物", row: 7, currency: "TWD", convertedAtMonthRate: false });
});
it("writes a USD-priced, NTD-paid expense as TWD at the month rate", async () => {
	const client = budgetClient({ "11 月": budgetGrid() });
	await addExpense(client, { item: "GTA 6", amount: 99.99, currency: "USD", paidWith: "TWD", tag: "娛樂", month: 11 });
	expect((client.batchUpdate as any).mock.calls[0][0]).toContainEqual({ updateCells: { start: { sheetId: 111, rowIndex: 6, columnIndex: 38 },
		rows: [{ values: [cellData("GTA 6"), cellData("=99.99*$C$15"), cellData("TWD")] }], fields: "userEnteredValue" } });
});
it("refuses card and a missing tag on budget months, writing nothing", async () => {
	const client = budgetClient({ "11 月": budgetGrid() });
	await expect(addExpense(client, { item: "x", amount: 1, currency: "TWD", tag: "購物", card: "現金", month: 11 })).rejects.toThrow(/budget month.*支付方式|card/i);
	await expect(addExpense(client, { item: "x", amount: 1, currency: "TWD", month: 11 })).rejects.toThrow(/tag.*中餐/);
	expect(client.batchUpdate).not.toHaveBeenCalled();
});
it("refuses when the wide read is truncated", async () => {
	const client = budgetClient({ "11 月": budgetGrid() });
	(client.readRange as any).mockResolvedValueOnce({ range: "x", values: budgetGrid(), truncated: false })
		.mockResolvedValueOnce({ range: "x", values: budgetGrid(), truncated: true });
	await expect(addExpense(client, { item: "x", amount: 1, currency: "TWD", tag: "購物", month: 11 })).rejects.toThrow(/truncated/);
	expect(client.batchUpdate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun run test test/budget-ops.test.ts`
Expected: FAIL (old path: no `花費總額` window found).

- [ ] **Step 3: Implement `addBudgetExpense`, the hook and the `add_expense` description**

How `addBudgetExpense` works:
1. Refuse `p.card` with a message saying budget months have no card reconciliation.
2. Read `BUDGET_GRID_READ` with `FORMULA` and run `assertNotTruncated`.
3. A missing `tag` throws and lists the categories.
4. Resolve the block and take `firstEmptyEntryRow`.
5. `paidWith = p.paidWith ?? p.currency`. For USD + paid TWD, write 金額 as `` `=${amount}*$C$${rateRow}` `` with 幣別 `TWD`.
6. Write one `updateCells` at `startCol+1` with `[項目, 金額, 幣別]`, plus a date `updateCells` at `startCol` (same shape as the old path) when there's a date.
7. Send everything in one `batchUpdate`.

Add to the `add_expense` description: on budget months (from 11 月 2026), `tag` is required and picks the block (中餐/午餐 → the 午餐 block); `card` is refused; currency USD + `paid_with` TWD is written as TWD at `amount × 本月匯率`.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `bun run test && bun run type-check`
Expected: all PASS, including every existing `addExpense` test.

- [ ] **Step 5: Commit**

```bash
git add src/budget-ops.ts src/finance-ops.ts src/tools.ts test/budget-ops.test.ts
git commit -m "feat: add_expense writes into category blocks on budget months"
```

---

### Task 3: `delete_expense` on budget months

**Files:**
- Modify: `src/budget-ops.ts`, `src/finance-ops.ts` (`DeleteExpenseParams` gains `tag?: string`; hook in `deleteExpense`), `src/tools.ts` (`delete_expense` gains a `tag` param)
- Test: `test/budget-ops.test.ts`

**Interfaces:**
- Consumes: `findBudgetBlocks`, `resolveBudgetBlock`, `blockEntries`.
- Produces: `export async function deleteBudgetExpense(client: SheetsClient, tab: string, p: DeleteExpenseParams): Promise<{ tab: string; layout: "budget"; category: string; row: number; item: string; deleted: unknown[] }>`
- **Hook:** in `deleteExpense`, after the first read: `if (isBudgetMonth(values)) return deleteBudgetExpense(client, tab, p);`. The old path ignores `tag`.

- [ ] **Step 1: Write the failing tests**

```ts
it("deletes a block-scoped range so only that block's entries shift up", async () => {
	const client = budgetClient({ "11 月": budgetGrid() });
	const r = await deleteExpense(client, { item: "iCloud", month: 11 });
	expect((client.batchUpdate as any).mock.calls[0][0]).toEqual([{ deleteRange: {
		range: { sheetId: 111, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 27, endColumnIndex: 31 }, shiftDimension: "ROWS" } }]);
	expect(r).toMatchObject({ layout: "budget", category: "訂閱", row: 8, item: "iCloud", deleted: [undefined, "iCloud", 9.99, "USD"] });
});
it("refuses an item found in two blocks unless tag picks one", async () => {
	const g = budgetGrid(); g[6]![48] = "Claude"; g[6]![49] = 100;   // a second "Claude" in 其他 (row 7)
	const client = budgetClient({ "11 月": g });
	await expect(deleteExpense(client, { item: "Claude", month: 11 })).rejects.toThrow(/訂閱.*12.*其他.*7|其他.*7.*訂閱.*12/);
	expect(client.batchUpdate).not.toHaveBeenCalled();
	await deleteExpense(client, { item: "Claude", tag: "其他", month: 11 });
	expect((client.batchUpdate as any).mock.calls[0][0][0].deleteRange.range).toMatchObject({ startRowIndex: 6, startColumnIndex: 47 });
});
it("throws when no entry matches", async () => {
	await expect(deleteExpense(budgetClient({ "11 月": budgetGrid() }), { item: "Nope", month: 11 })).rejects.toThrow(/No "Nope"/);
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun run test test/budget-ops.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **Candidates:** every block, or only `tag`'s block, then `blockEntries` with an exact trimmed `項目` match.
- **Narrowing:** `p.row` narrows the candidates.
- **More than one candidate:** throw, listing `category row N` for each.
- **The delete:** `deleteRange` over `[startCol, startCol+4)`, one row, with `shiftDimension: "ROWS"`.
- **`deleted`:** the four cells `values[row-1].slice(startCol, startCol+4)`.
- **Tool param:** `delete_expense` gets `tag: z.string().min(1).optional()`, described as "Budget months: the category block to search. Every block has entries on the same sheet rows, so `row` alone can't pick one."

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `bun run test && bun run type-check`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/budget-ops.ts src/finance-ops.ts src/tools.ts test/budget-ops.test.ts
git commit -m "feat: delete_expense removes block entries on budget months"
```

---

### Task 4: `set_income` on budget months

**Files:**
- Modify: `src/finance-ops.ts` (`setIncome`, `NON_INCOME_LABELS`)
- Test: `test/budget-ops.test.ts`

**Interfaces:**
- Consumes: `isBudgetMonth`, `findBudgetIncomeSumifWindow`, and the new label constants.
- Produces: no new exports. In `setIncome`:
  - Use `sumifWin = isBudgetMonth(values) ? findBudgetIncomeSumifWindow(values, tab) : findIncomeSumifWindow(values, tab)`.
  - Skip `auditCreditBuckets` on budget months, and leave its `bucketWarning`/`bucketsGrown` undefined.
  - Add `RATE_LABEL`, `BUDGET_SUM_LABEL`, `OVERSPEND_LABEL`, `OVERSPEND_NET_LABEL` and `TOTAL_SPENDING_LABEL` to `NON_INCOME_LABELS`.

- [ ] **Step 1: Write the failing tests**

```ts
it("updates 沛還 in place on a budget month", async () => {
	const client = budgetClient({ "11 月": budgetGrid() });
	const r = await setIncome(client, { item: "沛還", amount: 800, currency: "USD", month: 11 });
	expect((client.batchUpdate as any).mock.calls[0][0]).toEqual([{ updateCells: { start: { sheetId: 111, rowIndex: 28, columnIndex: 2 },
		rows: [{ values: [cellData("USD"), cellData(800)] }], fields: "userEnteredValue" } }]);
	expect(r).toMatchObject({ row: 29, action: "updated" });
});
it("fills the first empty income row, then grows B–D only when the window is full", async () => {
	const g = budgetGrid(); g[29] = ["", "獎金", "TWD", 1000]; g[30] = ["", "股息", "USD", 5];
	const client = budgetClient({ "11 月": g });
	await setIncome(client, { item: "發票中獎", amount: 200, currency: "TWD", month: 11 });
	expect((client.batchUpdate as any).mock.calls[0][0][0]).toEqual({ insertRange: {
		range: { sheetId: 111, startRowIndex: 30, endRowIndex: 31, startColumnIndex: 1, endColumnIndex: 4 }, shiftDimension: "ROWS" } });
});
it("refuses layout labels like 本月匯率", async () => {
	await expect(setIncome(budgetClient({ "11 月": budgetGrid() }), { item: "本月匯率", amount: 1, currency: "TWD", month: 11 })).rejects.toThrow(/layout label/);
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun run test test/budget-ops.test.ts`
Expected: FAIL (`本月美金收入` not found).

- [ ] **Step 3: Implement the three edits listed under Interfaces**

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `bun run test && bun run type-check`
Expected: all PASS, including every existing `setIncome` test.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/budget-ops.test.ts
git commit -m "feat: set_income works on budget months"
```

---

### Task 5: `add_transfer` on budget months

**Files:**
- Modify: `src/finance-ops.ts` (`addTransfer`, `wireJpyTransferIntoMonth`; extract two helpers)
- Modify: `src/budget-ops.ts`
- Modify: `src/tools.ts` (`add_transfer` description)
- Test: `test/budget-ops.test.ts`

**Interfaces:**
- **Extract these from `addTransfer`, with no behavior change.** The existing `addTransfer` tests are the safety net.
  ```ts
  /** Writes =GOOGLEFINANCE("CURRENCY:<pair>") into (row, spotCol) in ONE batch after `preRequests`, reads it back, returns the rate; clears the cell and throws on an unusable rate (today's message). */
  export async function pinTransferRate(client: SheetsClient, tab: string, sheetId: number, preRequests: object[], row: number, spotCol: number, pair: "USDTWD" | "JPYTWD"): Promise<number>;
  /** The six value cells 新臺幣…當筆總額外花費 for entry `row`, exactly as addTransfer builds them today. */
  export function transferRowCells(cols: TransferSectionConfig["cols"], row: number, ntd: number, received: number, rate: number, fee: number): object[];
  ```
- Produces: `export async function addBudgetTransfer(client: SheetsClient, tab: string, p: AddTransferParams, dateSerialValue: number)`. It returns the same fields as the usd result of `addTransfer` (`tab, row, inserted: false, date, ntd, rate, spread, fee, extraCost, usd, spotUsd`) plus `layout: "budget"`.
- **Hooks:**
  - In `addTransfer`, after its first read and only for `currency === "usd"`: `if (isBudgetMonth(values)) return addBudgetTransfer(client, tab, p, dateSerialValue);`. This must run before `auditCreditBuckets`.
  - `wireJpyTransferIntoMonth` returns `Promise<boolean>`. It returns `false` without writing when the month tab `isBudgetMonth`.
  - The jpy result becomes `wiredMonthTab: wired ? monthTab : null`. When nothing was wired, it adds `wiringNote: "<monthTab> is a budget month — the JPY transfer's NTD side was not linked into it."`.

- [ ] **Step 1: Write the failing tests**

```ts
it("writes the first empty 乾坤大挪移 row on a budget month and never rewrites 總和", async () => {
	const client = budgetClient({ "11 月": budgetGrid() });
	(client.readRange as any)
		.mockResolvedValueOnce({ range: "x", values: budgetGrid(), truncated: false })
		.mockResolvedValueOnce({ range: "x", values: budgetGrid(), truncated: false })
		.mockResolvedValueOnce({ range: "x", values: [[32.5]], truncated: false });
	const r = await addTransfer(client, { ntd: 32000, usd: 980, fee: 15, date: "2026-11-03", month: 11 });
	const [scratch, write] = (client.batchUpdate as any).mock.calls.map((c: any) => c[0]);
	expect(scratch).toEqual([{ updateCells: { start: { sheetId: 111, rowIndex: 6, columnIndex: 54 },
		rows: [{ values: [cellData('=GOOGLEFINANCE("CURRENCY:USDTWD")')] }], fields: "userEnteredValue" } }]);
	expect(write).toContainEqual({ updateCells: { start: { sheetId: 111, rowIndex: 6, columnIndex: 53 },
		rows: [{ values: [cellData(32000), cellData("=BB7/32.5"), cellData(980), cellData("=(BC7-BD7)*32.5"), cellData(15), cellData("=BE7+BF7")] }],
		fields: "userEnteredValue" } });
	expect(JSON.stringify(write)).not.toContain('"rowIndex":4');   // 總和 row untouched
	expect(r).toMatchObject({ layout: "budget", row: 7, usd: 980, rate: 32.5 });
});
it("jpy transfer dated in a budget month is written but not wired", async () => {
	// Reuse the trip fixture and fake from the existing "addTransfer (jpy)" tests. Make the
	// month-tab read return budgetGrid(). Expect two batchUpdate calls (scratch, write) and
	// no third (wiring), and result.wiredMonthTab === null with a wiringNote mentioning "budget month".
});
```

The jpy test's body: copy the setup of the existing jpy month-wiring test in `test/finance-ops.test.ts` (around line 1632), swapping in `budgetGrid()` for the month read. Export `budgetGrid` from the fixtures file so it can be imported there.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun run test`
Expected: the new tests FAIL; the old ones PASS.

- [ ] **Step 3: Extract the helpers, implement `addBudgetTransfer` and the hooks, and update the `add_transfer` description**

`addBudgetTransfer`:
1. Read `BUDGET_GRID_READ` with `FORMULA` and assert it isn't truncated.
2. Find the section with `findBudgetTransferSection`.
3. Target row: the first `r > headerRow` whose `dateCol..dateCol+6` cells are all empty.
4. `rate = pinTransferRate(client, tab, sheetId, [], r, dateCol+2, "USDTWD")`.
5. One `batchUpdate`: the date cell (mm/dd, same shape as today) plus `transferRowCells`.

Description: on budget months, the entry goes into the 乾坤大挪移 section at BA–BG; a JPY transfer dated in a budget month isn't linked into that month.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `bun run test && bun run type-check`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts src/budget-ops.ts src/tools.ts test/budget-ops.test.ts test/finance-ops.test.ts test/budget-fixtures.ts
git commit -m "feat: add_transfer on budget months; skip JPY wiring into budget months"
```

---

### Task 6: `month_summary` and `get_categories` on budget months

**Files:**
- Modify: `src/budget-ops.ts`, `src/finance-ops.ts` (`monthSummary`, `getCategories`), `src/tools.ts` (both descriptions)
- Modify: `test/finance-ops.test.ts`, only the two `getCategories` readRange assertions (see Step 3)
- Test: `test/budget-ops.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function budgetMonthSummary(client: SheetsClient, tab: string): Promise<{
    tab: string; layout: "budget"; 本月匯率: number | null; 上月美金透支: number | null; 上月新臺幣透支: number | null;
    budgets: Array<{ category: string; 編列預算: number | null; 總和: number | null; 剩餘: number | null }>;
    預算總額: number | null; incomes: Array<{ item: string; currency: string | null; amount: number | null }>;
    本月美金收支狀況: number | null; 本月新臺幣收支狀況: number | null; 本月超支: number | null;
    "本月超支（加上回補）": number | null; 總支出: number | null;
    乾坤大挪移: { 新臺幣: number | null; 實際美金: number | null; 手續費: number | null; 當筆總額外花費: number | null } | null;
  }>;
  export async function budgetCategories(client: SheetsClient, tab: string): Promise<{ tab: string; categories: string[]; source: "BUDGET_BLOCKS" }>;
  ```
- **Where each value is read** (`budgetMonthSummary` reads `BUDGET_GRID_READ` with `UNFORMATTED_VALUE`; numbers only, anything else is `null`):
  - **Carries:** found by the 項目 label in column B. USD value in D, NTD value in E.
  - **本月匯率:** column C of the rate row.
  - **預算總額:** label in D, value in E.
  - **Block 編列預算 / 剩餘:** `budgetRow` at `startCol` / `startCol+2`.
  - **Block 總和:** `totalRow` at `startCol+2`.
  - **incomes:** the `findIncomeWindow` rows that have a 項目.
  - **收支狀況, 超支 and 總支出 rows:** label in B, value in D.
  - **乾坤大挪移:** `totalRow` at `dateCol+1`, `+3`, `+5` and `+6`. `null` when the section is absent.
- **Hooks:**
  - `monthSummary`: after its first read, `if (isBudgetMonth(values)) return budgetMonthSummary(client, tab);`.
  - `getCategories` now reads first: `client.readRange(` `` `${quoteTab(tab)}!${FULL_GRID_READ}` `` `, "FORMULA")`. On a budget month it returns `budgetCategories(client, tab)`; otherwise it continues with today's validation probe, unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
it("month_summary reports budgets per block and both 收支狀況 lines", async () => {
	const g = budgetGrid();
	g[3]![7] = 3900; g[4]![9] = 0; g[3]![9] = 3900;              // 午餐: 編列預算 (H4), 總和 (J5), 剩餘 (J4)
	g[3]![27] = 13016.72; g[4]![29] = 8808.86; g[3]![29] = 4207.86; // 訂閱
	g[2]![3] = 0; g[2]![4] = 0; g[3]![4] = 19281.68; g[14]![4] = 63619.74;
	g[31]![3] = 183.7; g[32]![3] = -883.62; g[34] = ["", "本月超支", "", 0]; g[39] = ["", "總支出", "", 55512.6];
	g[4]![53] = 0; g[4]![55] = 0; g[4]![57] = 0; g[4]![58] = 0;   // 乾坤大挪移 總和: 新臺幣 BB, 實際美金 BD, 手續費 BF, 當筆總額外花費 BG
	const s = await monthSummary(budgetClient({ "11 月": g }), 11);
	expect(s).toMatchObject({ layout: "budget", 本月匯率: 32.4607, 上月新臺幣透支: 19281.68, 預算總額: 63619.74,
		本月美金收支狀況: 183.7, 本月新臺幣收支狀況: -883.62, 本月超支: 0, 總支出: 55512.6,
		incomes: [{ item: "薪水", currency: "TWD", amount: 65271 }, { item: "沛還", currency: "USD", amount: 700 }],
		乾坤大挪移: { 新臺幣: 0, 實際美金: 0, 手續費: 0, 當筆總額外花費: 0 } });
	expect(s.budgets[0]).toEqual({ category: "中餐", 編列預算: 3900, 總和: 0, 剩餘: 3900 });
	expect(s.budgets[4]).toEqual({ category: "訂閱", 編列預算: 13016.72, 總和: 8808.86, 剩餘: 4207.86 });
});
it("get_categories lists the blocks on a budget month", async () => {
	const client = { ...budgetClient({ "11 月": budgetGrid() }), getDataValidation: vi.fn() } as unknown as SheetsClient;
	expect(await getCategories(client, 11)).toEqual({ tab: "11 月", source: "BUDGET_BLOCKS",
		categories: ["中餐", "購物", "吃喝", "生活用品", "訂閱", "交通", "娛樂", "學貸", "其他"] });
	expect((client as any).getDataValidation).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun run test test/budget-ops.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement, then update the two old assertions**

- In `test/finance-ops.test.ts`, test "returns deduped ONE_OF_LIST values…": replace `expect(client.readRange).not.toHaveBeenCalled();` with `expect(client.readRange).toHaveBeenCalledTimes(1);` (the layout-detection read).
- In test "follows a ONE_OF_RANGE rule…": change `mock.calls[0]` to `mock.calls[1]` in the `Settings!A1:A20` assertion.
- Update the descriptions: `month_summary` ("on budget months returns `layout:"budget"` with per-block 編列預算/總和/剩餘, 本月匯率, both 收支狀況 lines, 本月超支 and 總支出") and `get_categories` ("on budget months returns the category blocks").

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `bun run test && bun run type-check`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/budget-ops.ts src/finance-ops.ts src/tools.ts test/budget-ops.test.ts test/finance-ops.test.ts
git commit -m "feat: month_summary and get_categories understand budget months"
```

---

### Task 7: Refuse old-layout-only tools on budget months

**Files:**
- Modify: `src/finance-ops.ts` (`addLunch`, `setExpenseDate`, `adjustBalance`), `src/tools.ts` (three descriptions)
- Test: `test/budget-ops.test.ts`

**Interfaces:**
- Produces: right after each op's first read (`adjustBalance`: after its paired reads), `if (isBudgetMonth(values)) throw new Error(<message>)`, with these messages:
  - `add_lunch`: `` `${tab} is a budget month — lunches are entries in the 午餐 block: use add_expense with tag 中餐.` ``
  - `set_expense_date`: `` `${tab} is a budget month — it has no card statement buckets to date a row into. To change an entry's date, delete_expense it and add_expense it again.` ``
  - `adjust_balance`: `` `${tab} is a budget month — it has no bank-balance sections to reconcile.` ``

- [ ] **Step 1: Write the failing tests:** one per tool on `budgetClient({ "11 月": budgetGrid() })`, each expecting `rejects.toThrow("is a budget month")` and `batchUpdate` not called.
- [ ] **Step 2: Run the tests to confirm they fail.** Run: `bun run test test/budget-ops.test.ts`. Expected: FAIL.
- [ ] **Step 3: Add the three guards and append "Refused on budget months." to the three tool descriptions.**
- [ ] **Step 4: Run the tests to confirm they pass.** Run: `bun run test && bun run type-check`. Expected: all PASS.
- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts src/tools.ts test/budget-ops.test.ts
git commit -m "feat: refuse add_lunch, set_expense_date and adjust_balance on budget months"
```

---

### Task 8: `start_month` builds from the template; `replace_old_layout`

**Files:**
- Modify: `src/finance-ops.ts` (`startMonth` signature and branch; export a `carryFormula(prevTab: string, row: number): string` helper used by both paths)
- Modify: `src/budget-ops.ts`, `src/tools.ts` (`start_month` param and description)
- Test: `test/budget-ops.test.ts`

**Interfaces:**
- **`startMonth`'s signature becomes** `startMonth(client: SheetsClient, month: number, opts: { replaceOldLayout?: boolean; now?: Date } = {})`. After `listTabs()`:
  - When `BUDGET_TEMPLATE_TAB` is among the tabs → `return startBudgetMonth(client, month, tabs.map(t => t.title), { replaceOldLayout: opts.replaceOldLayout ?? false, now: opts.now ?? new Date() })`.
  - Otherwise, with `replaceOldLayout` set → throw `replace_old_layout needs the "Budget Based" template tab`.
  - Otherwise the old path, unchanged.
- Produces:
  ```ts
  export async function startBudgetMonth(client: SheetsClient, month: number, tabTitles: string[], opts: { replaceOldLayout: boolean; now: Date }): Promise<{
    tab: string; layout: "budget"; template: "Budget Based"; carriesFrom: string | null; replacedTab: string | null;
    rateFormula: string; startingEntries: Record<string, string[]>;
  }>;
  ```
- **Steps inside `startBudgetMonth`:**
  1. **If "N 月" exists:**
     - Without `replaceOldLayout` → throw "already exists".
     - Read it (`FULL_GRID_READ`, `FORMULA`). If it's a budget month → throw "never replaces a budget month".
     - If "N 月 DEP" exists → throw.
     - Rename it: `batchUpdate([{ updateSheetProperties: { properties: { sheetId, title: "N 月 DEP" }, fields: "title" } }])`.
  2. **Duplicate the template:** `batchUpdate([{ duplicateSheet: { sourceSheetId: <id of "Budget Based">, insertSheetIndex: 0, newSheetName: "N 月" } }])`, then take the new `sheetId` from the reply.
  3. **Read the new tab** (`BUDGET_GRID_READ`, `FORMULA`). Find the carry rows by `PREV_USD_OVERDRAFT_LABEL` / `PREV_NTD_OVERDRAFT_LABEL` in column B, and `findRateRow`.
     - If any is missing, throw: "…N 月 was created from the template but not finished — delete it, fix the template, re-run".
  4. **If the previous month's tab exists,** read it (`FULL_GRID_READ`, `FORMULA`) and find `MONTH_USD_NET_LABELS` / `MONTH_NTD_NET_LABELS` in column B. Each carry is `carryFormula(prev, row)`, or `0` when the tab or label is missing.
  5. **One `batchUpdate`:**
     - the title `${month} 月花費` at A1
     - the USD carry in D, the NTD carry in E
     - `rateFormula(rateYear(month, now), month)` at C of the rate row
- **Tool:** `start_month` gets `replace_old_layout: z.boolean().optional()` and passes `{ replaceOldLayout: replace_old_layout }`.

- [ ] **Step 1: Write the failing tests** (use `getSheetId` from `budgetClient`; `batchUpdate` resolves `{ replies: [{ duplicateSheet: { properties: { sheetId: 555 } } }] }` on the duplicate call)

```ts
const NOW = { now: new Date("2026-10-20T04:00:00Z") };
it("builds 11 月 from the template with carries to 10 月 and the locked-rate formula", async () => {
	// '11 月' has a grid (what the duplicate will read back) but isn't in listTabs yet.
	const client = budgetClient({ "Budget Based": budgetGrid(), "10 月": oldMonthGrid(), "11 月": budgetGrid() }, ["Budget Based", "10 月"]);
	const r = await startMonth(client, 11, NOW);
	const calls = (client.batchUpdate as any).mock.calls.map((c: any) => c[0]);
	expect(calls[0]).toEqual([{ duplicateSheet: { sourceSheetId: 900, insertSheetIndex: 0, newSheetName: "11 月" } }]);
	expect(calls[1]).toEqual(expect.arrayContaining([
		{ updateCells: { start: { sheetId: 555, rowIndex: 0, columnIndex: 0 }, rows: [{ values: [cellData("11 月花費")] }], fields: "userEnteredValue" } },
		{ updateCells: { start: { sheetId: 555, rowIndex: 2, columnIndex: 3 }, rows: [{ values: [cellData("=IF(-('10 月'!D43) > 0, -('10 月'!D43), 0)")] }], fields: "userEnteredValue" } },
		{ updateCells: { start: { sheetId: 555, rowIndex: 3, columnIndex: 4 }, rows: [{ values: [cellData("=IF(-('10 月'!D44) > 0, -('10 月'!D44), 0)")] }], fields: "userEnteredValue" } },
		{ updateCells: { start: { sheetId: 555, rowIndex: 14, columnIndex: 2 }, rows: [{ values: [cellData(rateFormula(2026, 11))] }], fields: "userEnteredValue" } },
	]));
	expect(r).toMatchObject({ tab: "11 月", carriesFrom: "10 月", replacedTab: null });
	expect(r.startingEntries["訂閱"]).toEqual(["ElevenLabs", "iCloud", "Google One", "Netflix", "ChatGPT", "Claude"]);
});
it("missing previous month → both carries 0", async () => { /* listTabs without "10 月" → D3 and E4 written as 0, carriesFrom null */ });
it("start_month(1) in December locks to DATE(2027,1,1)", async () => { /* now 2026-12-15 → rate cell = rateFormula(2027, 1) */ });
it("existing old-layout 11 月: refuses without the flag; renames to 11 月 DEP with it", async () => {
	/* without flag: rejects /already exists/, batchUpdate not called.
	   with { replaceOldLayout: true }: calls[0] = [{ updateSheetProperties: { properties: { sheetId: 111, title: "11 月 DEP" }, fields: "title" } }],
	   calls[1] is the duplicate, result.replacedTab === "11 月 DEP" */
});
it("never replaces a budget month or an existing DEP", async () => { /* '11 月' read returns budgetGrid() → rejects /budget month/; tabs include "11 月 DEP" → rejects /DEP/ */ });
it("old path still runs without the template; the flag without the template throws", async () => { /* tabs ["9 月","8 月"] → old duplicate of 9 月; { replaceOldLayout: true } → rejects /Budget Based/ */ });
```

Fill in the commented test bodies with the same client and assertion style as the first test. The comments give the exact expected values.

For `readRange` in these tests: key the fixtures by tab, and make the new tab's read (after the duplicate) return `budgetGrid()`. When the old "11 月" is also present before the rename, return `oldMonthGrid()` for its first read and `budgetGrid()` for the read after the duplicate (`mockResolvedValueOnce` order).

- [ ] **Step 2: Run the tests to confirm they fail.** Run: `bun run test test/budget-ops.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `startBudgetMonth`, the `startMonth` branch, the `carryFormula` helper (the old path's private `carryFormula` closure now calls it) and the tool param.**
- [ ] **Step 4: Run the tests to confirm they pass.** Run: `bun run test && bun run type-check`. Expected: all PASS, including all ~25 existing `startMonth` tests.
- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts src/budget-ops.ts src/tools.ts test/budget-ops.test.ts
git commit -m "feat: start_month builds budget months from the Budget Based template"
```

---

### Task 9: Conventions text and README

**Files:**
- Modify: `src/conventions.ts` (`CONVENTIONS_TEXT`), `README.md`
- Test: `test/conventions.test.ts` (if it snapshots or asserts on the text, extend it for the new section)

- [ ] **Step 1: Add a test** in `test/conventions.test.ts` asserting that `CONVENTIONS_TEXT` contains `BUDGET MONTHS`, `本月匯率` and `Budget Based`.
- [ ] **Step 2: Run it to confirm it fails.** Run: `bun run test test/conventions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write a `BUDGET MONTHS` section in `CONVENTIONS_TEXT`.**
  - What it covers:
    - from 11 月 2026 on, budget months replace the old layout
    - the left side: carries, budget list (one line per category and currency), 本月匯率 / 預算總額, income list, the two 收支狀況 lines, 本月超支, 總支出
    - the nine blocks (title row, 編列預算/剩餘, 總和 on top, open-ended entries, 幣別 = the paying account's currency, blank = TWD)
    - 乾坤大挪移 at BA–BG
    - `start_month` copies the "Budget Based" template; `replace_old_layout` and the DEP tabs
    - which tools apply and which refuse
  - Wording rules:
    - Keep the existing sections' wording. Add a sentence to the MONTHLY TABS heading saying it describes 5 月–10 月 and the DEP tabs.
    - Never tell a reader to write below a block.
  - README: add a short "Budget months" paragraph after the tool list naming the same tool behavior, and add `replace_old_layout` / `tag` to the `start_month` / `delete_expense` lines.
- [ ] **Step 4: Run all checks.** Run: `bun run test && bun run type-check`. Expected: all PASS.
- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts README.md test/conventions.test.ts
git commit -m "docs: describe budget months in get_sheet_conventions and the README"
```

---

## After the plan (not a code task)

The rollout in the spec's *Rollout* section runs against the live sheet once the branch is merged and deployed:
1. `start_month(11, replace_old_layout: true)`
2. re-add 11 月's five one-offs
3. `start_month(12, replace_old_layout: true)`
4. re-add 12 月's two one-offs
5. check with `month_summary`

Do it only after the user confirms the deploy.
