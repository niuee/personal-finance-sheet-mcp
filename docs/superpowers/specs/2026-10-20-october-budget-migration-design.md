# October on the budget layout, old layout retired — Design

**Date:** 2026-10-20
**Status:** Draft, awaiting approval
**Builds on:** `2026-10-19-budget-month-layout-design.md` and
`2026-10-20-per-currency-budget-blocks-design.md`

## Why

11 月 and 12 月 already run on the budget layout (per-category blocks, one
本月匯率, a USD and an NTD 收支狀況 line). 10 月 is the current month and the
last one in use on the old expense list, so every October expense still goes
through the old tools: the long list, the lunch log, the card buckets and the
bank-balance blocks. Vincent wants October on the budget layout too, and the
old way of tracking expenses retired from the server.

## Decisions already made (Vincent's)

1. **October moves to the budget layout.**
2. **October uses the template's budgets as they are.** October spent well
   past them (train models in 購物, 婚紗存錢 and 額外支出 in 其他, extra
   subscriptions), and that overspend should show.
3. **Old-layout months become read-only history.** That covers 5 月–9 月,
   the "N 月 DEP" copies, and the old October once it's moved aside.
   `month_summary` still reads them; everything else that only exists for
   the old layout is dropped.

## Part 1 — Migrating October (a one-off on the live sheet)

### Goals

- A new "10 月" built from the "Budget Based" template. The old tab is kept
  as "10 月 DEP".
- Every October expense moves into its category block. Lunches from the old
  lunch log go into the 午餐 block.
- October's numbers come out as the budget layout computes them, with the
  template's budgets.
- The 9 月 → 10 月 → 11 月 carry chain runs through the new tab.

### Non-goals

- Changing the template, 11 月 or 12 月. 11 月's hand-set 上月新臺幣透支
  (`=0`) stays as it is.
- Carrying the 支付方式 (card) of each entry. Budget months have no card
  column; the card stays visible in "10 月 DEP".
- Migrating 5 月–9 月.

### Anti-goals (a failure even if it "works")

- A lost, duplicated or changed October entry, other than the expected
  differences listed below.
- Breaking 11 月 or 12 月. Their 收支狀況 lines must read the same before
  and after.
- A write to "10 月 DEP" after the rename. It is history from then on.

### How (my call: run it with the tools already deployed, before Part 2 ships)

`start_month(10, replace_old_layout: true)` already does the hard part:
- It renames "10 月" to "10 月 DEP".
- It copies the template as "10 月".
- It points 上月美金透支 / 上月新臺幣透支 at 9 月's 本月美金收支狀況 /
  本月新臺幣收支狀況 by label.
- It writes the 本月匯率 formula for October 2026. Today is past 10/1, so
  the formula locks to the 10/1 rate (31.9018 when checked on 2026-10-19).

Part 2 removes `replace_old_layout`, so this runs first, from a Claude
session using the Personal Finance Sheet connector. No new server code is
needed.

**Steps, in order:**

1. **Snapshot.** Read 10 月 (formulas and values) and `month_summary(10)`,
   so the move can be checked entry by entry afterwards.
2. **Build.** `start_month(10, replace_old_layout: true)`.
3. **Clear the template's starting entries in the new 10 月.**
   - October's real entries replace them. Most of the same items appear in
     October anyway, so keeping both would double them.
   - Blank 項目, 金額 and 幣別 on those rows (update_range with `""`). Don't
     delete the rows, so the 幣別 dropdown rules on them stay.
   - Leave the pre-typed "TWD" alone in the empty blocks' first two rows.
4. **Add October's entries with `add_expense`** (`month: 10`, tag = the
   block, date when the old row had one), in October's order: dated rows by
   date, then the dateless ones.
   - The 幣別 is the paying account: the old 支付幣別 column (F).
   - A row with D filled but F = TWD was USD-priced and paid from the NTD
     account. It goes in as `currency: USD, paid_with: TWD`, so 幣別 is TWD
     and 金額 is `=<usd>*$C$<rate row>`.
