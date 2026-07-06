# Per-currency 透支 carry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the carried overdraft into 上月美金透支 (USD, column D, F=USD) and 上月新臺幣透支 (TWD, column E, F=TWD), each rolling its currency's UNSETTLED deficit (月…餘額+…透支沖銷) from the previous month independently.

**Architecture:** Same three-file pattern as the rest of the repo: labels in `src/conventions.ts`, behavior in `src/finance-ops.ts` (`startMonth` carry rebuild becomes three-way: split layout / degenerate / legacy-unchanged; `monthSummary` gains two fields), thin description tweaks in `src/tools.ts`. Work happens on the EXISTING branch `feat/add-lunch-tool` (PR #12). Spec: `docs/superpowers/specs/2026-07-06-split-overdraft-carry-design.md` — read it first.

**Tech Stack:** TypeScript (Cloudflare Worker), vitest, Google Sheets API batchUpdate. **Use bun**: `bunx vitest run …`, `bun run type-check`.

## Global Constraints

- Indent with TABS. Sheet rows 1-indexed; Sheets API `rowIndex` 0-indexed. `MONTH_COLS.usd` = 3 (D), `MONTH_COLS.twd` = 4 (E), `MONTH_COLS.budgetValue` = 3 (D), `MONTH_COLS.item` = 1 (B), `MONTH_COLS.budgetLabel` = 1 (B).
- Exact labels: `上月美金透支`, `上月新臺幣透支`; the old `上月透支` (`OVERDRAFT_LABEL`) stays for legacy tabs.
- Carry formula shape (exact): `=IF(-(REF1+REF2) > 0, -(REF1+REF2), 0)` where REF = `'9 月'!D18`-style cross-tab cells; legacy shape stays `=IF(-REF > 0, -REF, 0)`.
- The USD carry row's E conversion (`=D{r}*GOOGLEFINANCE("CURRENCY:USDTWD")`) is row-relative and survives duplication — startMonth must NOT rewrite it.
- Everything lands as `feat:` commits on `feat/add-lunch-tool` with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Carry-row labels + conventions text

**Files:**
- Modify: `src/conventions.ts` (labels near line 14, `RECURRING_ITEMS` ~line 69, two `CONVENTIONS_TEXT` bullets)
- Test: `test/conventions.test.ts`

**Interfaces:**
- Produces: `PREV_USD_OVERDRAFT_LABEL: "上月美金透支"`, `PREV_NTD_OVERDRAFT_LABEL: "上月新臺幣透支"` exported from `src/conventions.ts`; both members of `RECURRING_ITEMS`. Tasks 2–3 import them.

- [ ] **Step 1: Write the failing tests**

In `test/conventions.test.ts`: add `PREV_NTD_OVERDRAFT_LABEL, PREV_USD_OVERDRAFT_LABEL` to the `../src/conventions` import (case-insensitive alphabetical position). In the `"knows the recurring items and the total-row anchor"` test, add after the existing loop:

```ts
		expect(RECURRING_ITEMS.has("上月美金透支")).toBe(true);
		expect(RECURRING_ITEMS.has("上月新臺幣透支")).toBe(true);
```

In `"exports the summary row labels"`, add:

```ts
		expect(PREV_USD_OVERDRAFT_LABEL).toBe("上月美金透支");
		expect(PREV_NTD_OVERDRAFT_LABEL).toBe("上月新臺幣透支");
```

In the `"conventions text mentions the anchors Claude needs"` needle array, append: `"上月美金透支"`, `"上月新臺幣透支"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/conventions.test.ts`
Expected: FAIL — no such exports; needles missing.

- [ ] **Step 3: Implement in `src/conventions.ts`**

Directly under `export const OVERDRAFT_LABEL = "上月透支";` add:

```ts
/**
 * Post-split carry rows (from 7月 2026, after backfill): each currency's
 * UNSETTLED deficit from last month — 月…餘額+…透支沖銷, negative exactly
 * when the 沖銷 could not fire — rolls into its own row, independently of
 * the other currency and of 月剩餘. 上月美金透支 carries USD in column D
 * (F=USD, so it debits the USD ledger like any USD row); 上月新臺幣透支
 * carries TWD in column E (F=TWD). Tabs predating the split keep the
 * single TWD 上月透支 row.
 */
export const PREV_USD_OVERDRAFT_LABEL = "上月美金透支";
export const PREV_NTD_OVERDRAFT_LABEL = "上月新臺幣透支";
```

In `RECURRING_ITEMS`, directly after the `OVERDRAFT_LABEL,` entry add:

```ts
	PREV_USD_OVERDRAFT_LABEL,
	PREV_NTD_OVERDRAFT_LABEL,
```

In `CONVENTIONS_TEXT`, replace the bullet

```
- Row 3 "上月透支" carries last month's overdraft via a cross-tab formula; start_month re-anchors it at the previous month's 月剩餘 (or 剩餘 on old-layout tabs).
```

with

```
- Rows 3-4 carry last month's UNSETTLED per-currency overdrafts via cross-tab formulas: 上月美金透支 (USD in D, F=USD, E converts at live GOOGLEFINANCE like any USD row — the carried USD debt debits the USD ledger) and 上月新臺幣透支 (TWD in E, F=TWD), each =IF(-(月…餘額+…透支沖銷) > 0, …) against the previous month. Each currency rolls independently — a USD deficit carries even when 月剩餘 is positive overall. start_month rebuilds both anchors. Tabs predating the split (6月 and earlier, or un-backfilled) have a single TWD 上月透支 row anchored at the previous month's 月剩餘 (or 剩餘 on old-layout tabs).
```

and in the income-section bullet change the phrase `so nothing rolls into next month's 上月透支 unless a bank ledger itself goes negative` to `so nothing rolls into next month's 上月…透支 rows unless a bank ledger itself goes negative`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/conventions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts test/conventions.test.ts
git commit -m "feat: 上月美金透支/上月新臺幣透支 carry-row labels + conventions text"
```

---

### Task 2: startMonth three-way carry rebuild

**Files:**
- Modify: `src/finance-ops.ts` (the carry-rebuild block currently at ~lines 1048–1069, inside `startMonth`; plus the `./conventions` import)
- Modify: `src/tools.ts` (`start_month` description, ~line 149)
- Test: `test/finance-ops.test.ts` (fixtures after `migratedMonthGrid()`; new tests in the `startMonth` describe block)

**Interfaces:**
- Consumes: `PREV_USD_OVERDRAFT_LABEL`, `PREV_NTD_OVERDRAFT_LABEL` (Task 1); already-imported `MONTH_USD_NET_LABEL`, `MONTH_NTD_NET_LABEL`, `USD_WRITEOFF_LABEL`, `NTD_WRITEOFF_LABEL`, `MONTH_REMAINDER_LABEL`, `REMAINDER_LABEL`, `OVERDRAFT_LABEL`.
- Produces: fixtures `splitCarryGrid()` (migrated layout + two carry rows) and `splitCarryOldLayoutGrid()` (old layout + two carry rows) used by Task 3's monthSummary test. No signature changes to `startMonth`.

- [ ] **Step 1: Add the fixtures and failing tests**

In `test/finance-ops.test.ts`, directly after `migratedMonthGrid()` add:

```ts
/** migratedMonthGrid with the split carry: 上月美金透支 (row 3) + 上月新臺幣透支 (row 4); everything below shifts one row down. */
function splitCarryGrid(): unknown[][] {
	const g = migratedMonthGrid();
	g.splice(
		2,
		1,
		["", "上月美金透支", "透支", "=IF(-('8 月'!D17+'8 月'!D18) > 0, -('8 月'!D17+'8 月'!D18), 0)", '=D3*GOOGLEFINANCE("CURRENCY:USDTWD")', "USD"],
		["", "上月新臺幣透支", "透支", "", "=IF(-('8 月'!D19+'8 月'!D20) > 0, -('8 月'!D19+'8 月'!D20), 0)", "TWD"],
	);
	return g;
}

/** Old-layout monthGrid with the split carry rows but no 月 view — the degenerate rebuild case (剩餘 shifts to row 16). */
function splitCarryOldLayoutGrid(): unknown[][] {
	const g = monthGrid();
	g.splice(
		2,
		1,
		["", "上月美金透支", "透支", 0, '=D3*GOOGLEFINANCE("CURRENCY:USDTWD")', "USD"],
		["", "上月新臺幣透支", "透支", "", "=IF(-'8 月'!D15 > 0, -'8 月'!D15, 0)", "TWD"],
	);
	return g;
}
```

In the `startMonth` describe block, add two tests at the end:

```ts
	it("rebuilds both carry rows per currency on the split layout", async () => {
		const client = startMonthClient(splitCarryGrid(), ["9 月", "8 月"]);

		const result = await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		// 上月美金透支 (row 3) D ← the prev month's unsettled USD deficit:
		// 月美金餘額 (row 18) + 美金透支沖銷 (row 19) in the shifted grid.
		const usdWrite = requests.find(
			(r: any) => r.updateCells && r.updateCells.start.rowIndex === 2 && r.updateCells.start.columnIndex === 3,
		);
		expect(usdWrite.updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: "=IF(-('9 月'!D18+'9 月'!D19) > 0, -('9 月'!D18+'9 月'!D19), 0)" } },
		]);
		// 上月新臺幣透支 (row 4) E ← 月新臺幣餘額 (20) + 新臺幣透支沖銷 (21).
		const ntdWrite = requests.find(
			(r: any) => r.updateCells && r.updateCells.start.rowIndex === 3 && r.updateCells.start.columnIndex === 4,
		);
		expect(ntdWrite.updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: "=IF(-('9 月'!D20+'9 月'!D21) > 0, -('9 月'!D20+'9 月'!D21), 0)" } },
		]);
		// Both carry rows are recurring — kept, never deleted.
		expect(result.kept).toContain("上月美金透支");
		expect(result.kept).toContain("上月新臺幣透支");
	});

	it("degenerate split rows over an un-migrated month: USD gets 0, NTD falls back to the 剩餘 anchor", async () => {
		const client = startMonthClient(splitCarryOldLayoutGrid(), ["9 月", "8 月"]);

		await startMonth(client, 10);

		const requests = (client.batchUpdate as any).mock.calls[1][0];
		const usdWrite = requests.find(
			(r: any) => r.updateCells && r.updateCells.start.rowIndex === 2 && r.updateCells.start.columnIndex === 3,
		);
		expect(usdWrite.updateCells.rows[0].values).toEqual([{ userEnteredValue: { numberValue: 0 } }]);
		const ntdWrite = requests.find(
			(r: any) => r.updateCells && r.updateCells.start.rowIndex === 3 && r.updateCells.start.columnIndex === 4,
		);
		// 剩餘 sits at row 16 after the two carry rows shifted the old grid down one.
		expect(ntdWrite.updateCells.rows[0].values).toEqual([
			{ userEnteredValue: { formulaValue: "=IF(-'9 月'!D16 > 0, -'9 月'!D16, 0)" } },
		]);
	});
