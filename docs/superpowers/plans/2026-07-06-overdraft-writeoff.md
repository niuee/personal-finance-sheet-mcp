# 透支沖銷 (Overdraft Write-off) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An automatic 透支沖銷 row in the monthly budget block that settles a carried 上月透支 against the bank balance (all-or-nothing) so old debt stops rolling through 月剩餘 — per `docs/2026-07-06-overdraft-writeoff-design.md`.

**Architecture:** One new label in `conventions.ts`; `migrateIncomeLayout` writes a four-row 月 view (insert grows 2→3 rows, `finalRow` shifts +3); `month_summary` reports the new field. `start_month`, `setIncome`, and `findIncomeWindow` are untouched. Already-migrated live tabs get a one-time label-anchored backfill after merge (not part of this plan's commits).

**Tech Stack:** TypeScript on Cloudflare Workers, Google Sheets API via `SheetsClient`, vitest with mocked clients.

## Global Constraints

- Use **bun**: `bun run test`, `bun run type-check`, `bunx vitest run …`. Never npm.
- Tab indentation, double quotes.
- Work on branch `feat/overdraft-writeoff` in /Users/vincent.yy.chang/dev/personal-finance/main.
- Exact label: `WRITEOFF_LABEL = "透支沖銷"`.
- Write-off formula shape (all cells located by label, never fixed position): `=IF(D{總新臺幣餘額row}>=0, E{上月透支row}, 0)`; literal number `0` when the tab has no 上月透支 row.
- 月 row order: 月美金餘額 / 月新臺幣餘額 / 透支沖銷 / 月剩餘; 月剩餘 = `=D{月美}*GOOGLEFINANCE("CURRENCY:USDTWD")+D{月新}+D{沖銷}`.
- The 支出 SUMIFs keep spanning the FULL expense window including 上月透支 (Vincent's standing decision — do not change).

**Fixture row map after this plan** (`migratedMonthGrid()`, 1-indexed; `g[i]` = row `i+1`): 總預算 13, income 14-16, 月美金餘額 17, 月新臺幣餘額 18, **透支沖銷 19 (new)**, 月剩餘 20, 銀行餘額 22, 美金收入 23, 美金支出 24, 上月美金餘額 25, 總美金餘額 26, 新臺幣收入 27, 新臺幣支出 28, 上月新臺幣餘額 29, 總新臺幣餘額 30. `oldLayoutGrid()` is unchanged (剩餘 16, 美金支付 18, 新臺幣支付 19, bank 22-29).

---

### Task 1: Conventions — `WRITEOFF_LABEL` + CONVENTIONS_TEXT

**Files:**
- Modify: `src/conventions.ts`
- Test: `test/conventions.test.ts`

**Interfaces:**
- Produces: `WRITEOFF_LABEL = "透支沖銷"` (exported from `src/conventions.ts`), used by Tasks 2-3.

- [ ] **Step 1: Write the failing tests**

In `test/conventions.test.ts`, add `WRITEOFF_LABEL` to the `../src/conventions` import. In the `"exports the income-section labels"` test, add:

```ts
		expect(WRITEOFF_LABEL).toBe("透支沖銷");
```

In the `"conventions text mentions the anchors Claude needs"` needle list, add:

```ts
				"透支沖銷",
```

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run test/conventions.test.ts`
Expected: FAIL — no export `WRITEOFF_LABEL`.

- [ ] **Step 3: Implement**

In `src/conventions.ts`, directly after the `MONTH_REMAINDER_LABEL` line, add:

```ts
/**
 * 透支沖銷 — automatic all-or-nothing write-off of the carried 上月透支
 * against the bank: =IF(總新臺幣餘額 >= 上月透支, 上月透支, 0). Sits between
 * 月新臺幣餘額 and 月剩餘; 月剩餘 adds it back so settled debt does not roll.
 */
export const WRITEOFF_LABEL = "透支沖銷";
```

In `CONVENTIONS_TEXT`, in the income-section bullet (the one beginning `- Below the list, the income section:`), replace the sentence fragment

```
The list ends at 月美金餘額 / 月新臺幣餘額 (THIS month's 收入−支出 per currency, from the 銀行餘額 block) and 月剩餘 (= 月美金餘額*GOOGLEFINANCE USDTWD + 月新臺幣餘額 — the month's combined remainder in TWD).
```

with

```
The list ends at 月美金餘額 / 月新臺幣餘額 (THIS month's 收入−支出 per currency, from the 銀行餘額 block), then 透支沖銷 (automatic all-or-nothing write-off: =IF(總新臺幣餘額 >= 上月透支, 上月透支, 0) — when the bank can cover the carried overdraft it is settled from savings), then 月剩餘 (= 月美金餘額*GOOGLEFINANCE USDTWD + 月新臺幣餘額 + 透支沖銷 — the month's combined remainder in TWD; because 透支沖銷 adds a settled carry back, only FRESH overspending rolls to next month).
```

- [ ] **Step 4: Run to verify pass**

Run: `bunx vitest run test/conventions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/conventions.ts test/conventions.test.ts
git commit -m "feat: 透支沖銷 label and conventions text"
```

---

### Task 2: Migration writes the four-row 月 view (+ fixture shift ripple)

**Files:**
- Modify: `src/finance-ops.ts` (migrateIncomeLayout), `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: `WRITEOFF_LABEL` (Task 1); existing `findRowByValue`, `OVERDRAFT_LABEL`, `MONTH_COLS`, `cellData`, `finalRow` pattern inside `migrateIncomeLayout`.
- Produces: migration emits 月美金餘額/月新臺幣餘額/透支沖銷/月剩餘; `migratedMonthGrid()` fixture updated per the Global Constraints row map (Task 3 relies on it).

- [ ] **Step 1: Update the fixture**

In `test/finance-ops.test.ts`, replace `migratedMonthGrid()`'s rows from `g[16]` to the end of the function with:

```ts
	g[16] = ["", "月美金餘額", "", "=D23-D24"];
	g[17] = ["", "月新臺幣餘額", "", "=D27-D28"];
	g[18] = ["", "透支沖銷", "", "=IF(D30>=E3, E3, 0)"];
	g[19] = ["", "月剩餘", "", '=D17*GOOGLEFINANCE("CURRENCY:USDTWD")+D18+D19'];
	g[21] = ["", "銀行餘額"];
	g[22] = ["", "美金收入", "", '=SUMIF(C14:C16,"USD",D14:D16)'];
	g[23] = ["", "美金支出", "", '=SUMIF(F3:F10,"USD",D3:D10)'];
	g[24] = ["", "上月美金餘額", "", "='8 月'!D26"];
	g[25] = ["", "總美金餘額", "", "=D25+D23-D24"];
	g[26] = ["", "新臺幣收入", "", '=SUMIF(C14:C16,"TWD",D14:D16)'];
	g[27] = ["", "新臺幣支出", "", '=SUMIF(F3:F10,"TWD",E3:E10)'];
	g[28] = ["", "上月新臺幣餘額", "", "='8 月'!D30"];
	g[29] = ["", "總新臺幣餘額", "", "=D29+D27-D28"];
	return g;
```

(rows `g[0]`-`g[15]` stay exactly as they are.)

- [ ] **Step 2: Update the migration test expectations (oldLayoutGrid case)**

In the `"migrates an old-layout tab in one batch…"` test:

1. Insert grows to 3 rows — replace the `requests[0]` expectation's range with `{ sheetId: 111, dimension: "ROWS", startIndex: 16, endIndex: 19 }`.
2. Deletes shift by +3 — `requests[1]` range becomes `{ sheetId: 111, dimension: "ROWS", startIndex: 21, endIndex: 22 }` (新臺幣支付 19→22) and `requests[2]` becomes `{ sheetId: 111, dimension: "ROWS", startIndex: 20, endIndex: 21 }` (美金支付 18→21).
3. The 月-rows expectation (`requests[6]`) — bank rows now land at +1 (insert +3, two deletes): 美金收入 23, 美金支出 24, 新臺幣收入 27, 新臺幣支出 28, 總新臺幣餘額 30. Replace the whole `expect(requests[6]).toEqual({...})` with:

```ts
		expect(requests[6]).toEqual({
			updateCells: {
				start: { sheetId: 111, rowIndex: 15, columnIndex: 1 },
				rows: [
					{ values: [{ userEnteredValue: { stringValue: "月美金餘額" } }, {}, { userEnteredValue: { formulaValue: "=D23-D24" } }] },
					{ values: [{ userEnteredValue: { stringValue: "月新臺幣餘額" } }, {}, { userEnteredValue: { formulaValue: "=D27-D28" } }] },
					{ values: [{ userEnteredValue: { stringValue: "透支沖銷" } }, {}, { userEnteredValue: { formulaValue: "=IF(D30>=E3, E3, 0)" } }] },
					{ values: [{ userEnteredValue: { stringValue: "月剩餘" } }, {}, { userEnteredValue: { formulaValue: '=D16*GOOGLEFINANCE("CURRENCY:USDTWD")+D17+D18' } }] },
				],
				fields: "userEnteredValue",
			},
		});
```

4. SUMIF/rename request expectations shift +1: `requests[7]` start `rowIndex: 22`; `requests[8]` `rowIndex: 23`; `requests[9]` `rowIndex: 26`; `requests[10]` `rowIndex: 27`; `requests[11]` `rowIndex: 25`; `requests[12]` `rowIndex: 29`.
5. `changes` assertions: `{ cell: "D23", before: "0", after: '=SUMIF(C14:C15,"USD",D14:D15)' }` (was D22); `{ cell: "B26", before: "美金餘額", after: "總美金餘額" }` (was B25); `{ cell: "D16", before: "=sum(D14:D15)-E11", after: "=D23-D24" }`.
6. The request count stays `expect(requests).toHaveLength(13);`.

In `"handles a tab that has only 美金支付 (no 新臺幣支付 row)"`: the delete becomes `{ startIndex: 20, endIndex: 21 }` (美金支付 18+3=21) and the changes assertion becomes `{ cell: "D24", before: "0", after: '=SUMIF(C14:C15,"USD",D14:D15)' }` (美金收入 22+3−1=24).

`"preserves an existing 支付幣別 cell…"` and `"refuses when the 銀行餘額 block is missing"` need no changes.

- [ ] **Step 3: Update the ripple expectations in startMonth/monthSummary tests**

`"clears ad-hoc income rows but keeps 沛還/薪水…"` (startMonth, migrated fixture):
- carry writes: first becomes `start: { sheetId: 555, rowIndex: 24, columnIndex: 3 }` with `formulaValue: "='9 月'!D26"`; second becomes `rowIndex: 28` with `"='9 月'!D30"`.
- the overdraft-rebuild assertion becomes `formulaValue: "=IF(-'9 月'!D20 > 0, -'9 月'!D20, 0)"` (月剩餘 moved to row 20).
- the delete expectation (`startIndex: 15, endIndex: 16`) is unchanged.

`"reports the migrated layout…"` (monthSummary): the UNFORMATTED overrides shift — replace the whole override block with:

```ts
		grid[2] = [46266, "上月透支", "透支", "", 13603.67, "TWD"];
		grid[3] = ["", "Google Cloud", "訂閱", 11.53, 368.44, "USD"];
		grid[4] = ["", "電話費", "生活用品", "", 1261, "TWD"];
		grid[10] = ["", "", "", "花費總額", 15233.11];
		grid[16] = ["", "月美金餘額", "", -11.53];
		grid[17] = ["", "月新臺幣餘額", "", 133296.33];
		grid[18] = ["", "透支沖銷", "", 13603.67];
		grid[19] = ["", "月剩餘", "", 146531.11];
		grid[22] = ["", "美金收入", "", 0];
		grid[23] = ["", "美金支出", "", 11.53];
		grid[24] = ["", "上月美金餘額", "", 1000];
		grid[25] = ["", "總美金餘額", "", 988.47];
		grid[26] = ["", "新臺幣收入", "", 148326];
		grid[27] = ["", "新臺幣支出", "", 15029.67];
		grid[28] = ["", "上月新臺幣餘額", "", 5000];
		grid[29] = ["", "總新臺幣餘額", "", 138296.33];
```

and in the expected object change `月剩餘: 132927.44` to `月剩餘: 146531.11` (= 132927.44 + the 13603.67 write-off). Do NOT add a 透支沖銷 key yet — that is Task 3.

setIncome and findIncomeWindow tests reference only rows 13-17 of the fixture and need no changes.

- [ ] **Step 4: Run to verify failure**

Run: `bunx vitest run test/finance-ops.test.ts`
Expected: FAIL — migration still emits 3 rows / old indices (fixture tests pass, migration tests fail).

- [ ] **Step 5: Implement in `src/finance-ops.ts`**

Add `WRITEOFF_LABEL` to the conventions import (alphabetical). In `migrateIncomeLayout`:

1. `insertDimension` range becomes `{ sheetId, dimension: "ROWS", startIndex: remRow, endIndex: remRow + 3 }`.
2. `finalRow` becomes `(r: number) => (r <= remRow ? r : r + 3 - payRows.filter((p) => p.row < r).length);` (update its comment: `+3 for the insert`).
3. Replace the block from the `// 剩餘 row + the two inserted rows become the 月 view.` comment through the two rename `write(...)` calls with:

```ts
	// 剩餘 row + the three inserted rows become the 月 view.
	const usd = colLetter(MONTH_COLS.usd);
	const twd = colLetter(MONTH_COLS.twd);
	const usdNet = `=${D}${finalRow(usdIncRow)}-${D}${finalRow(usdSpRow)}`;
	const ntdNet = `=${D}${finalRow(ntdIncRow)}-${D}${finalRow(ntdSpRow)}`;
	// All-or-nothing write-off: settle the carried 上月透支 from the bank when
	// 總新臺幣餘額 can cover it, so only fresh overspending rolls forward.
	const overdraftRow = findRowByValue(values, MONTH_COLS.item, OVERDRAFT_LABEL);
	const writeoff =
		overdraftRow !== null
			? `=IF(${D}${finalRow(ntdBalRow)}>=${twd}${overdraftRow}, ${twd}${overdraftRow}, 0)`
			: 0;
	const monthRemainder = `=${D}${remRow}*GOOGLEFINANCE("CURRENCY:USDTWD")+${D}${remRow + 1}+${D}${remRow + 2}`;
	requests.push({
		updateCells: {
			start: { sheetId, rowIndex: remRow - 1, columnIndex: MONTH_COLS.item },
			rows: [
				{ values: [cellData(MONTH_USD_NET_LABEL), cellData(null), cellData(usdNet)] },
				{ values: [cellData(MONTH_NTD_NET_LABEL), cellData(null), cellData(ntdNet)] },
				{ values: [cellData(WRITEOFF_LABEL), cellData(null), cellData(writeoff)] },
				{ values: [cellData(MONTH_REMAINDER_LABEL), cellData(null), cellData(monthRemainder)] },
			],
			fields: "userEnteredValue",
		},
	});
	changes.push({ cell: `${colLetter(MONTH_COLS.item)}${remRow}`, before: REMAINDER_LABEL, after: MONTH_USD_NET_LABEL });
	changes.push({ cell: `${D}${remRow}`, before: cellStr(remRow, MONTH_COLS.budgetValue), after: usdNet });

	const incRange = (col: string) => `${col}${win.start}:${col}${win.end}`;
	const expRange = (col: string) => `${col}${expense.start}:${col}${expense.end}`;
	write(finalRow(usdIncRow), MONTH_COLS.budgetValue, `=SUMIF(${incRange(C)},"USD",${incRange(D)})`, cellStr(usdIncRow, MONTH_COLS.budgetValue));
	write(finalRow(usdSpRow), MONTH_COLS.budgetValue, `=SUMIF(${expRange(F)},"USD",${expRange(usd)})`, cellStr(usdSpRow, MONTH_COLS.budgetValue));
	write(finalRow(ntdIncRow), MONTH_COLS.budgetValue, `=SUMIF(${incRange(C)},"TWD",${incRange(D)})`, cellStr(ntdIncRow, MONTH_COLS.budgetValue));
	write(finalRow(ntdSpRow), MONTH_COLS.budgetValue, `=SUMIF(${expRange(F)},"TWD",${expRange(twd)})`, cellStr(ntdSpRow, MONTH_COLS.budgetValue));
	write(finalRow(usdBalRow), MONTH_COLS.item, TOTAL_USD_BALANCE_LABEL, USD_BALANCE_LABEL);
	write(finalRow(ntdBalRow), MONTH_COLS.item, TOTAL_NTD_BALANCE_LABEL, NTD_BALANCE_LABEL);
```

(the `const usd`/`const twd` declarations MOVE here from below; delete their old occurrences so they are not declared twice. `cellData` accepts `string | number`, so the numeric `0` fallback type-checks.)

Also update the migration JSDoc line `剩餘 → 月美金餘額/月新臺幣餘額/月剩餘` to `剩餘 → 月美金餘額/月新臺幣餘額/透支沖銷/月剩餘`.

- [ ] **Step 6: Run to verify pass**

Run: `bun run test && bun run type-check`
Expected: all PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/finance-ops.ts test/finance-ops.test.ts
git commit -m "feat: migration writes the 透支沖銷 row (four-row 月 view)"
```

---

### Task 3: `month_summary` reports 透支沖銷

**Files:**
- Modify: `src/finance-ops.ts` (monthSummary), `src/tools.ts` (month_summary description), `test/finance-ops.test.ts`

**Interfaces:**
- Consumes: `WRITEOFF_LABEL` (Task 1), the Task 2 fixture.
- Produces: monthSummary result gains `透支沖銷: number | null`.

- [ ] **Step 1: Update the tests**

In `"returns unformatted numbers keyed to the sheet's own labels"` (old fixture): add `透支沖銷: null,` right after the `月剩餘: null,` line in the expected object.

In `"reports the migrated layout…"`: add `透支沖銷: 13603.67,` right after `月剩餘: 146531.11,` in the expected object.

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run test/finance-ops.test.ts -t "monthSummary"`
Expected: FAIL — result lacks the 透支沖銷 key.

- [ ] **Step 3: Implement**

In `monthSummary`'s return object, add between the `月新臺幣餘額:` and `月剩餘:` lines (mirroring the sheet's row order):

```ts
		透支沖銷: cellAt(rowByItem(WRITEOFF_LABEL), MONTH_COLS.budgetValue),
```

Place the key between 月新臺幣餘額 and 月剩餘 in the Step 1 expected objects too — `toEqual` ignores order, but keep it readable.

In `src/tools.ts`, in the `month_summary` description, change `月美金餘額/月新臺幣餘額/月剩餘` to `月美金餘額/月新臺幣餘額/透支沖銷/月剩餘`.

- [ ] **Step 4: Run to verify pass**

Run: `bun run test && bun run type-check`
Expected: all PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/finance-ops.ts src/tools.ts test/finance-ops.test.ts
git commit -m "feat: month_summary reports 透支沖銷"
```

---

### Task 4: Verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck from a clean tree**

Run: `bun run test && bun run type-check && git status --porcelain`
Expected: all tests PASS, tsc clean, no unstaged changes.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/overdraft-writeoff
gh pr create --title "透支沖銷: automatic overdraft write-off against the bank balance" --body "..."
```

PR body: summarize the design decision trail (settle outside the month, automatic all-or-nothing vs 總新臺幣餘額, visible row), link `docs/2026-07-06-overdraft-writeoff-design.md`, note that the live tabs get a label-anchored backfill after merge. End with the standard Claude Code footer.

---

### Task 5: Backfill the live tabs (controller-run, after merge — no commits)

After the PR merges and `bun run deploy` ships the Worker, run a scratch script (`.superpowers/sdd/e2e/`, gitignored) against prod 7月/8月/9月 and the dev copy 7月. Per tab, all label-anchored:

1. Read `GRID_READ` (FORMULA). Locate 月剩餘, 月新臺幣餘額, 上月透支, 總新臺幣餘額 by label; skip the tab (log) if 透支沖銷 already exists.
2. `insertDimension` one row at the 月剩餘 position (`startIndex = 月剩餘row − 1`) — the new row lands where 月剩餘 was; 月剩餘 and everything below shifts +1, and cross-tab references to this tab's 月剩餘 auto-shift (verified behavior).
3. Write into the new row: B = `透支沖銷`, D = `=IF(D{總新臺幣餘額row+1}>=0, {上月透支 E-cell}, 0)` (the +1 because the bank block shifted below the insert; the 上月透支 row is above and does not shift).
4. Re-read the shifted 月剩餘 formula and append `+D{沖銷row}` to it.
5. Log every write with its previous value; verify the computed 月剩餘/透支沖銷 afterwards.

Expected effect on prod July (once 上月…餘額 is seeded and covers 15,843.21): 透支沖銷 = 15,843.21, 月剩餘 ≈ +14,874, August's rebuilt 上月透支 = 0.
