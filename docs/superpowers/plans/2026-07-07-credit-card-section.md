# 信用卡帳單對帳區 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Card expenses logged once in the expense list (with the new 支付方式 column G) mirror automatically — via FILTER formulas — into the right card's statement bucket in the 信用卡帳單對帳區, and start_month rolls the section forward each month.

**Architecture:** The sheet does the mirroring (one FILTER per bucket, one SUMIFS 小計 per bucket, all keyed on column G + 日期 vs the card's 結帳日). The code side syncs the tools to the G-column insert (every section right of F shifted +1 column), adds a `CREDIT_CARDS` registry as the single source of truth, teaches `add_expense` a `card` param, and teaches `startMonth` to bump the card dates and rewire the cross-tab statement formulas. Spec: `docs/superpowers/specs/2026-07-07-credit-card-section-design.md`.

**Tech Stack:** TypeScript on Cloudflare Workers, Google Sheets API via `SheetsClient`, vitest with a mocked client, zod tool schemas (MCP SDK).

## Global Constraints

- Package manager is **bun**: `bun install`, `bun run test`, `bun run type-check` (never `bun test` — that's bun's own runner, not vitest).
- Git identity: niuee / vntchang@gmail.com. Branch: `feat/credit-card-section`.
- Card names are exact strings everywhere (registry, column G, block titles): `國泰 CUBE`, `CHASE Amazon`, `CHASE Freedom Unlimited`, `Apple Card`.
- `src/conventions.ts` is the single source of truth for sheet layout; ops read anchors from it, never hardcode.
- Monthly-tab geometry from 7月 2026 (after the G insert): expense list A–G, 乾坤大挪移 H–N, 午餐預算 P–R, 信用卡帳單對帳區 H–N from row 50 down.
- Tasks 1–6 are code; Task 7 touches the **production** Google Sheet via the sheets-mcp tools and needs Vincent's go-ahead before each write phase.

---

### Task 1: Column-geometry sync (G column shifted everything right of F)

The user inserted 支付方式 as column G on 7月. 乾坤大挪移 moved G–M → H–N (title verified at H36 on the live sheet), 午餐預算 moved O–Q → P–R (title verified at P37). The tools still write the old columns — this task re-points them and widens the reads.

**Files:**
- Modify: `src/conventions.ts:111-133` (MONTH_COLS), `:147-163` (TRANSFER_COLS), `:184-192` (LUNCH_COLS)
- Modify: `src/finance-ops.ts:131-132` (TRANSFER_GRID_READ), `:164-167` (LUNCH_GRID_READ → FULL_GRID_READ), `:670`, `:758`, `:892-893` (usages), `:1062-1079` (delete scope)
- Modify: `src/tools.ts:251` (add_transfer description), `:274` (add_lunch description)
- Test: `test/finance-ops.test.ts` (fixtures + expectations), `test/conventions.test.ts:122-135` (MONTH_COLS test)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MONTH_COLS.paidMethod = 6` (G, 支付方式); `TRANSFER_COLS` = `{date: 7, ntd: 8, spotUsd: 9, actualUsd: 10, spread: 11, fee: 12, extra: 13}` (H–N); `LUNCH_COLS` = `{date: 15, item: 16, amount: 17}` (P–R); `FULL_GRID_READ = "A1:R160"` exported from `src/finance-ops.ts` (replaces `LUNCH_GRID_READ`); `TRANSFER_GRID_READ = "A1:N60"`. Tasks 4–5 read the credit section out of `FULL_GRID_READ`.

- [ ] **Step 1: Update the test fixtures and expectations to the new geometry (they become the failing tests)**

In `test/finance-ops.test.ts`:

Replace `transferGrid()` (currently placing the block at G33, indices 6–12) with the block at H33, indices 7–13:

```ts
/** currentMonthGrid + a 乾坤大挪移 transfer block at H33:N36 (data slot row 35 empty). */
function transferGrid(): unknown[][] {
	const g = currentMonthGrid();
	g[32] = ["", "", "", "", "", "", "", "乾坤大挪移"];
	g[33] = ["", "", "", "", "", "", "", "日期", "新臺幣", "當下美金", "實際美金", "匯差", "手續費", "當筆總額外花費"];
	// row 35 empty — the first data slot
	g[35] = ["", "", "", "", "", "", "", "總和", "=sum(I35)", "=sum(J35)", "=sum(K35)", "=sum(L35)", "=sum(M35)", "=sum(N35)"];
	return g;
}
```

Replace `lunchGrid()` with the block at P33:R38 (columns 15–17, formula letters re-lettered):

```ts
/** transferGrid + a 午餐預算 lunch block at P33:R38 (data slot row 37 empty). */
function lunchGrid(): unknown[][] {
	const g = transferGrid();
	const put = (idx: number, col: number, v: unknown) => {
		(g[idx] ??= [])[col] = v;
	};
	put(32, 15, "午餐預算");
	put(33, 15, "編列預算");
	put(33, 17, "剩餘 (負數會加回去支出）");
	put(34, 15, "=E5"); // 編列預算 ← the 中餐 expense cell
	put(34, 17, "=P35-R38"); // 剩餘 = 編列預算 − 總和
	put(35, 15, "日期");
	put(35, 16, "項目");
	put(35, 17, "金額");
	// row 37 (index 36) empty — the first data slot
	put(37, 16, "總和");
	put(37, 17, "=sum(R37)");
	return g;
}
```

In `currentMonthGrid()`, add the new header cell and re-letter the (data-only, but keep them honest) bank formulas:

```ts
g[1] = ["日期", "項目", "類別", "美金", "新臺幣", "支付幣別", "支付方式"];
...
g[25] = ["", "本月底美金餘額", "", "=D25+D23-D24+K36"];
...
g[27] = ["", "本月新臺幣支出", "", '=SUMIF(F3:F10,"TWD",E3:E10)+N36'];
g[28] = ["", "午餐超支或回補", "", "=R35"];
...
g[30] = ["", "保守預計本月底新臺幣餘額", "", "=D30+D27-D28-I36+IF(R35>0, 0, R35)"];
g[31] = ["", "本月底新臺幣餘額", "", "=D30+D27-D28-I36+D29"];
```

Then shift the mechanical expectations (rule: every transfer column index +1, every transfer column letter +1, every lunch column index +1, lunch letters O/P/Q → P/Q/R):

- `describe("findLunchSection")` — the "throws when the header row is missing" test sets `(g[35] as unknown[])[14] = ""` → `[15]`; the 總和 test `(g[37] as unknown[])[15] = ""` → `[16]`.
- `describe("addTransfer")` — read range `"'9 月'!A1:M60"` → `"'9 月'!A1:N60"`; scratch `columnIndex: 8` → `9`; scratch cell `"'9 月'!I35"` → `"'9 月'!J35"`; date `columnIndex: 6` → `7`; entry-row `columnIndex: 7` → `8`; every `=SUM(H…)`/`H`-through-`M` letter in 總和-rewrite expectations shifts one letter right (H→I … M→N). Run the suite after the constants change and fix any残り by this rule.
- `describe("addLunch")` — read range `A1:Q120` → `A1:R160`; date `columnIndex: 14` → `15`; item/amount writes `15` → `16`; 總和 formula letters Q→R; the read-back range letters O…Q → P…R.
- `describe("startMonth")` — `"'10 月'!A1:Q120"` → `"'10 月'!A1:R160"`; the lunch-clear `repeatCell` `startColumnIndex: 14, endColumnIndex: 17` → `15` / `18`; every `deleteRange` `endColumnIndex: 6` → `7` (rows now delete A–G so the 支付方式 cell dies with its row).
- Import: `LUNCH_GRID_READ` → `FULL_GRID_READ` in the test's import list (line 24).

In `test/conventions.test.ts`, the MONTH_COLS test (line 122) gains:

```ts
expect(MONTH_COLS.paidMethod).toBe(6); // G — 支付方式
```

and the TRANSFER_COLS / LUNCH_COLS assertions in the same file (if present — search for `TRANSFER_COLS`) shift to the H–N / P–R values.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test`
Expected: FAIL — transfer/lunch/startMonth suites break on the old column constants (e.g. expected columnIndex 9, got 8).

- [ ] **Step 3: Update the constants and code**

`src/conventions.ts` — MONTH_COLS gains G (insert after `paidWith`):

```ts
	/** F — 支付幣別, which real account paid the row (USD/TWD). */
	paidWith: 5,
	/** G — 支付方式, which credit card charged the row (a CREDIT_CARDS name); blank = cash/transfer. */
	paidMethod: 6,
```

TRANSFER_COLS — doc comment says G–M; change to H–N and shift every index +1:

```ts
/** 0-indexed columns of the 乾坤大挪移 section (H–N, one right of the original G–M since the 支付方式 column landed in G). */
export const TRANSFER_COLS = {
	/** H — 日期; also the column of the section title and the 總和 label. */
	date: 7,
	/** I — 新臺幣 debited from the bank. */
	ntd: 8,
	/** J — 當下美金 = 新臺幣 / spot rate, pinned at entry time. */
	spotUsd: 9,
	/** K — 實際美金: the USD that actually arrived. */
	actualUsd: 10,
	/** L — 匯差 in NTD = (當下美金 − 實際美金) × the pinned rate. */
	spread: 11,
	/** M — 手續費 in NTD. */
	fee: 12,
	/** N — 當筆總額外花費 = 匯差 + 手續費. */
	extra: 13,
} as const;
```

LUNCH_COLS — same treatment (O–Q → P–R):

```ts
/** 0-indexed columns of the 午餐預算 section (P–R, one right of the original O–Q since the 支付方式 column landed in G). */
export const LUNCH_COLS = {
	/** P — 日期; also the column of the section title, the 編列預算 label, and the budget value. */
	date: 15,
	/** Q — 項目; also the column of the 總和 label. */
	item: 16,
	/** R — 金額; also the 剩餘 value and the 總和 =SUM cell. */
	amount: 17,
} as const;
```

Update the transfer/lunch doc comments elsewhere in the file that name columns (`(G–M)` at line ~139, `(O–Q)` at line ~166) to H–N / P–R.

`src/finance-ops.ts`:

```ts
/** The 乾坤大挪移 section spans H–N, wider than GRID_READ — read the full width. */
export const TRANSFER_GRID_READ = "A1:N60";
```

Rename `LUNCH_GRID_READ` → `FULL_GRID_READ`, widen, and update its comment (it now also covers the credit section, rows 50–~117):

```ts
// The deep month grid: the lunch section (P–R) grows one row per entry and
// pushes the 銀行餘額 block down, and the 信用卡帳單對帳區 (H–N) runs from
// row 50 to ~117 — a too-shallow read makes startMonth's rewires silently skip.
export const FULL_GRID_READ = "A1:R160";
```

Replace the three usages (`addLunch` line ~670, `monthSummary` line ~758, `startMonth` lines ~892–893) and the error message in `findLunchSection` (line ~187).

In `startMonth`'s delete loop (line ~1074), widen the scope and fix the comment:

```ts
		// Bottom-up so earlier deletions don't shift later indices. Scoped to A–G
		// (the expense row includes the 支付方式 cell): a whole-row delete would
		// rip through the 乾坤大挪移 / 午餐預算 / 信用卡 sections (H–R) that
		// share these sheet rows; references across the column boundary adjust
		// on their own in both directions.
					endColumnIndex: MONTH_COLS.paidMethod + 1,
```

`src/tools.ts`: in the add_transfer description change "columns G-M" → "columns H-N"; in the add_lunch description change "columns O-Q" → "columns P-R".

- [ ] **Step 4: Run the tests and type-check**

Run: `bun run test && bun run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts src/finance-ops.ts src/tools.ts test/finance-ops.test.ts test/conventions.test.ts
git commit -m "fix: shift section columns for the new 支付方式 column G (乾坤大挪移 H-N, 午餐預算 P-R)"
```

---

### Task 2: CREDIT_CARDS registry, section labels, addMonthsClamped

**Files:**
- Modify: `src/conventions.ts` (new block after the LUNCH_COLS section, ~line 193)
- Test: `test/conventions.test.ts`

**Interfaces:**
- Consumes: `dateSerial` (existing, conventions.ts:195).
- Produces (all exported from `src/conventions.ts`): `interface CreditCard { name: string; billingCurrency: "USD" | "TWD"; statementLag: 0 | 1 }`; `CREDIT_CARDS: readonly CreditCard[]`; `CREDIT_SECTION_LABEL`, `CREDIT_CLOSE_LABEL`, `CREDIT_PAY_LABEL`, `CREDIT_BILL_TOTAL_LABEL`, `CREDIT_DUE_LABEL`, `CREDIT_PRE_LABEL`, `CREDIT_POST_LABEL`, `CREDIT_SUBTOTAL_LABEL` (strings); `CREDIT_BLOCK_COLS = [7, 11]`, `CREDIT_BLOCK_WIDTH = 3`; `addMonthsClamped(serial: number, months: number): number`.

- [ ] **Step 1: Write the failing tests**

Add to `test/conventions.test.ts` (extend the import from `../src/conventions` with `CREDIT_CARDS`, `CREDIT_SECTION_LABEL`, `CREDIT_BLOCK_COLS`, `CREDIT_BLOCK_WIDTH`, `addMonthsClamped`; `dateSerial` is already imported):

```ts
	it("exports the 信用卡帳單對帳區 registry and block geometry", () => {
		expect(CREDIT_SECTION_LABEL).toBe("信用卡帳單對帳區");
		expect(CREDIT_CARDS.map((c) => c.name)).toEqual([
			"國泰 CUBE",
			"CHASE Amazon",
			"CHASE Freedom Unlimited",
			"Apple Card",
		]);
		// 國泰 CUBE bills TWD; the US cards bill USD.
		expect(CREDIT_CARDS.filter((c) => c.billingCurrency === "TWD").map((c) => c.name)).toEqual(["國泰 CUBE"]);
		// Only CHASE Amazon's 繳款日 pays the statement closed the SAME month.
		expect(CREDIT_CARDS.filter((c) => c.statementLag === 0).map((c) => c.name)).toEqual(["CHASE Amazon"]);
		expect(CREDIT_BLOCK_COLS).toEqual([7, 11]); // H and L
		expect(CREDIT_BLOCK_WIDTH).toBe(3);
	});

	it("addMonthsClamped bumps a serial by months, clamping the day and wrapping the year", () => {
		expect(addMonthsClamped(dateSerial(2026, 7, 19), 1)).toBe(dateSerial(2026, 8, 19));
		expect(addMonthsClamped(dateSerial(2026, 7, 31), 1)).toBe(dateSerial(2026, 8, 31));
		expect(addMonthsClamped(dateSerial(2026, 8, 31), 1)).toBe(dateSerial(2026, 9, 30));
		expect(addMonthsClamped(dateSerial(2026, 1, 31), 1)).toBe(dateSerial(2026, 2, 28));
		expect(addMonthsClamped(dateSerial(2026, 12, 15), 1)).toBe(dateSerial(2027, 1, 15));
	});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test test/conventions.test.ts`
Expected: FAIL — `CREDIT_CARDS` has no exported member.

- [ ] **Step 3: Implement in `src/conventions.ts`** (after the LUNCH_COLS block, before `dateSerial`)

```ts
/**
 * 信用卡帳單對帳區 — per-card statement reconciliation blocks in a 2×2 grid
 * (columns H–J and L–N) below the 乾坤大挪移 block, from 7月 2026 on. Each
 * block: card name, 本月結帳日/本月繳款日 dates, 本期帳單總額 (the statement
 * that CLOSED this month = prev tab's 結帳日後小計 + this tab's 結帳日前小計),
 * 本月需繳 (per statementLag), then 結帳日前/結帳日後 buckets whose 小計
 * SUMIFS and row FILTERs key on the expense list's 支付方式 column (G) and
 * 日期 vs 結帳日. Everything except the two date cells is formula-owned.
 */
export interface CreditCard {
	/** Exact string used in column G, the block title, and the FILTER/SUMIFS conditions. */
	name: string;
	/** Which expense column the card's statements bill in: USD → D (美金), TWD → E (新臺幣). */
	billingCurrency: "USD" | "TWD";
	/** Which 本期帳單總額 this month's 繳款日 pays: 0 = this tab's (closed this month), 1 = the previous tab's. */
	statementLag: 0 | 1;
}

export const CREDIT_CARDS: readonly CreditCard[] = [
	{ name: "國泰 CUBE", billingCurrency: "TWD", statementLag: 1 },
	{ name: "CHASE Amazon", billingCurrency: "USD", statementLag: 0 },
	{ name: "CHASE Freedom Unlimited", billingCurrency: "USD", statementLag: 1 },
	{ name: "Apple Card", billingCurrency: "USD", statementLag: 1 },
];

export const CREDIT_SECTION_LABEL = "信用卡帳單對帳區";
export const CREDIT_CLOSE_LABEL = "本月結帳日";
export const CREDIT_PAY_LABEL = "本月繳款日";
export const CREDIT_BILL_TOTAL_LABEL = "本期帳單總額";
export const CREDIT_DUE_LABEL = "本月需繳";
export const CREDIT_PRE_LABEL = "結帳日前";
export const CREDIT_POST_LABEL = "結帳日後";
export const CREDIT_SUBTOTAL_LABEL = "小計";
/** 0-indexed start columns of the two block columns in the 2×2 card grid (H and L). */
export const CREDIT_BLOCK_COLS = [7, 11] as const;
/** A block is 3 columns wide: labels/日期, 項目, values/金額. */
export const CREDIT_BLOCK_WIDTH = 3;

/** Serial date + N months, day clamped to the target month's length (7/31 → 8/31 → 9/30). */
export function addMonthsClamped(serial: number, months: number): number {
	const d = new Date(serial * 86_400_000 + Date.UTC(1899, 11, 30));
	const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0)).getUTCDate();
	const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, Math.min(d.getUTCDate(), lastDay));
	return Math.round((t - Date.UTC(1899, 11, 30)) / 86_400_000);
}
```

- [ ] **Step 4: Run tests and type-check**

Run: `bun run test test/conventions.test.ts && bun run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts test/conventions.test.ts
git commit -m "feat: CREDIT_CARDS registry, 對帳區 labels, addMonthsClamped"
```

---

### Task 3: add_expense learns `card` (writes 支付方式, column G)

**Files:**
- Modify: `src/finance-ops.ts:409-510` (AddExpenseParams + addExpense)
- Modify: `src/tools.ts:132-168` (add_expense tool schema)
- Test: `test/finance-ops.test.ts` (`describe("addExpense")`)

**Interfaces:**
- Consumes: `CREDIT_CARDS` from Task 2 (add to the conventions import in finance-ops.ts).
- Produces: `AddExpenseParams.card?: string`; the tool param `card` (snake-case not needed — one word); addExpense return gains `card: string | null`. Rules: unknown card → throw listing valid names; USD-billed card requires `currency === "USD"`; when `card` is set and `paid_with` omitted, 支付幣別 defaults to the card's `billingCurrency` (not to `currency`).

- [ ] **Step 1: Write the failing tests** (inside `describe("addExpense")`)

```ts
	it("writes the card into 支付方式 (G) and defaults 支付幣別 to the card's billing currency", async () => {
		const client = fakeClient(monthGrid());
		await addExpense(client, { item: "Kindle 書", amount: 12.99, currency: "USD", month: 9, card: "CHASE Amazon" });
		const write = ((client.batchUpdate as any).mock.calls[0][0]).find((r: any) => r.updateCells);
		// B..G = item, 類別, 美金, 新臺幣, 支付幣別, 支付方式
		expect(write.updateCells.rows[0].values).toHaveLength(6);
		expect(write.updateCells.rows[0].values[4]).toEqual({ userEnteredValue: { stringValue: "USD" } });
		expect(write.updateCells.rows[0].values[5]).toEqual({ userEnteredValue: { stringValue: "CHASE Amazon" } });
	});

	it("a USD-priced expense on the TWD-billed 國泰 CUBE pays from the TWD account by default", async () => {
		const client = fakeClient(monthGrid());
		const result = await addExpense(client, { item: "Steam 遊戲", amount: 20, currency: "USD", month: 9, card: "國泰 CUBE" });
		expect(result.paidWith).toBe("TWD");
		const write = ((client.batchUpdate as any).mock.calls[0][0]).find((r: any) => r.updateCells);
		expect(write.updateCells.rows[0].values[4]).toEqual({ userEnteredValue: { stringValue: "TWD" } });
		expect(write.updateCells.rows[0].values[5]).toEqual({ userEnteredValue: { stringValue: "國泰 CUBE" } });
	});

	it("rejects an unknown card before any read or write", async () => {
		const client = fakeClient(monthGrid());
		await expect(
			addExpense(client, { item: "x", amount: 1, currency: "TWD", month: 9, card: "玉山 Ubear" }),
		).rejects.toThrow("國泰 CUBE"); // the error lists the valid names
		expect((client.readRange as any).mock.calls.length).toBe(0);
	});

	it("rejects a TWD-priced row on a USD-billed card (its 對帳區 pulls column D, blank on TWD rows)", async () => {
		const client = fakeClient(monthGrid());
		await expect(
			addExpense(client, { item: "x", amount: 100, currency: "TWD", month: 9, card: "Apple Card" }),
		).rejects.toThrow("USD");
		expect((client.readRange as any).mock.calls.length).toBe(0);
	});

	it("leaves 支付方式 untouched when card is omitted", async () => {
		const client = fakeClient(monthGrid());
		await addExpense(client, { item: "咖啡", amount: 55, currency: "TWD", month: 9 });
		const write = ((client.batchUpdate as any).mock.calls[0][0]).find((r: any) => r.updateCells);
		expect(write.updateCells.rows[0].values[5]).toEqual({}); // cellData(null)
	});
```

Note: existing addExpense tests assert `rows[0].values` arrays of length 5 — they now get a 6th `{}` element. Update those assertions (append `{}` / re-run to find them).

- [ ] **Step 2: Run to verify failure**

Run: `bun run test test/finance-ops.test.ts -t addExpense`
Expected: FAIL — `card` not a known param / values length 5.

- [ ] **Step 3: Implement**

`src/finance-ops.ts` — add `CREDIT_CARDS` to the conventions import. Extend the interface:

```ts
	/** Which real account paid the row (支付幣別, column F); defaults to the card's billing currency when `card` is set, else to `currency`. */
	paidWith?: "TWD" | "USD";
	/** Credit card that charged the row (支付方式, column G) — must be a CREDIT_CARDS name; omitted = cash/transfer, cell untouched. */
	card?: string;
```

At the top of `addExpense` (before the existing TWD/USD-paid check, replacing the `paidWith` default line):

```ts
	const card = p.card !== undefined ? CREDIT_CARDS.find((c) => c.name === p.card) : undefined;
	if (p.card !== undefined && card === undefined) {
		throw new Error(
			`Unknown card "${p.card}" — the 支付方式 column recognizes: ${CREDIT_CARDS.map((c) => c.name).join(", ")}.`,
		);
	}
	if (card !== undefined && card.billingCurrency === "USD" && p.currency !== "USD") {
		throw new Error(
			`${card.name} bills in USD and its 對帳區 buckets pull the 美金 column (D), which is blank on TWD-priced rows — log the expense in USD.`,
		);
	}
	const paidWith = p.paidWith ?? card?.billingCurrency ?? p.currency;
```

Append the G cell to both `rowCells` branches (line ~466-469): add `, cellData(p.card ?? null)` as the last element of each array. Add `card: p.card ?? null,` to the return object.

`src/tools.ts` — add to the add_expense schema after `paid_with`:

```ts
			card: z
				.string()
				.min(1)
				.optional()
				.describe(
					"Credit card that charged the row — written to the 支付方式 column (G); the 信用卡帳單對帳區 FILTERs mirror the row into the card's statement bucket (dated rows only). One of: 國泰 CUBE, CHASE Amazon, CHASE Freedom Unlimited, Apple Card. Omit for cash/bank-transfer rows. Sets 支付幣別 to the card's billing currency unless paid_with is given.",
				),
```

(`card` flows through the existing `...p` spread in the handler — no handler change.)

- [ ] **Step 4: Run tests and type-check**

Run: `bun run test && bun run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts src/tools.ts test/finance-ops.test.ts
git commit -m "feat: add_expense card param writes 支付方式 (G), validated against CREDIT_CARDS"
```

---

### Task 4: findCreditSection finder + creditGrid fixture

**Files:**
- Modify: `src/finance-ops.ts` (new finder after `findLunchSection`, ~line 218)
- Test: `test/finance-ops.test.ts` (new fixture + `describe("findCreditSection")`)

**Interfaces:**
- Consumes: `CREDIT_CARDS`, `CREDIT_SECTION_LABEL`, `CREDIT_CLOSE_LABEL`, `CREDIT_PAY_LABEL`, `CREDIT_BILL_TOTAL_LABEL`, `CREDIT_DUE_LABEL`, `CREDIT_PRE_LABEL`, `CREDIT_POST_LABEL`, `CREDIT_BLOCK_COLS` (Task 2); `FULL_GRID_READ` (Task 1).
- Produces: `interface CreditCardBlock { card: CreditCard; titleRow: number; startCol: number; closeDateRow: number; payDateRow: number; billTotalRow: number; dueRow: number; preSubtotalRow: number; postSubtotalRow: number }` and `findCreditSection(values: unknown[][], tab: string): CreditCardBlock[]` — throws when the section anchor is absent or a found card block is malformed; registry cards absent from the sheet are skipped. Task 5 consumes both.

- [ ] **Step 1: Write the fixture and failing tests**

Add after `lunchGrid()` in `test/finance-ops.test.ts` (extend the conventions import with `dateSerial`):

```ts
/**
 * lunchGrid + a 信用卡帳單對帳區 (anchor H40) with two card blocks:
 * 國泰 CUBE at H41 (values in J, lag 1) and CHASE Amazon at L41 (values in N,
 * lag 0). Rows: title 41, 結帳日 42, 繳款日 43, 本期帳單總額 44, 本月需繳 45,
 * 結帳日前+小計 46, header 47, cushion 48-49, 結帳日後+小計 50, header 51.
 */
function creditGrid(): unknown[][] {
	const g = lunchGrid();
	const put = (idx: number, col: number, v: unknown) => {
		(g[idx] ??= [])[col] = v;
	};
	put(39, 7, "信用卡帳單對帳區");
	// 國泰 CUBE — H/I/J (7/8/9)
	put(40, 7, "國泰 CUBE");
	put(41, 7, "本月結帳日");
	put(41, 9, dateSerial(2026, 7, 19));
	put(42, 7, "本月繳款日");
	put(42, 9, dateSerial(2026, 7, 6));
	put(43, 7, "本期帳單總額");
	put(43, 9, "=0+J46");
	put(44, 7, "本月需繳");
	put(44, 9, 21500);
	put(45, 7, "結帳日前");
	put(45, 9, '=SUMIFS(E3:E,G3:G,"國泰 CUBE",A3:A,"<="&J42,A3:A,">0")');
	put(46, 7, "日期");
	put(46, 8, "項目");
	put(46, 9, "金額");
	put(49, 7, "結帳日後");
	put(49, 9, '=SUMIFS(E3:E,G3:G,"國泰 CUBE",A3:A,">"&J42)');
	put(50, 7, "日期");
	put(50, 8, "項目");
	put(50, 9, "金額");
	// CHASE Amazon — L/M/N (11/12/13)
	put(40, 11, "CHASE Amazon");
	put(41, 11, "本月結帳日");
	put(41, 13, dateSerial(2026, 7, 3));
	put(42, 11, "本月繳款日");
	put(42, 13, dateSerial(2026, 7, 28));
	put(43, 11, "本期帳單總額");
	put(43, 13, "=0+N46");
	put(44, 11, "本月需繳");
	put(44, 13, "=N44");
	put(45, 11, "結帳日前");
	put(45, 13, '=SUMIFS(D3:D,G3:G,"CHASE Amazon",A3:A,"<="&N42,A3:A,">0")');
	put(46, 11, "日期");
	put(46, 12, "項目");
	put(46, 13, "金額");
	put(49, 11, "結帳日後");
	put(49, 13, '=SUMIFS(D3:D,G3:G,"CHASE Amazon",A3:A,">"&N42)');
	put(50, 11, "日期");
	put(50, 12, "項目");
	put(50, 13, "金額");
	return g;
}
```

And the tests (import `findCreditSection` from `../src/finance-ops`):

```ts
describe("findCreditSection", () => {
	it("locates every card block present, skipping registry cards missing from the sheet", () => {
		const blocks = findCreditSection(creditGrid(), "9 月");
		expect(blocks.map((b) => [b.card.name, b.startCol])).toEqual([
			["國泰 CUBE", 7],
			["CHASE Amazon", 11],
		]);
		expect(blocks[0]).toMatchObject({
			titleRow: 41,
			closeDateRow: 42,
			payDateRow: 43,
			billTotalRow: 44,
			dueRow: 45,
			preSubtotalRow: 46,
			postSubtotalRow: 50,
		});
		expect(blocks[1]).toMatchObject({ titleRow: 41, startCol: 11, postSubtotalRow: 50 });
	});

	it("throws when the tab has no 信用卡帳單對帳區", () => {
		expect(() => findCreditSection(lunchGrid(), "6 月")).toThrow("信用卡帳單對帳區");
	});

	it("throws naming the card and the missing label when a block is torn", () => {
		const g = creditGrid();
		(g[44] as unknown[])[7] = ""; // CUBE loses its 本月需繳 label
		expect(() => findCreditSection(g, "9 月")).toThrow(/國泰 CUBE.*本月需繳/);
	});

	it("never adopts a label from the next card block stacked below in the same column", () => {
		const g = creditGrid();
		(g[49] as unknown[])[7] = ""; // CUBE loses 結帳日後...
		(g[52] ??= [])[7] = "CHASE Freedom Unlimited"; // ...and Freedom's block starts below
		(g[53] ??= [])[7] = "本月結帳日";
		expect(() => findCreditSection(g, "9 月")).toThrow(/國泰 CUBE.*結帳日後/);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test test/finance-ops.test.ts -t findCreditSection`
Expected: FAIL — `findCreditSection` is not exported.

- [ ] **Step 3: Implement in `src/finance-ops.ts`** (after `findLunchSection`; extend the conventions import with the CREDIT_* names and `CreditCard`, `addMonthsClamped` — the latter used in Task 5)

```ts
export interface CreditCardBlock {
	card: CreditCard;
	/** 1-indexed row of the card-name title cell. */
	titleRow: number;
	/** 0-indexed column of the title — the block's first column (H or L). */
	startCol: number;
	closeDateRow: number;
	payDateRow: number;
	billTotalRow: number;
	dueRow: number;
	/** Rows of the 結帳日前 / 結帳日後 labels — each holds its bucket's 小計 in the block's value column. */
	preSubtotalRow: number;
	postSubtotalRow: number;
}

/**
 * Locate the 信用卡帳單對帳區 card blocks (grid of FULL_GRID_READ). Returns
 * a block per CREDIT_CARDS entry present on the sheet, in registry order;
 * registry cards absent from the sheet are skipped (the section is
 * hand-maintained). Throws when the section anchor is missing, or when a
 * found card's block lacks one of its label rows — a label scan never runs
 * past the next card title stacked below in the same column.
 */
export function findCreditSection(values: unknown[][], tab: string): CreditCardBlock[] {
	const anchorRow = findRowByValue(values, CREDIT_BLOCK_COLS[0], CREDIT_SECTION_LABEL);
	if (anchorRow === null) {
		throw new Error(
			`No ${CREDIT_SECTION_LABEL} section in ${tab} (searched column ${colLetter(CREDIT_BLOCK_COLS[0])} of ${FULL_GRID_READ}) — the card blocks exist from 7月 2026 on.`,
		);
	}
	const cellStr = (r: number, c: number) => String(values[r - 1]?.[c] ?? "").trim();
	const cardNames = new Set(CREDIT_CARDS.map((c) => c.name));
	const blocks: CreditCardBlock[] = [];
	for (const card of CREDIT_CARDS) {
		let titleRow: number | null = null;
		let startCol = CREDIT_BLOCK_COLS[0] as number;
		for (const col of CREDIT_BLOCK_COLS) {
			for (let r = anchorRow + 1; r <= values.length; r++) {
				if (cellStr(r, col) === card.name) {
					titleRow = r;
					startCol = col;
					break;
				}
			}
			if (titleRow !== null) break;
		}
		if (titleRow === null) continue;
		const labelRow = (label: string, after: number): number => {
			for (let r = after + 1; r <= values.length; r++) {
				const v = cellStr(r, startCol);
				if (v === label) return r;
				if (cardNames.has(v)) break; // ran into the next card block stacked below
			}
			throw new Error(`The "${card.name}" block in ${tab} is missing its ${label} row.`);
		};
		const closeDateRow = labelRow(CREDIT_CLOSE_LABEL, titleRow);
		const payDateRow = labelRow(CREDIT_PAY_LABEL, closeDateRow);
		const billTotalRow = labelRow(CREDIT_BILL_TOTAL_LABEL, payDateRow);
		const dueRow = labelRow(CREDIT_DUE_LABEL, billTotalRow);
		const preSubtotalRow = labelRow(CREDIT_PRE_LABEL, dueRow);
		const postSubtotalRow = labelRow(CREDIT_POST_LABEL, preSubtotalRow);
		blocks.push({ card, titleRow, startCol, closeDateRow, payDateRow, billTotalRow, dueRow, preSubtotalRow, postSubtotalRow });
	}
	return blocks;
}
```

- [ ] **Step 4: Run tests and type-check**

Run: `bun run test && bun run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: findCreditSection locates the 對帳區 card blocks"
```

---

### Task 5: startMonth rolls the 對帳區 forward

**Files:**
- Modify: `src/finance-ops.ts:873-1083` (startMonth)
- Modify: `src/tools.ts:214-225` (start_month description)
- Test: `test/finance-ops.test.ts` (`describe("startMonth")`)

**Interfaces:**
- Consumes: `findCreditSection`/`CreditCardBlock` (Task 4), `addMonthsClamped`, `CREDIT_BLOCK_COLS`, `CREDIT_BLOCK_WIDTH`, `CREDIT_SECTION_LABEL` (Task 2).
- Produces: startMonth's return gains `creditRebuilt: string[]` (card names whose block was rewired) and `creditWarning?: string`.

- [ ] **Step 1: Write the failing tests** (inside `describe("startMonth")`)

```ts
	it("bumps each card's 結帳日/繳款日 one month and rebuilds 本期帳單總額/本月需繳 per statementLag", async () => {
		const client = startMonthClient(creditGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		const at = (rowIndex: number, columnIndex: number) =>
			requests.find(
				(r: any) => r.updateCells && r.updateCells.start.rowIndex === rowIndex && r.updateCells.start.columnIndex === columnIndex,
			);
		// 國泰 CUBE (values in J = column 9): dates bumped 7/19→8/19, 7/6→8/6.
		expect(at(41, 9).updateCells.rows[0].values).toEqual([{ userEnteredValue: { numberValue: dateSerial(2026, 8, 19) } }]);
		expect(at(42, 9).updateCells.rows[0].values).toEqual([{ userEnteredValue: { numberValue: dateSerial(2026, 8, 6) } }]);
		// 本期帳單總額 = prev tab's 結帳日後小計 (J50) + this tab's 結帳日前小計 (J46).
		expect(at(43, 9).updateCells.rows[0].values).toEqual([{ userEnteredValue: { formulaValue: "='9 月'!J50+J46" } }]);
		// lag 1: 本月需繳 = the PREVIOUS tab's 本期帳單總額.
		expect(at(44, 9).updateCells.rows[0].values).toEqual([{ userEnteredValue: { formulaValue: "='9 月'!J44" } }]);
		// CHASE Amazon (values in N = column 13), lag 0: 本月需繳 = this tab's 本期帳單總額.
		expect(at(43, 13).updateCells.rows[0].values).toEqual([{ userEnteredValue: { formulaValue: "='9 月'!N50+N46" } }]);
		expect(at(44, 13).updateCells.rows[0].values).toEqual([{ userEnteredValue: { formulaValue: "=N44" } }]);
		expect(result.creditRebuilt).toEqual(["國泰 CUBE", "CHASE Amazon"]);
		expect(result.creditWarning).toBeUndefined();
	});

	it("skips the credit rebuild silently on tabs without the section", async () => {
		const client = startMonthClient(lunchGrid(), ["9 月", "8 月"]);
		const result = await startMonth(client, 10);
		expect(result.creditRebuilt).toEqual([]);
		expect(result.creditWarning).toBeUndefined();
	});

	it("surfaces a torn credit block as a warning instead of failing the month-open", async () => {
		const g = creditGrid();
		(g[44] as unknown[])[7] = ""; // CUBE loses 本月需繳
		const client = startMonthClient(g, ["9 月", "8 月"]);
		const result = await startMonth(client, 10);
		expect(result.creditRebuilt).toEqual([]);
		expect(result.creditWarning).toMatch(/國泰 CUBE.*本月需繳/);
	});
```

Also add `creditRebuilt: []` to the full-result `toEqual` expectation in the first startMonth test ("duplicates the previous month…", line ~945).

- [ ] **Step 2: Run to verify failure**

Run: `bun run test test/finance-ops.test.ts -t startMonth`
Expected: FAIL — `creditRebuilt` undefined.

- [ ] **Step 3: Implement in `startMonth`** (insert after the lunch-clear block, before the kept/cleared loop, ~line 1035)

```ts
	// The 信用卡帳單對帳區 rolls forward: bump each card's 結帳日/繳款日 one
	// month and rebuild 本期帳單總額 / 本月需繳 against the month just ended.
	// The buckets' FILTER/小計 formulas are same-tab references and survive
	// duplication untouched. The new tab is a duplicate, so prev-tab row
	// numbers equal this grid's. Same fail-soft contract as the lunch clear —
	// duplicateSheet has already committed, so a torn section surfaces a
	// warning instead of throwing; pre-section tabs skip silently.
	const creditRebuilt: string[] = [];
	let creditWarning: string | undefined;
	if (findRowByValue(values, CREDIT_BLOCK_COLS[0], CREDIT_SECTION_LABEL) !== null) {
		try {
			for (const block of findCreditSection(values, newTab)) {
				const valueCol = block.startCol + CREDIT_BLOCK_WIDTH - 1;
				const col = colLetter(valueCol);
				const write = (row: number, value: string | number) => {
					requests.push({
						updateCells: {
							start: { sheetId, rowIndex: row - 1, columnIndex: valueCol },
							rows: [{ values: [cellData(value)] }],
							fields: "userEnteredValue",
						},
					});
				};
				for (const row of [block.closeDateRow, block.payDateRow]) {
					const serial = values[row - 1]?.[valueCol];
					if (typeof serial === "number") write(row, addMonthsClamped(serial, 1));
				}
				write(block.billTotalRow, `=${quoteTab(prevTab)}!${col}${block.postSubtotalRow}+${col}${block.preSubtotalRow}`);
				write(
					block.dueRow,
					block.card.statementLag === 0
						? `=${col}${block.billTotalRow}`
						: `=${quoteTab(prevTab)}!${col}${block.billTotalRow}`,
				);
				creditRebuilt.push(block.card.name);
			}
		} catch (err) {
			creditWarning = err instanceof Error ? err.message : String(err);
		}
	}
```

Update the return:

```ts
	return { tab: newTab, duplicatedFrom: prevTab, kept, cleared, clearedIncomes, lunchCleared, lunchWarning, creditRebuilt, creditWarning };
```

(The credit writes target columns H+ (indices ≥ 9); the A–G-scoped `deleteRange`s appended later never shift those cells, so the pre-computed row indices stay valid — same argument as the lunch `repeatCell`.)

`src/tools.ts` start_month description — append before "Refuses if the tab already exists.":

```
rolls the 信用卡帳單對帳區 forward (結帳日/繳款日 +1 month, 本期帳單總額/本月需繳 rewired to the month just ended),
```

- [ ] **Step 4: Run tests and type-check**

Run: `bun run test && bun run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts src/tools.ts test/finance-ops.test.ts
git commit -m "feat: start_month rolls the 信用卡帳單對帳區 forward"
```

---

### Task 6: CONVENTIONS_TEXT + README

**Files:**
- Modify: `src/conventions.ts:256-279` (CONVENTIONS_TEXT)
- Modify: `README.md` (tools list: add_expense line)
- Test: `test/conventions.test.ts:181-217` (needles)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add failing needle assertions** to the "conventions text mentions the anchors Claude needs" test's needle list:

```ts
			"信用卡帳單對帳區",
			"支付方式",
			"本期帳單總額",
			"本月需繳",
			"結帳日前",
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test test/conventions.test.ts`
Expected: FAIL — CONVENTIONS_TEXT lacks 信用卡帳單對帳區.

- [ ] **Step 3: Update CONVENTIONS_TEXT** in `src/conventions.ts`:

1. Header-row bullet: `Header row 2: 日期 項目 類別 美金 新臺幣 支付幣別` → `Header row 2: 日期 項目 類別 美金 新臺幣 支付幣別 支付方式`, expense list `columns A-F` → `columns A-G`, and append to that bullet: `G=支付方式 (the credit card that charged the row — exactly 國泰 CUBE, CHASE Amazon, CHASE Freedom Unlimited, or Apple Card; blank for cash/transfer rows).`
2. Transfer bullet: `spans columns G-M: the title in G` → `spans columns H-N: the title in H`.
3. Lunch bullet: `(columns O-Q, …)` → `(columns P-R, …)`, `Title in O` → `Title in P`, `label in P, =SUM in Q` → `label in Q, =SUM in R`.
4. New bullet after the lunch bullet:

```
- Below the 乾坤大挪移 block, from row 50 down, the 信用卡帳單對帳區 (from 7月 2026 on) holds one reconciliation block per credit card in a 2×2 grid (columns H-J and L-N): 國泰 CUBE (bills TWD), CHASE Amazon, CHASE Freedom Unlimited, Apple Card (bill USD). Each block: the card name, 本月結帳日 / 本月繳款日 (the only hand-owned cells; start_month bumps them one month), 本期帳單總額 (the statement that CLOSED this month = previous tab's 結帳日後小計 + this tab's 結帳日前小計), 本月需繳 (what this month's 繳款日 pays — this tab's 本期帳單總額 for CHASE Amazon, the PREVIOUS tab's for the other three), then 結帳日前 and 結帳日後 buckets, each with a SUMIFS 小計 and a FILTER that mirrors matching expense rows (日期/項目/金額). The FILTERs key on 支付方式 (column G, exact card name) and require a real 日期 — a dateless subscription row joins its bucket the moment its date is filled in; 金額 pulls the card's billing-currency column (D for the US cards, E for 國泰 CUBE). Never hand-edit the FILTER spill, 小計, 本期帳單總額, or 本月需繳 — log card expenses with add_expense and its card param. 7月 bootstraps by hand: its previous-month halves are typed-in numbers (6月 has no section).
```

(The closing "Prefer the tailored tools" line already names add_expense — no change.)

Update `README.md`'s add_expense bullet: `**add_expense** — log an expense into a monthly tab (defaults to the current month).` → `**add_expense** — log an expense into a monthly tab (defaults to the current month); a card param routes it into the 信用卡帳單對帳區.`

- [ ] **Step 4: Run tests and type-check**

Run: `bun run test && bun run type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts test/conventions.test.ts README.md
git commit -m "docs: conventions cover the 信用卡帳單對帳區 and 支付方式 column"
```

---

### Task 7: Rebuild the 7月 blocks on the sheet + 8月/9月 geometry check

**This task writes to the PRODUCTION sheet through the connected sheets-mcp tools. Get Vincent's explicit go-ahead before Step 3 (the destructive rewrite), and paste him the `previousValues` from every update_range response so any step can be reverted.**

**Files:** none (sheet work). Prereq: Tasks 1–6 merged or at least locally complete (the formulas below must match the registry).

- [ ] **Step 1: Check 8月/9月 geometry**

`list_tabs`; for each of `8 月` / `9 月` that exists, `read_range` `'8 月'!A2:H2`. If G2 is not `支付方式`, the tab still has the old column layout (a column insert only applied to 7月). No MCP tool inserts columns, so ask Vincent to do ONE of, in the Sheets UI:
- insert a blank column G on each stale tab (right-click column G → 左方插入 1 欄, then type 支付方式 in G2), or
- delete the pre-created 8月/9月 tabs entirely if they hold nothing hand-entered (check with `read_range` first and show him what's there) — start_month will recreate them from 7月 with the section included, which is also the only way they GAIN the 對帳區 without hand-copying.

Recommend the delete-and-recreate path if the tabs are pristine; hand-copying the 對帳區 into existing tabs is not covered by this plan.

- [ ] **Step 2: Record the current 對帳區** — `read_range` `'7 月'!H48:N120` (mode `formulas`) and keep the output in the conversation as the revert reference. The card dates to preserve: 國泰 CUBE 結帳 7/19 繳款 7/6; CHASE Amazon 結帳 7/3 繳款 7/28; CHASE Freedom Unlimited 結帳 7/10 繳款 7/13; Apple Card 結帳 7/31 繳款 7/31.

- [ ] **Step 3 (needs go-ahead): Clear H50:N120** — `update_range` with range `'7 月'!H50:N120` and values = a 71-row × 7-column matrix of `""`. This wipes the old block layout (labels at mismatched offsets would confuse the finder). The response's `previousValues` is the undo copy.

- [ ] **Step 4: Write the new blocks.** Layout per block (title row T): T title, T+1 本月結帳日, T+2 本月繳款日, T+3 本期帳單總額, T+4 本月需繳, T+5 結帳日前+小計, T+6 日期/項目/金額 header, T+7…T+18 cushion (12 rows), T+19 結帳日後+小計, T+20 header, T+21…T+32 cushion. Tops: row 51 (國泰 CUBE at H, CHASE Amazon at L) and row 85 (CHASE Freedom Unlimited at H, Apple Card at L).

`update_range` `'7 月'!H50` = `信用卡帳單對帳區`, then per block two label-region writes and two FILTER cells (all `expect_empty: true` — the region was just cleared). 國泰 CUBE (H51:J57):

| cell | value |
|------|-------|
| H51 | `國泰 CUBE` |
| H52 / J52 | `本月結帳日` / `2026/7/19` |
| H53 / J53 | `本月繳款日` / `2026/7/6` |
| H54 / J54 | `本期帳單總額` / `=0+J56` |
| H55 / J55 | `本月需繳` / *(leave empty — Vincent types July's real bill)* |
| H56 / J56 | `結帳日前` / `=SUMIFS(E3:E,G3:G,"國泰 CUBE",A3:A,"<="&J52,A3:A,">0")` |
| H57:J57 | `日期` `項目` `金額` |
| H58 | `=IFERROR(FILTER({A3:A,B3:B,E3:E},G3:G="國泰 CUBE",A3:A<>"",A3:A<=J52),)` |
| H70 / J70 | `結帳日後` / `=SUMIFS(E3:E,G3:G,"國泰 CUBE",A3:A,">"&J52)` |
| H71:J71 | `日期` `項目` `金額` |
| H72 | `=IFERROR(FILTER({A3:A,B3:B,E3:E},G3:G="國泰 CUBE",A3:A>J52),)` |

CHASE Amazon: same shape at L51:N72 with letters L/N, dates `2026/7/3` / `2026/7/28`, amount column **D** in the SUMIFS/FILTERs (`{A3:A,B3:B,D3:D}` and `D3:D`), card string `CHASE Amazon`, and — lag 0 — `N55` = `=N54`.
CHASE Freedom Unlimited: at H85:J106 (H85 title, J86 `2026/7/10`, J87 `2026/7/13`, J88 `=0+J90`, J89 empty, J90/J104 SUMIFS on D, H92/H106 FILTERs on D, all `J86`-anchored). Apple Card: at L85:N106 (N86 `2026/7/31`, N87 `2026/7/31`, N88 `=0+N90`, N89 empty, D-column formulas, `N86`-anchored).

The `=0+…` shape marks where Vincent替換 the `0` with the June-statement tail (June 結帳日後 spending per card) — 6月 has no section to reference.

- [ ] **Step 5: Smoke test.** Ask Vincent for (or pick from his next real purchases) one dated card expense; log it with `add_expense` (card + date). Then `read_range` `'7 月'!H56:N72` and verify: the row appears in the right card's 結帳日前 or 結帳日後 spill, the bucket 小計 equals the row amount, 本期帳單總額 moved. Also verify a dateless recurring row with G filled does NOT appear.

- [ ] **Step 6: Wire the recurring subscriptions.** With Vincent, fill column G on the recurring rows that live on cards (Netflix, ChatGPT, Claude, iCloud, …, per his card statements) — `update_range` on each row's G cell. Leave their dates blank (they join buckets when dated, by design).

- [ ] **Step 7: Deploy.** After the PR merges: `bun run deploy` (Vincent's wrangler auth). Then update the memory files (`credit-card-section` status, lunch/transfer column shift) — done by the session running this task.

---

## Self-Review Notes

- Spec coverage: column sync → Task 1; registry/labels → Task 2; add_expense card → Task 3; finder → Task 4; start_month → Task 5; CONVENTIONS_TEXT → Task 6; sheet rebuild, bootstrap, 8月/9月 check, smoke test → Task 7. month_summary/lunch-card/backfill are out of scope per spec.
- The USD-card-requires-USD-currency validation and the paid_with-defaults-to-billing-currency rule (Task 3) go slightly beyond the spec's one-line add_expense section; they prevent silently blank 金額 cells in the 對帳區 and follow from the registry's billingCurrency semantics.
- Type consistency: `FULL_GRID_READ` (Task 1) is the name used in Tasks 4–5; `CreditCardBlock.preSubtotalRow/postSubtotalRow` (Task 4) are the names startMonth (Task 5) reads; `MONTH_COLS.paidMethod` (Task 1) is what the Task 1 delete-scope and Task 6 docs reference.