```

(The existing legacy tests — `monthGrid`/`migratedMonthGrid` with their single 上月透支 — stay untouched and must keep passing: the legacy path is unchanged.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: FAIL — both new tests: no write lands at rowIndex 2 / columnIndex 3 (`usdWrite` undefined), because the current code only rewrites the single 上月透支 row.

- [ ] **Step 3: Implement the three-way rebuild in `startMonth`**

Add `PREV_NTD_OVERDRAFT_LABEL, PREV_USD_OVERDRAFT_LABEL` to the `./conventions` import in `src/finance-ops.ts` (alphabetical). Replace the whole block

```ts
	const overdraftRow = findRowByValue(values, MONTH_COLS.item, OVERDRAFT_LABEL);
	if (overdraftRow !== null) {
		// The duplicated grid mirrors prevTab's layout, so the previous month's
		// remainder row is findable here: 月剩餘 (migrated) or 剩餘 (old layout).
		// Rebuild the carry formula against it — a plain tab-name swap would keep
		// a stale row reference from whichever layout the formula was born in.
		const remainderRow = findRowByLabels(values, MONTH_COLS.budgetLabel, [MONTH_REMAINDER_LABEL, REMAINDER_LABEL]);
		let formula: string;
		if (remainderRow !== null) {
			const cell = `${quoteTab(prevTab)}!${colLetter(MONTH_COLS.budgetValue)}${remainderRow}`;
			formula = `=IF(-${cell} > 0, -${cell}, 0)`;
		} else {
			formula = String(values[overdraftRow - 1]?.[MONTH_COLS.twd] ?? "").replace(/'\d+ 月'/g, `'${prevTab}'`);
		}
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: overdraftRow - 1, columnIndex: MONTH_COLS.twd },
				rows: [{ values: [cellData(formula)] }],
				fields: "userEnteredValue",
			},
		});
	}