5. **Restore October's formulas** on the four rows that had one, with
   update_range on the 金額 cell:

   | Entry | Old cell | New 金額 |
   |---|---|---|
   | PP E500 (購物) | `=5670+5460+5460` | same |
   | 近鐵 80000系 (購物) | `='火車模型'!C4` | same *(my call: kept as typed, although it follows a live JPY rate on 火車模型, same as today)* |
   | ChatGPT (訂閱, USD) | `=20*1.02` | same |
   | Claude (訂閱, paid TWD) | `=D32*GOOGLEFINANCE("CURRENCY:USDTWD")+30` | `=200*$C$<rate row>+30` |

6. **Repoint 11 月's USD carry.** The rename makes Sheets rewrite 11 月!D3 to
   `'10 月 DEP'!D44`.
   - Set it to `=IF(-('10 月'!D32) > 0, -('10 月'!D32), 0)`, pointing at
     the new tab's 本月美金收支狀況, found by label.
   - Leave 11 月!E4 (`=0`) as is.
   - *(My call.)* Both D44 and D32 are +18.31 today, so 11 月's numbers
     don't move.
7. **Check.**
   - `month_summary(10)`: every block's entries add up to the old 10 月's
     per-類別 totals, apart from the expected differences below.
   - `month_summary(11)` and `month_summary(12)` read the same as in step 1.

**Where each October entry goes** (from the live 10 月 on 2026-10-20; the
builder re-reads it in step 1, since October is still being logged):

| Block | Entries (date, 幣別) |
|---|---|
| 午餐 (budget 中餐 NTD 3,900) | 中餐 104 (10/01), 午餐 101 (10/02), 午餐 435 (10/03), 中餐 119 (10/06), 中餐 71 (10/12) — all TWD, from the old lunch log |
| 吃喝 (0) | 咖啡 600 (10/01), 自動販賣機 10 ×3 (10/01) — TWD |
| 購物 (0) | Keystroke macOS app 14.99 USD (10/02); PP E500, 近鐵 80000系, PP 車廂 10,500 — TWD |
| 生活用品 (NTD 31,261) | 生活採買 441 (10/03), 基本生活費 30,000 (10/05), 電話費 1,261 — TWD |
| 訂閱 (USD 71.37 + NTD 10,700) | Netflix 26.99 (10/02), Cloudflare Domain 21.20 (10/02), Google Cloud 11.53, ElevenLabs 6, iCloud 9.99, Google One 7.99, Cursor 20, ChatGPT 20.40, GitHub Action Minutes 15 — USD; Claude $200 + 30 — TWD |
| 交通 (NTD 1,000) | 公車儲值 1,000 — TWD |
| 娛樂 (0) | Gray Zone Warfare（Steam 標準版）790 (10/06), Steam 遊戲 Dressmaker 308 (10/20) — TWD; 荒野亂鬥月票 12.99 — USD |
| 學貸 (USD 429.93) | ECSI Loan 148.50, Fed Loan 281.43 — USD |
| 其他 (USD 15) | 婚紗存錢 6,667 (10/01), 額外支出 4,800 (10/01) — TWD; 每月銀行管理 15 — USD |

The old expense list's `中餐 =130*30` row (tagged 吃喝) is the lunch
**budget**, not an expense. It doesn't move: the template's
中餐新臺幣預算 (3,900) already holds the same budget.

The income list needs no change: the template's 薪水 TWD 65,271 and 沛還
USD 700 are October's.

**Expected differences from "10 月 DEP":**
- **Rate.** USD amounts convert at the locked 10/1 rate instead of today's
  live one.
- **NTD line.** 本月新臺幣收支狀況 drops from about −21,076 to about
  −28,258. Under the budget layout, unspent budget stays reserved (訂閱's NTD
  side ≈ 4,290 and 中餐 3,070), and the overspend is counted per block.
- **USD line.** 本月美金收支狀況 stays +18.31: every USD category is at or
  over its budget, so the budget logic and the old logic agree.
- **Dropped sections.** The card buckets, 銀行餘額 and 帳戶實際數字對應 don't
  exist on the new tab.

