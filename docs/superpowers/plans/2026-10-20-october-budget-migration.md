# October on the budget layout, old layout retired — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the live 10 月 tab onto the budget layout, then make every monthly write tool budget-only and delete the old-layout write code.

**Architecture:** Task 1 runs on the live sheet with the deployed tools (it needs `replace_old_layout`, which Task 4 removes). Tasks 2–5 cut the server down: one shared refusal guard in front of each write op, the old-layout-only tools and helpers deleted, `month_summary`'s old-layout reader kept untouched.

**Tech Stack:** TypeScript, Cloudflare Workers, Google Sheets API v4, MCP SDK, zod, vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-october-budget-migration-design.md`

## Global Constraints

- `month_summary` output on any old-layout tab must not change; its old-layout tests stay as they are.
- Budget-month behavior must not change; every test in `test/budget-ops.test.ts` and `test/budget-layout.test.ts` keeps passing (only tests of removed behavior are edited or deleted).
- The general tools (`read_range`, `update_range`, `append_rows`, `insert_rows`, `delete_rows`, `find_cells`, `add_tab`, `list_tabs`) and the trip tools keep working on any tab.
- A refused write makes no `batchUpdate` call.
- `npm test` and `npm run type-check` pass after every task.

## Review Focus

- A write tool pointed at an old month (e.g. `month: 9`) must refuse before writing: every refusal test asserts `batchUpdate` was never called.
- `set_income` used to work on 7 月–10 月; it now refuses them too — pinned by a refusal test on the current old-layout fixture.
- A yen `add_transfer` dated in an old month used to rewrite that month's 銀行餘額 formulas; it must now touch only the trip tab — pinned by a test that the month tab is never read.
- `start_month` on any existing "N 月" (old or budget) refuses; without a "Budget Based" tab it refuses instead of duplicating — both pinned in Task 4.
- `month_summary` on 5 月's oldest shape (single 剩餘 row) keeps working — the existing monthSummary tests cover it; they must not be deleted with the old write tests.

---

### Task 1: Move October on the live sheet (no code)

Run from this session with the Personal Finance Sheet connector, before Task 4 is deployed. Follow the spec's Part 1 exactly; the steps below are its checklist.

- [ ] **Step 1: Snapshot.** `read_range '10 月'!A1:S100` (formulas) and `month_summary` for 10, 11, 12. Confirm the 乾坤大挪移 log (H–N) is still empty; if not, stop and ask.
- [ ] **Step 2: Build.** `start_month(10, replace_old_layout: true)`. Expect `replacedTab: "10 月 DEP"`, `carriesFrom: "9 月"`, rate formula with `DATE(2026,10,1)`.
- [ ] **Step 3: Clear the template's starting entries** in the new 10 月: update_range `""` over 項目/金額/幣別 of each block's starting-entry rows (生活用品 2, 訂閱 6, 交通 1, 學貸 2, 其他 1). Leave rows and the pre-typed TWD of empty blocks alone.
- [ ] **Step 4: add_expense every October entry** (`month: 10`, tag, date when dated, `currency`/`paid_with` from the old D/E/F columns), dated rows by date then dateless rows, per the spec's mapping table. Lunches come from the old P–S log with tag 中餐. The old `中餐 =130*30` budget row is not added.
- [ ] **Step 5: Restore the four formulas** (PP E500, 近鐵 80000系, ChatGPT, Claude `=200*$C$<rate row>+30`) with update_range on each 金額 cell, reading each row's address from Step 4's results.
- [ ] **Step 6: Repoint 11 月!D3** to `=IF(-('10 月'!D<本月美金收支狀況 row>) > 0, -('10 月'!D<row>), 0)`; leave 11 月!E4.
- [ ] **Step 7: Check.** `month_summary(10)`: each block's 總和 matches the old per-類別 totals (USD rows at the locked rate), 本月美金收支狀況 = 18.31; `month_summary(11)` and `(12)` equal Step 1's.

### Task 2: Write tools refuse old-layout months

**Files:**
- Modify: `src/budget-layout.ts` (add the guard), `src/finance-ops.ts` (`addExpense`, `deleteExpense`, `setIncome`, `addTransfer` usd branch, `getCategories`), `src/budget-ops.ts` (`addBudgetExpense` card check), `src/tools.ts` (`add_expense` schema and the five descriptions)
- Test: `test/budget-ops.test.ts` (new `describe("old-layout months are read-only")`), `test/finance-ops.test.ts` (delete old-layout tests of these five ops)

**Interfaces:**
- Produces: `assertBudgetMonth(values: unknown[][], tab: string): void` in `src/budget-layout.ts`, throwing `` `${tab} is on the old layout, which is read-only now — month_summary still reads it; no tool writes to it.` ``
- Produces: `AddExpenseParams` without `card`; `add_expense` schema without `card`.

- [ ] **Step 1: Write the failing tests** in `test/budget-ops.test.ts`, using the existing old-layout fixture builder from `test/finance-ops.test.ts` (move it to a shared `test/old-layout-fixtures.ts` if needed) and a `fakeClient` whose `batchUpdate` is a `vi.fn()`:
  - `add_expense on 9 月 refuses and writes nothing` → rejects with `/9 月 is on the old layout, which is read-only now/`, `batchUpdate` not called.
  - Same for `delete_expense`, `set_income` (an old tab WITH the 本月美金收支狀況 layout, i.e. what used to be accepted), `add_transfer` (usd), `get_categories`.
- [ ] **Step 2: Run** `npx vitest run test/budget-ops.test.ts -t "read-only"` — expect 5 failures.
- [ ] **Step 3: Implement.** Add `assertBudgetMonth`; in each op replace the `if (isBudgetMonth(values)) return <budget op>` hand-off with `assertBudgetMonth(values, tab); return <budget op>` and delete the old-layout body below it. `setIncome` keeps its shared upsert code with only the budget branches (`findBudgetIncomeSumifWindow`, no audit, no `win.current` check). Drop `card` from `AddExpenseParams`, the tool schema and `addBudgetExpense`'s card refusal (update that test to cover the missing tag only).
- [ ] **Step 4: Delete** the old-layout tests of these five ops from `test/finance-ops.test.ts` (`describe("addExpense")`, `describe("deleteExpense")`, `describe("setIncome")`, `describe("getCategories")`, the usd cases of `describe("addTransfer")`), keeping any helper tests still exercising surviving functions.
- [ ] **Step 5: Run** `npm test && npm run type-check` — all pass.
- [ ] **Step 6: Commit** `feat: write tools refuse old-layout months`.

### Task 3: Remove add_lunch, set_expense_date and adjust_balance

**Files:**
- Modify: `src/tools.ts` (unregister the three tools), `src/finance-ops.ts` (delete `addLunch`, `setExpenseDate`, `adjustBalance` and their param types)
- Test: `test/finance-ops.test.ts` (delete `describe("addLunch")`, `describe("setExpenseDate")`, `describe("adjustBalance")`), `test/budget-ops.test.ts` (delete `describe("old-layout-only tools refuse budget months")`)

- [ ] **Step 1: Write the failing test** in `test/conventions.test.ts` or a new `test/tools.test.ts`: register tools on a stub server and assert the registered names include neither `add_lunch`, `set_expense_date` nor `adjust_balance`, and still include `month_summary`, `add_expense`, `start_month`.
- [ ] **Step 2: Run** it — expect FAIL (names still registered).
- [ ] **Step 3: Delete** the three registrations and functions, and their tests.
- [ ] **Step 4: Run** `npm test && npm run type-check` — all pass.
- [ ] **Step 5: Commit** `feat: remove add_lunch, set_expense_date and adjust_balance`.

### Task 4: start_month template-only; yen transfers stop wiring months; dead code out

**Files:**
- Modify: `src/finance-ops.ts` (`startMonth`, `addTransfer` jpy branch, delete `wireJpyTransferIntoMonth`, `auditCreditBuckets`, `creditBucketGuard`, `findCreditSection`, `bucketSpillCapacity`, `CREDIT_BUCKET_PAD_ROWS`, `findExpenseWindow`, `expensePositionFor`, `findIncomeSumifWindow`, `TRANSFER_SECTIONS.usd`, and any helper left unused), `src/budget-ops.ts` (`startBudgetMonth` without `replaceOldLayout`), `src/conventions.ts` (delete constants nothing imports any more), `src/tools.ts` (`start_month` schema without `replace_old_layout`)
- Test: `test/finance-ops.test.ts`, `test/budget-ops.test.ts`

**Interfaces:**
- Produces: `startMonth(client, month, opts?: { now?: Date; newSheetId?: number })`; `StartBudgetMonthResult` without `replacedTab`; `AddTransferResult` without `wiredMonthTab`, `wiringNote`, `bucketWarning`, `bucketsGrown`.

- [ ] **Step 1: Write the failing tests** in `test/budget-ops.test.ts`:
  - `start_month without the Budget Based tab refuses and writes nothing` → rejects `/Budget Based/`, `batchUpdate` not called.
  - `start_month refuses an existing old-layout month` (replaces the old "renames to 11 月 DEP" case) → rejects `/already exists/`, nothing written.
  - In `describe("addTransfer (jpy)")`: `a jpy transfer dated in an old month never reads or writes the month tab` → `readRange` never called with a range starting `'10 月'!` (or any month tab), result has no `wiredMonthTab`.
- [ ] **Step 2: Run** them — expect FAIL.
- [ ] **Step 3: Implement.** `startMonth` → no template tab: throw `` `No "${BUDGET_TEMPLATE_TAB}" template tab — start_month builds every month from it.` ``; otherwise `startBudgetMonth`. `startBudgetMonth` refuses any existing "N 月". `addTransfer` jpy returns after the trip-tab write. Then delete every function, type and constant left without a caller (let `tsc --noEmit` with `noUnusedLocals` or a grep guide it); keep everything `monthSummary`'s old-layout path uses (`findIncomeWindow`, `findLunchSection`, `LUNCH_*` anchors, the 銀行餘額 labels).
- [ ] **Step 4: Delete** the tests of removed code (`describe("findCreditSection")`, `describe("auditCreditBuckets")`, `describe("expensePositionFor")`, the old-path `describe("startMonth")` cases, `describe("addTransfer (jpy) month wiring")`, the replace_old_layout cases in `budget-ops.test.ts`).
- [ ] **Step 5: Run** `npm test && npm run type-check` — all pass.
- [ ] **Step 6: Commit** `feat: start_month builds from the template only; drop old-layout write code`.

### Task 5: Docs — sheet guide, tool descriptions, README

**Files:**
- Modify: `src/conventions.ts` (`CONVENTIONS_TEXT`), `src/tools.ts` (descriptions of `month_summary`, `delete_rows`, `get_sheet_conventions`), `README.md`, `docs/superpowers/specs/2026-10-20-october-budget-migration-design.md` (status → Approved)
- Test: `test/conventions.test.ts`

- [ ] **Step 1: Write the failing tests** in `test/conventions.test.ts`: `CONVENTIONS_TEXT` does not contain `add_lunch`, `set_expense_date`, `adjust_balance`, `replace_old_layout`, `信用卡帳單對帳區` outside the old-months note; it contains `read-only` and `month_summary` in the old-months note.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Rewrite** `CONVENTIONS_TEXT`: MONTHLY TABS = the budget layout (today's BUDGET MONTHS section, minus replace_old_layout and the refusal list); a short OLD MONTHS note (5 月–9 月 and every "N 月 DEP": read-only history; one expense list A–G ending at 花費總額, income list, 收支狀況 rows, 銀行餘額 block; read with month_summary or read_range; DEP tabs with read_range only); TRIP TABS unchanged except the yen-transfer bullet (no month wiring); closing paragraph lists only surviving tools and the budget/trip bands. `delete_rows`' column hint names the budget bands (a block's 4 columns, BA:BG, A:F) and trip bands. README: drop the three tools, the card/bucket paragraph and replace_old_layout; the budget-months paragraph says old months are read-only.
- [ ] **Step 4: Run** `npm test && npm run type-check` — all pass.
- [ ] **Step 5: Commit** `docs: describe budget months as the only writable layout`.