```

with

```ts
	// Carry rebuild. Split layout: each currency rolls its own UNSETTLED
	// deficit — 月…餘額+…透支沖銷 is negative exactly when the 沖銷 could not
	// fire — independently of the other currency and of 月剩餘. Legacy tabs
	// keep the single TWD carry anchored at 月剩餘/剩餘. The duplicated grid
	// mirrors prevTab's layout, so every anchor row is findable here — a plain
	// tab-name swap would keep a stale row reference from whichever layout the
	// formula was born in.
	const carryWrite = (row: number, col: number, value: string | number) => {
		requests.push({
			updateCells: {
				start: { sheetId, rowIndex: row - 1, columnIndex: col },
				rows: [{ values: [cellData(value)] }],
				fields: "userEnteredValue",
			},
		});
	};
	const legacyCarryFormula = (fallbackRow: number): string => {
		const remainderRow = findRowByLabels(values, MONTH_COLS.budgetLabel, [MONTH_REMAINDER_LABEL, REMAINDER_LABEL]);
		if (remainderRow !== null) {
			const cell = `${quoteTab(prevTab)}!${colLetter(MONTH_COLS.budgetValue)}${remainderRow}`;
			return `=IF(-${cell} > 0, -${cell}, 0)`;
		}
		return String(values[fallbackRow - 1]?.[MONTH_COLS.twd] ?? "").replace(/'\d+ 月'/g, `'${prevTab}'`);
	};
	const usdCarryRow = findRowByValue(values, MONTH_COLS.item, PREV_USD_OVERDRAFT_LABEL);
	const ntdCarryRow = findRowByValue(values, MONTH_COLS.item, PREV_NTD_OVERDRAFT_LABEL);
	if (usdCarryRow !== null || ntdCarryRow !== null) {
		const unsettled = (netLabel: string, writeoffLabel: string): string | null => {
			const netRow = findRowByValue(values, MONTH_COLS.budgetLabel, netLabel);
			const writeoffRow = findRowByValue(values, MONTH_COLS.budgetLabel, writeoffLabel);
			if (netRow === null || writeoffRow === null) return null;
			const D = colLetter(MONTH_COLS.budgetValue);
			const sum = `${quoteTab(prevTab)}!${D}${netRow}+${quoteTab(prevTab)}!${D}${writeoffRow}`;
			return `=IF(-(${sum}) > 0, -(${sum}), 0)`;
		};
		if (usdCarryRow !== null) {
			// Degenerate (previous month predates the 月 view): nothing to anchor
			// the USD side on — carry 0. The row's E conversion formula is
			// row-relative and survives duplication; only D is rewritten.
			carryWrite(usdCarryRow, MONTH_COLS.usd, unsettled(MONTH_USD_NET_LABEL, USD_WRITEOFF_LABEL) ?? 0);
		}
		if (ntdCarryRow !== null) {
			carryWrite(
				ntdCarryRow,
				MONTH_COLS.twd,
				unsettled(MONTH_NTD_NET_LABEL, NTD_WRITEOFF_LABEL) ?? legacyCarryFormula(ntdCarryRow),
			);
		}
	} else {
		const overdraftRow = findRowByValue(values, MONTH_COLS.item, OVERDRAFT_LABEL);
		if (overdraftRow !== null) {
			carryWrite(overdraftRow, MONTH_COLS.twd, legacyCarryFormula(overdraftRow));
		}
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: PASS — the two new tests AND all existing startMonth tests (legacy path byte-identical in behavior).

- [ ] **Step 5: Update the start_month tool description in `src/tools.ts`**

In the `start_month` description string, change `rewires 上月透支 to the month just ended` to `rewires the 上月…透支 carries to the month just ended (per-currency on the split layout)`.

- [ ] **Step 6: Type-check and full suite, then commit**

Run: `bun run type-check && bunx vitest run`
Expected: clean.

```bash
git add src/finance-ops.ts src/tools.ts test/finance-ops.test.ts
git commit -m "feat: start_month rebuilds per-currency 上月…透支 carries"
```

---

### Task 3: month_summary carry fields

**Files:**
- Modify: `src/finance-ops.ts` (`monthSummary` return object, ~line 953)
- Modify: `src/tools.ts` (`month_summary` description)
- Test: `test/finance-ops.test.ts` (`monthSummary` describe block)

**Interfaces:**
- Consumes: `PREV_USD_OVERDRAFT_LABEL`, `PREV_NTD_OVERDRAFT_LABEL` (imported in Task 2); `splitCarryGrid()` fixture (Task 2); `monthSummary`'s existing `cellAt`/`rowByItem` helpers.
- Produces: `monthSummary` result gains `上月美金透支: number | null` and `上月新臺幣透支: number | null`.

- [ ] **Step 1: Update the existing tests and add the new one (failing)**

In BOTH full-object `monthSummary` tests (`"returns unformatted numbers keyed to the sheet's own labels"` and `"reports the migrated layout…"`), add to the expected object directly after `上月透支: …,`:

```ts
			上月美金透支: null,
			上月新臺幣透支: null,
```

At the end of the `monthSummary` describe block add:

```ts
	it("reports the split carry rows and nulls the legacy 上月透支", async () => {
		const grid = splitCarryGrid();
		// UNFORMATTED render: formulas come back as computed numbers
		grid[2] = ["", "上月美金透支", "透支", 20.5, 612.05, "USD"];
		grid[3] = ["", "上月新臺幣透支", "透支", "", 968.57, "TWD"];
		const client = fakeClient(grid);

		const result = await monthSummary(client, 9);

		expect(result.上月美金透支).toBe(20.5);
		expect(result.上月新臺幣透支).toBe(968.57);
		expect(result.上月透支).toBeNull();
		// both rows are tagged 透支; the USD row's E holds the converted view
		expect(result.tags.透支).toBeCloseTo(612.05 + 968.57, 2);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: FAIL — `上月美金透支` key missing from the result (and the two full-object tests fail on the added keys).

- [ ] **Step 3: Implement in `monthSummary`**

In the returned object, directly after the `上月透支:` line, add:

```ts
		上月美金透支: cellAt(rowByItem(PREV_USD_OVERDRAFT_LABEL), MONTH_COLS.usd),
		上月新臺幣透支: cellAt(rowByItem(PREV_NTD_OVERDRAFT_LABEL), MONTH_COLS.twd),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the month_summary tool description in `src/tools.ts`**

In the `month_summary` description string, change `花費總額, 上月透支,` to `花費總額, the carried overdrafts (上月美金透支/上月新臺幣透支, or legacy 上月透支),`.

- [ ] **Step 6: Type-check, full suite, commit**

Run: `bun run type-check && bunx vitest run`
Expected: clean.

```bash
git add src/finance-ops.ts src/tools.ts test/finance-ops.test.ts
git commit -m "feat: month_summary reports 上月美金透支/上月新臺幣透支"
```

---

## Post-implementation (not part of the tasks)

- Push the branch; PR #12's description gains a section for this feature.
- The live backfill of 7月/8月/9月 (insert the USD carry row, rename + re-anchor the NTD row, 7月→8月→9月 in order, all anchors located by label at execution time) is the spec's runbook — executed against the sheet AFTER merge+deploy, with every overwritten value reported.