**Left alone:** the draft tabs "Budget Based 10 月" and
"預算版參考（10 月資料）". Vincent can delete them by hand. The new 10 月
lands at the front of the tab bar (start_month always inserts there); drag it
next to 11 月 by hand if wanted.

## Part 2 — Retiring the old layout in the server

### Goals

- Every write tool works on budget months only. On an old-layout month it
  refuses with one clear message: the tab is read-only history, and
  `month_summary` still reads it.
- `month_summary` keeps reading old-layout months exactly as today.
- The code, tests and docs that only served the old layout are removed.

### Non-goals

- Changing anything on budget months or trip tabs.
- Restricting the general tools (`read_range`, `update_range`,
  `append_rows`, `insert_rows`, `delete_rows`, `find_cells`, `add_tab`,
  `list_tabs`). They stay usable on any tab as the escape hatch.
- Editing old design docs under `docs/`. They stay as history.

### Anti-goals

- Any old-layout tab's `month_summary` output changing.
- A write tool still writing into an old-layout tab, silently or partially.
- Any behavior change on budget months.

### Tool by tool

| Tool | After |
|---|---|
| `add_lunch`, `set_expense_date`, `adjust_balance` | Removed. |
| `add_expense` | Budget months only. The `card` param is removed (budget months already refuse it); `paid_with` stays. |
| `delete_expense` | Budget months only. |
| `set_income` | Budget months only. |
| `add_transfer` (usd) | Budget months only. |
| `add_transfer` (jpy) | Still logs into the trip tab's 乾坤大挪移. It never writes into a month tab any more, whatever the date (budget months already skip this). |
| `get_categories` | Budget months only (returns the blocks). |
| `month_summary` | Unchanged on both layouts. |
| `start_month` | Template path only. Without a "Budget Based" tab it refuses instead of duplicating the previous month. `replace_old_layout` is removed: with October done, no old-layout month is left to rebuild. |
| `add_trip_entry`, `trip_budget_status` | Unchanged. |
| General tools | Unchanged. `delete_rows`' description names the budget-month bands instead of the old ones. |

Also removed: the 信用卡帳單對帳區 bucket audit/healing that runs on every
monthly write.

**The refusal.** Every write tool checks the layout first (the existing
`isBudgetMonth`) and refuses before writing anything. One message shape,
e.g. *"9 月 is on the old layout, which is read-only now — month_summary
still reads it; no tool writes to it."* *(My call on wording.)*

### Docs

- **`get_sheet_conventions`:** the budget layout becomes the description of
  a month tab. The old-layout section shrinks to a short read-only note:
  which tabs it covers, the anchors `month_summary` reads, and that no tool
  writes to them. That's enough to make sense of an old tab with
  `read_range`. The closing "prefer the tailored tools" paragraph drops the
  removed tools.
- **README:** the tool list drops the three removed tools and the
  card/bucket notes. The budget-months section says old months are
  read-only.

### Tests

- Delete the tests for removed behavior: lunch log, card buckets, bank
  balances, set_expense_date, the old start_month path, and the old-layout
  halves of the write tools.
- Add one refusal test per write tool on an old-layout fixture, asserting
  that nothing is written.
- Keep the old-layout `month_summary` tests and every budget-month test
  unchanged.
- `npm test` and `npm run type-check` pass.

### Rollout

1. Part 1 on the live sheet, with today's deployed server.
2. Part 2 on branch `claude/lucid-einstein-ogggob`; deploys when merged to
   `main`.
3. After deploy:
   - `month_summary` on 9 月 (old) and 10 月 (budget) both read.
   - `add_expense` on 9 月 refuses.
   - A throwaway `add_expense` / `delete_expense` on 10 月 works.

## Left to the builder

- How the dead code is cut, e.g. whether month_summary's old-layout reader
  moves to its own module.
- Which constants in `src/conventions.ts` go, provided month_summary's
  old-layout path keeps every label it reads.
- Exact refusal wording and result shapes. `add_transfer` jpy may drop its
  `wiringNote` or keep a fixed one.
