/**
 * Single source of truth for the layout of Vincent's personal-finance
 * spreadsheet. Every tailored tool reads its anchors, labels, and lists from
 * here — when the sheet layout changes, this file (and only this file)
 * changes with it.
 */

export const TOTAL_ROW_LABEL = "花費總額";

/**
 * The first cell of every 日期/項目/金額-style header row on the sheet — the
 * budget blocks, the 乾坤大挪移 logs and the old months' 午餐預算 log all
 * start their header with it. The finders SCAN for it rather than assuming it sits a
 * fixed number of rows under its section title: a hand-inserted row, or a
 * neighbouring section's band insert, can open a blank row between a title
 * and its header at any time.
 */
export const DATE_HEADER_LABEL = "日期";

/** 類別 tags seen in the sheet's column C. Documentation, not validation — the cell is free text. */
export const KNOWN_TAGS = ["訂閱", "吃喝", "交通", "生活用品", "娛樂", "購物", "其他", "透支", "學貸"] as const;

/** Column-A anchor labels for the budget/income section (values in the adjacent column). */
export const OVERDRAFT_LABEL = "上月透支";
/**
 * Per-currency carry rows (rows 3-4 from 7月 2026): each currency's negative
 * 本月…收支狀況 from last month rolls in as this month's expense —
 * =IF(-('prev'!D<收支狀況 row>) > 0, -(…), 0). 上月美金透支 carries USD in
 * column D (F=USD, so it debits the USD ledger like any USD row);
 * 上月新臺幣透支 carries TWD in column E (F=TWD). Tabs predating the split
 * keep the single TWD 上月透支 row. The carries are BUDGET-view devices
 * (收支狀況 counts covering them toward this month's performance); the
 * balance ledger adds them back — see the 銀行餘額 comment below.
 */
export const PREV_USD_OVERDRAFT_LABEL = "上月美金透支";
export const PREV_NTD_OVERDRAFT_LABEL = "上月新臺幣透支";
export const SALARY_LABEL = "薪水";
export const REPAYMENT_LABEL = "沛還";
export const REMAINDER_LABEL = "剩餘";
export const USD_PAYMENT_LABEL = "美金支付";
export const NTD_PAYMENT_LABEL = "新臺幣支付";
export const BUDGET_HEADER_LABEL = "總預算";
/** The income list's own header row (項目/幣別/金額 in B-D) directly under 總預算. */
export const INCOME_HEADER_LABEL = "項目";

/**
 * Month-view rows (labels in column B, values in column D):
 * 本月美金收支狀況/本月新臺幣收支狀況 are THIS month's 收入−支出 per
 * currency, wired to the 銀行餘額 block's cells; the NTD one additionally
 * adds 午餐超支或回補 so the lunch leftover counts toward the month's own
 * performance. The sheet now uses the 收支狀況 titles; the 本月美金餘額/
 * 本月新臺幣餘額 titles remain as a legacy fallback for tabs that predate
 * the rename — the finders accept both. They replace the old 剩餘 / 美金支付
 * / 新臺幣支付 rows; the interim 月剩餘 / 透支沖銷 rows are gone from the sheet.
 */
export const MONTH_USD_NET_LABEL = "本月美金收支狀況";
export const MONTH_NTD_NET_LABEL = "本月新臺幣收支狀況";
/** All titles the month-view rows have carried, newest first — for renamed-anchor lookups. */
export const MONTH_USD_NET_LABELS = [MONTH_USD_NET_LABEL, "本月美金餘額"] as const;
export const MONTH_NTD_NET_LABELS = [MONTH_NTD_NET_LABEL, "本月新臺幣餘額"] as const;

/**
 * Budget months (from 11 月 2026): one block per category instead of one
 * expense list. start_month builds them by copying the template tab.
 */
export const BUDGET_TEMPLATE_TAB = "Budget Based";
/** Column-B label of the month's single USD→TWD rate (value in column C) — also the budget-month anchor. */
export const RATE_LABEL = "本月匯率";
/** Column-D label of the budget list's total (value in column E). */
export const BUDGET_SUM_LABEL = "預算總額";
export const BUDGET_ALLOCATED_LABEL = "編列預算";
/** A category block's title is `<category>支出`. */
export const BUDGET_BLOCK_TITLE_SUFFIX = "支出";
export const CURRENCY_HEADER_LABEL = "幣別";
export const AMOUNT_HEADER_LABEL = "金額";
export const OVERSPEND_LABEL = "本月超支";
export const OVERSPEND_NET_LABEL = "本月超支（加上回補）";
/** The overspend paid in NTD: each category's TWD entries past its TWD budget lines (≤ 0). 本月新臺幣收支狀況 adds it. */
export const NTD_OVERSPEND_LABEL = "本月新臺幣超支";
/** The overspend paid in USD, in USD: each category's USD entries past its USD budget lines (≤ 0). 本月美金收支狀況 adds it. */
export const USD_OVERSPEND_LABEL = "本月美金超支";
/** Every block's 美金 剩餘 added up, unspent budget included. */
export const USD_OVERSPEND_NET_LABEL = "本月美金超支（加上回補）";
/** Every block's 新臺幣 剩餘 added up, unspent budget included. */
export const NTD_OVERSPEND_NET_LABEL = "本月新臺幣超支（加上回補）";
/** A block's money rows, labelled in its first column; 編列預算 / 總和 / 剩餘 sit in the next three. */
export const BLOCK_USD_ROW_LABEL = "美金";
export const BLOCK_NTD_ROW_LABEL = "新臺幣";
export const TOTAL_SPENDING_LABEL = "總支出";
/** Block titles whose category differs from the title stem: the 午餐支出 block holds the 中餐 budget. */
export const BUDGET_CATEGORY_ALIASES: Readonly<Record<string, string>> = { 午餐: "中餐" };

/**
 * Labels of an OLD-LAYOUT month's 銀行餘額 block (labels in column B,
 * values in column D): the month's per-currency money flow, opening and
 * closing balances, and their 調整後 rows. Old-layout months are read-only;
 * these stay so month_summary can read them and set_income can refuse them
 * as income items.
 */
export const USD_INCOME_LABEL = "本月美金收入";
export const USD_SPENDING_LABEL = "本月美金支出";
export const USD_START_BALANCE_LABEL = "本月初美金餘額";
export const USD_END_BALANCE_LABEL = "本月底美金餘額";
export const NTD_INCOME_LABEL = "本月新臺幣收入";
export const NTD_SPENDING_LABEL = "本月新臺幣支出";
export const NTD_START_BALANCE_LABEL = "本月初新臺幣餘額";
export const NTD_CONSERVATIVE_END_LABEL = "保守預計本月底新臺幣餘額";
export const NTD_END_BALANCE_LABEL = "本月底新臺幣餘額";
export const ADJUSTED_NTD_END_BALANCE_LABEL = "調整後的本月底新臺幣餘額";
export const ADJUSTED_USD_END_BALANCE_LABEL = "調整後本月底美金餘額";
/** Both spellings the USD row carries (6月 wrote 調整後的…), newest first. */
export const ADJUSTED_USD_END_BALANCE_LABELS = [ADJUSTED_USD_END_BALANCE_LABEL, "調整後的本月底美金餘額"] as const;

/** The 銀行餘額 block's header row label. */
export const BANK_BLOCK_LABEL = "銀行餘額";

/**
 * Labels of an OLD-LAYOUT month's 帳戶實際數字對應 block (labels in column
 * B, values in column D), which reconciled the real bank accounts: cash rows
 * when they happened, card bills when they were paid, and a hand-set
 * …餘額調整 per currency. Read-only now; kept so set_income refuses them as
 * income items.
 */
export const REAL_SECTION_LABEL = "帳戶實際數字對應";
export const REAL_NTD_START_BALANCE_LABEL = "本月初新臺幣真實餘額";
export const REAL_NTD_CASH_SPENDING_LABEL = "本月新臺幣現金支出";
export const REAL_NTD_CARD_PAYMENT_LABEL = "本月新臺幣信用卡繳費";
export const REAL_NTD_END_BALANCE_LABEL = "本月底新臺幣真實餘額";
export const REAL_USD_START_BALANCE_LABEL = "本月初美金真實餘額";
export const REAL_USD_CASH_SPENDING_LABEL = "本月美金現金支出";
export const REAL_USD_CARD_PAYMENT_LABEL = "本月美金信用卡繳費";
export const REAL_USD_END_BALANCE_LABEL = "本月底美金真實餘額";
export const NTD_ADJUSTMENT_LABEL = "新臺幣餘額調整";
export const USD_ADJUSTMENT_LABEL = "美金餘額調整";
export const ADJUSTED_REAL_NTD_END_LABEL = "調整後本月底新臺幣真實餘額";
export const ADJUSTED_REAL_USD_END_LABEL = "調整後本月底美金真實餘額";

export function monthTabName(month: number): string {
	if (!Number.isInteger(month) || month < 1 || month > 12) {
		throw new Error(`Invalid month: ${month} (expected an integer 1-12)`);
	}
	return `${month} 月`;
}

/** The sheet's months follow Taipei time; Workers run in UTC. */
export const SHEET_TIMEZONE = "Asia/Taipei";

/** 0-indexed columns of a monthly tab (日期 column added as A in 2026-07, 類別 column as C shortly after). */
export const MONTH_COLS = {
	/** A — 日期, a real date displayed mm/dd; blank on recurring rows. */
	date: 0,
	/** B — 項目 (also where 上月透支 and the budget-block labels live). */
	item: 1,
	/** C — 類別, the per-row tag (訂閱, 吃喝, …); doubles as the income list's 幣別 column. */
	tag: 2,
	/** D — 美金 (USD). */
	usd: 3,
	/** E — 新臺幣 (TWD). */
	twd: 4,
	/** F — 支付幣別, which real account paid the row (USD/TWD). */
	paidWith: 5,
	/** G — 支付方式, which credit card charged the row (a CREDIT_CARDS name); blank = cash/transfer. */
	paidMethod: 6,
	/** D — the 花費總額 label. */
	totalLabel: 3,
	/** E — the 花費總額 =SUM window. */
	totalValue: 4,
	/** B — budget-block labels (沛還/薪水/本月…收支狀況/銀行餘額 rows). */
	budgetLabel: 1,
	/** D — budget-block values. */
	budgetValue: 3,
} as const;

/**
 * 乾坤大挪移 — a currency-transfer log: NTD→USD on budget months (BA–BG,
 * 總和 on top of an open-ended list), NTD→JPY on trip tabs (A–G, 總和 below
 * the entries). Only the 手續費 is spending; the principal is a transfer.
 */
export const TRANSFER_SECTION_LABEL = "乾坤大挪移";
export const TRANSFER_TOTAL_LABEL = "總和";

/**
 * 乾坤大挪移（日幣）— the NTD→JPY transfer log on TRIP tabs (from the
 * 2026/07/25 京都東京 trip on), columns A–G below all trip content. Same
 * anatomy as the USD log; the JPY received is trip cash and joins no month.
 */
export const TRANSFER_JPY_COLS = {
	/** A — 日期; also the column of the section title and the 總和 label. */
	date: 0,
	/** B — 新臺幣 debited from the bank. */
	ntd: 1,
	/** C — 當下日幣 = 新臺幣 / spot rate, pinned at entry time. */
	spot: 2,
	/** D — 實際日幣: the JPY that actually arrived. */
	actual: 3,
	/** E — 匯差 in NTD = (當下日幣 − 實際日幣) × the pinned rate. */
	spread: 4,
	/** F — 手續費 in NTD. */
	fee: 5,
	/** G — 當筆總額外花費 = 匯差 + 手續費. */
	extra: 6,
} as const;

/** Header row of the JPY section, left to right from TRANSFER_JPY_COLS.date. */
export const TRANSFER_JPY_HEADERS = [
	"日期",
	"新臺幣",
	"當下日幣",
	"實際日幣",
	"匯差",
	"手續費",
	"當筆總額外花費",
] as const;

/**
 * 午餐預算 (originally titled 中餐預算) — the lunch-budget log of OLD-LAYOUT
 * months (7 月–9 月 2026, read-only now; month_summary still reports it).
 * Title in P; two rows below it a values row (P=編列預算, R=剩餘 = 編列預算
 * − 總和); then a 日期/項目/金額 header, data rows, and a 總和 row (label in
 * Q, =SUM in R). 午餐超支或回補 in the 銀行餘額 block = the 剩餘 cell.
 */
export const LUNCH_SECTION_LABEL = "午餐預算";
/** The section's original title (7月 2026 setup) — the finders accept both. */
export const LUNCH_SECTION_LEGACY_LABEL = "中餐預算";
export const LUNCH_TOTAL_LABEL = "總和";
/** The label above the values row; its own row + 1 holds the 編列預算/剩餘 values. */
export const LUNCH_BUDGET_LABEL = "編列預算";
export const LUNCH_ADJUST_LABEL = "午餐超支或回補";

/** 0-indexed columns of the 午餐預算 section (P–S, one right of the original O–Q since the 支付方式 column landed in G). */
export const LUNCH_COLS = {
	/** P — 日期; also the column of the section title, the 編列預算 label, and the budget value. */
	date: 15,
	/** Q — 項目; also the column of the 總和 label. */
	item: 16,
	/** R — 金額; also the 剩餘 value and the 總和 =SUM cell. */
	amount: 17,
	/** S — 支付方式, the card that paid the lunch, or 現金/blank for cash. */
	paidMethod: 18,
} as const;

/** Sheets date serial: days since 1899-12-30. */
export function dateSerial(year: number, month: number, day: number): number {
	return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** Inverse of dateSerial: Sheets serial → "YYYY-MM-DD". */
export function serialToIso(serial: number): string {
	return new Date(serial * 86_400_000 + Date.UTC(1899, 11, 30)).toISOString().slice(0, 10);
}

/** Today's calendar date in Taipei as a Sheets serial. */
export function todaySerial(now: Date = new Date()): number {
	// en-CA formats as YYYY-MM-DD
	const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: SHEET_TIMEZONE })
		.format(now)
		.split("-")
		.map(Number);
	return dateSerial(y, m, d);
}

const DATE_INPUT_RE = /^(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})$/;

/** "M/D", "MM/DD", "YYYY/M/D", or "YYYY-MM-DD" → Sheets serial; a missing year means the current year in Taipei. */
export function parseDateInput(input: string, now: Date = new Date()): number {
	const m = input.trim().match(DATE_INPUT_RE);
	if (!m) {
		throw new Error(`Unrecognized date "${input}" (expected M/D, MM/DD, or YYYY-MM-DD).`);
	}
	const year =
		m[1] !== undefined
			? Number(m[1])
			: Number(new Intl.DateTimeFormat("en-US", { timeZone: SHEET_TIMEZONE, year: "numeric" }).format(now));
	const month = Number(m[2]);
	const day = Number(m[3]);
	const d = new Date(Date.UTC(year, month - 1, day));
	if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
		throw new Error(`Invalid date "${input}".`);
	}
	return dateSerial(year, month, day);
}

export function currentMonthTab(now: Date = new Date()): string {
	const month = Number(
		new Intl.DateTimeFormat("en-US", { timeZone: SHEET_TIMEZONE, month: "numeric" }).format(now),
	);
	return monthTabName(month);
}

export function previousMonth(month: number): number {
	return month === 1 ? 12 : month - 1;
}

/** Trip tabs: a block header row starts with these two cells, side by side. */
export const TRIP_HEADER_DATE = "日期";
export const TRIP_HEADER_SHOP = "店鋪";
/** A block's terminator row contains this substring (may be prefixed, e.g. 分類總花費, 機票住宿分類總花費, 食總花費). */
export const TRIP_TOTAL_LABEL = "總花費";
/** Fallback block depth when NO terminator row exists — not a limit on the terminator scan itself. */
export const TRIP_MAX_BLOCK_ROWS = 30;
/** Each block is 7 data columns (日期 店鋪 品項 支付方式 日幣原價 臺幣 臺幣進位) + 1 spacer. */
export const TRIP_BLOCK_WIDTH = 8;

/**
 * 目前實際開銷 — the budget-vs-actual summary at the bottom-right of a trip
 * tab's grid (~AI46 on 2026/07/25 京都東京): the title, a
 * 分類/金額/預算/預算餘額/餘額 JP header row directly below it, then one row
 * per budget category (金額 = actual spend so far, 預算餘額 = 預算 − 金額,
 * 餘額 JP = the remainder converted to JPY). The list ends at the first row
 * whose 分類 cell holds no text — the =SUM total row and the hand subtotal
 * below it are not categories.
 */
export const TRIP_BUDGET_SECTION_LABEL = "目前實際開銷";
export const TRIP_BUDGET_CATEGORY_HEADER = "分類";
/** The summary's 5 columns, left to right from the 分類 column. */
export const TRIP_BUDGET_WIDTH = 5;

export const CONVENTIONS_TEXT = `How this personal-finance spreadsheet is organized:

MONTHLY TABS — named "N 月" (e.g. "9 月", with a space). This section describes 5 月–10 月 2026 and the "11 月 DEP" / "12 月 DEP" copies; from 11 月 2026 on, months use the BUDGET MONTHS layout described after it. Layout below applies from 6 月 2026 on (6 月 was rebuilt onto it; the original June tab survives as "6 月 DEP"). 5 月 and 6 月 DEP are frozen history on the old layout (no 類別/支付幣別 columns, a hand-entered income list ending at a single 剩餘 row) — never write into them and never wire formulas at them.
- Header row 2: 日期 項目 類別 美金 新臺幣 支付幣別 支付方式. Expense list in columns A-G from row 3 down: A=日期 (a real date shown mm/dd; blank on recurring rows), B=item, C=類別 (per-row tag: 訂閱, 吃喝, 交通, 生活用品, 娛樂, 購物, 其他, 透支, 學貸), D=美金 (USD), E=新臺幣 (TWD), F=支付幣別 (USD or TWD — which real account PAID the row; a USD-priced expense paid with a TWD card has D filled but F=TWD), G=支付方式, how the row was actually charged — a dropdown holding exactly: 國泰 CUBE, CHASE Amazon, CHASE Freedom, Apple Card (feeds that card's 信用卡帳單對帳區 buckets), 現金 (money left a bank account directly — cash/debit/auto-pay; feeds the 帳戶實際數字對應 block's 現金支出), and 沛 (沛 paid — hits no tracked account); blank = the row isn't wired to any account. add_expense's card param accepts every dropdown option, not just cards.
- USD rows convert with E = D*GOOGLEFINANCE("CURRENCY:USDTWD").
- The list ends at the "花費總額" row (label in column D, total in E, formula SUM over the window). New expenses must land INSIDE that window — write into an empty row above 花費總額, or insert a row inside the window so the SUM extends. Never append below 花費總額. Removing an expense means DELETING its row (delete_expense) — blanking the cells with update_range leaves a hole in the middle of the list; the delete is scoped to columns A-G so the blocks sharing those sheet rows stay put, and the SUM/SUMIF windows shrink with the row. The tools keep the list date-sorted — add_expense and set_expense_date place rows after the last not-later 日期, dateless rows last, matching an ascending UI sort.
- Rows 3-4 carry last month's per-currency shortfalls via cross-tab formulas: 上月美金透支 (USD in D, F=USD, E converts at live GOOGLEFINANCE like any USD row) and 上月新臺幣透支 (TWD in E, F=TWD), each =IF(-('prev'!D<row>) > 0, -(…), 0) against the previous month's 本月…收支狀況 cell — a currency's negative month closes by becoming this month's expense; a positive month carries 0. start_month rebuilds both anchors. Tabs predating the split (6月 and earlier) have a single TWD 上月透支 row anchored at the previous month's 剩餘.
- Categorization is the per-row 類別 tag in column C (see month_summary's per-類別 totals). The old G/H summary block is DEPRECATED — ignore any remnants.
- Below the list, the income section: a 總預算 header row, a 項目/幣別/金額 header row, then the income list (labels in B, 幣別 USD/TWD in C, amounts in D): 沛還, 薪水, plus ad-hoc income rows (e.g. 多一個月薪水) — manage these with set_income, which upserts by 項目 and keeps the rows inside the 本月…收入 SUMIF windows. Further down sit 本月美金收支狀況 / 本月新臺幣收支狀況 (legacy exports may still title them 本月美金餘額 / 本月新臺幣餘額 — the finders accept both): THIS month's 收入−支出 per currency wired to the 銀行餘額 block's cells, the NTD one additionally adding 午餐超支或回補 so the lunch leftover counts toward the month's own performance. The old 剩餘 / 美金支付 / 新臺幣支付 rows and the interim 月剩餘 / 美金透支沖銷 / 新臺幣透支沖銷 rows no longer exist.
- Further down, the 銀行餘額 block tracks the month's per-currency money flow (labels in column B, values in column D): 本月美金收入 / 本月美金支出 / 本月初美金餘額 / 本月底美金餘額, then 本月新臺幣收入 / 本月新臺幣支出 / 午餐超支或回補 / 本月初新臺幣餘額 / 保守預計本月底新臺幣餘額 / 本月底新臺幣餘額. 收入 cells = SUMIF over the income list's 幣別 column; 本月美金支出 = SUMIF of the expense 支付幣別 for USD summing column D; 本月新臺幣支出 = SUMIF for TWD summing column E, plus the transfer block's M總和 (手續費 only — the 匯差 is already inside the −I總和 principal). Both 支出 SUMIFs span the FULL expense window INCLUDING the 上月…透支 carry row(s) — deliberate: Vincent counts the carried shortfall as an outflow that must be covered out of this month's money in the 收支狀況 budget view. The 本月底…餘額 / 保守預計 formulas then ADD THE CARRY BACK (+ the 上月美金透支 D cell / + the 上月新臺幣透支 E cell): with the openings chained, the shortfall already arrives via the negative opening balance, so without the add-back the balance ledger would subtract it twice. Keep both halves — do not "simplify" away either the SUMIF window or the +carry terms. BOTH currencies chain since the 調整 layout: 本月初美金餘額 / 本月初新臺幣餘額 point at the previous month's 調整後 rows (start_month rewires them; 本月初美金餘額 is no longer a hardcoded 0). 本月底美金餘額 = 本月初 + 收入 − 支出 + K總和 (USD received); 本月底新臺幣餘額 = 本月初 + 收入 − 支出 − I總和 (NTD sent) + 午餐超支或回補; 保守預計本月底新臺幣餘額 is the same but counts 午餐超支或回補 only when it is negative (a lunch overspend). Below each 本月底 row sits 調整後本月底美金餘額 / 調整後的本月底新臺幣餘額 (6月 titles the USD one 調整後的… too) = the raw 本月底 + that currency's …餘額調整 cell from the 帳戶實際數字對應 block — the bank view absorbs the same reconciliation delta.
- Right below that, the 帳戶實際數字對應 block (from 7月 2026 on; labels in B, values in D) reconciles the REAL bank-account numbers: where 銀行餘額 books every expense when it is incurred, this block books money when it actually moves — cash rows (支付方式=現金) as they happen, credit-card charges only when the bill is PAID. NTD block: 本月初新臺幣真實餘額 (start_month rewires it to the previous month's 調整後本月底新臺幣真實餘額), 本月新臺幣現金支出 (SUMIFS over the expense window keyed 支付幣別=TWD + 支付方式=現金, plus the transfer block's M總和 fees), 本月新臺幣信用卡繳費 (= the TWD-billed card's 本月需繳款), 本月底新臺幣真實餘額 (= 初 + income SUMIF − 現金支出 − 信用卡繳費 − I總和 NTD sent), then 新臺幣餘額調整 and 調整後本月底新臺幣真實餘額 (= 本月底 + 調整). A blank row, then the mirrored USD block ending in 美金餘額調整 / 調整後本月底美金真實餘額. The …餘額調整 cells are the ONLY hand/tool-owned cells here: when the real bank account disagrees with the computed 本月底…真實餘額, log the ACTUAL balance with adjust_balance — it writes actual − 本月底…真實餘額 into the 調整 cell (overwriting, not accumulating), which flows into both this block's 調整後 row and the 銀行餘額 view's. start_month resets both 調整 cells to 0 on the new tab and chains every 本月初 row from the 調整後 rows, so a reconciled month closes into the next month's opening balances. 6月 seeds its 本月初 cells with hand-typed numbers.
- To the right of the expense list, a 乾坤大挪移 block (the NTD→USD transfer log, from 7月 2026 on) spans columns H-N: the title in H, a header row (日期 新臺幣 當下美金 實際美金 匯差 手續費 當筆總額外花費), data rows, then a 總和 row with per-column SUMs. 當下美金 and 匯差 are pinned to the USDTWD rate at entry time (a literal number, not live GOOGLEFINANCE). The 銀行餘額 block wires to the 總和 row: 本月底美金餘額 adds +K總和 (USD received), 本月底新臺幣餘額 subtracts -I總和 (NTD sent), and 本月新臺幣支出 adds +M總和 so the 手續費 counts as the month's NTD spending — the fee is charged externally, on top of the NTD sent, while the 匯差 is already inside the −I總和 principal (counting it in 支出 would double it); the principal itself is a transfer, not income or spending. Log transfers with add_transfer; never hand-extend the 總和 formulas. A second 乾坤大挪移 variant lives on TRIP tabs (from the 2026/07/25 京都東京 trip on), columns A-G below all trip content: 日期 新臺幣 當下日幣 實際日幣 匯差 手續費 當筆總額外花費, data rows, then a 總和 row — same anatomy, JPYTWD rate pinned at entry. The JPY received is trip cash and joins NO bank ledger; the NTD side is wired PER ENTRY into the month tab the 日期 falls in (cross-tab terms appended to that month's 本月底新臺幣餘額 and 保守預計本月底新臺幣餘額 (−新臺幣) and 本月新臺幣支出 (+手續費 only, same rule as the USD block)). Log these with add_transfer currency:'jpy' (tab = the trip tab); when the section is full the tool inserts cells scoped to A-G, never whole rows.
- Also to the right, a 午餐預算 block (columns P-S, from 7月 2026 on; early tabs may still title it 中餐預算 — both anchors work): the recurring 中餐 row in the expense list is the month's lunch BUDGET, and actual lunches are logged in this block instead of the expense list. Title in P; a 編列預算 / 剩餘 (負數會加回去支出) values row two rows below it (編列預算 points at the 中餐 expense cell; 剩餘 = 編列預算 − 總和); then a 日期 項目 金額 支付方式 header, data rows, and a 總和 row (label in Q, =SUM in R). The leftover feeds the 銀行餘額 block's 午餐超支或回補 row: 本月底新臺幣餘額 gains unspent budget back, an overdraft (negative 剩餘) deducts more — and 本月新臺幣收支狀況 adds the same 午餐超支或回補 so the month's own NTD performance includes it. S=支付方式: a TWD-billed card name (currently 國泰 CUBE) when a card paid the lunch, 現金 or blank for cash — card lunches ALSO appear in that card's 信用卡帳單對帳區 buckets and count into its 本月需繳款; the 中餐 budget row in the expense list must NEVER carry a 支付方式 in G (it is a budget, not a charge — the individual lunches are the card charges). Log lunches with add_lunch; never hand-extend the 總和 formula and never add_expense a lunch.
- Below the 乾坤大挪移 block sits the 信用卡帳單對帳區 (from 7月 2026 on), one reconciliation block per credit card in a 2×2 grid (columns H-J and L-N): 國泰 CUBE (bills TWD), CHASE Amazon, CHASE Freedom, Apple Card (bill USD). Each block: the card name, 本月結帳日 / 本月繳款日 (hand-owned dates; start_month bumps them one month), 本月需繳款 (what this month's 繳款日 pays — CHASE Amazon: this tab's 結帳日前小計 + the previous tab's 結帳日後小計; the other three: the previous tab's 結帳日前小計 + the tab-before-that's 結帳日後小計), then 結帳日前 and 結帳日後 buckets: each a label row, a 日期/項目/金額 header row, a mirror formula that spills matching rows date-sorted, and a 小計 row (label in the block's 2nd column, =SUMIFS in the 3rd). No row of a block sits a fixed distance from any other — every bucket grows with its card's charge count, and the two column bands stack independently — so locate a block's rows by looking for its labels (find_cells), never by counting from the card name or from another card's block. 結帳日前 is strictly 日期 < 結帳日 — a row dated ON the 結帳日 belongs to 結帳日後 (the next statement) — EXCEPT Apple Card: its statement is the calendar month (closes on the month's last day, that day included), so its 結帳日前 is 日期 <= 結帳日 and only later rows fall into 結帳日後. The mirrors key on 支付方式: the expense list's column G, and — for the TWD-billed 國泰 CUBE only — also the 午餐預算 log's column S (QUERY-merged). Rows need a real 日期 (a dateless subscription joins the moment its date is filled) and 金額 is the card's billing currency: D for the US cards, E (and lunch R) for 國泰 CUBE. Never hand-edit the mirror spills, 小計s, or 本月需繳款 — log card expenses with add_expense (card param) and card lunches with add_lunch (card param). The buckets' spill areas GROW automatically when a tool adds a card row (add_expense with card+date, add_lunch with card, set_expense_date on a card row), and each such write also re-stamps the bucket's number formats (日期 mm/dd, 金額 in the card's billing currency) over the whole spill area — a spill row showing a raw date serial or bare amount heals on the next guarded write to that card. But a date filled by hand in the UI triggers nothing: an overflowing bucket shows #REF! until the next guarded write or a manual row insert above the 小計. 7月 bootstraps by hand: the lag-1 cards' 本月需繳款 and CHASE Amazon's June tail are typed in (5月/6月 have no section).

BUDGET MONTHS — from 11 月 2026 on, month tabs ("N 月") use a budget layout (a budget month is recognised by the 本月匯率 label in column B). The old layout above stays on 5 月–10 月 and on the "N 月 DEP" copies.
- Left side (A–F), every row located by its label: 上月美金透支 (USD in D, E = D × 本月匯率) and 上月新臺幣透支 (TWD in E) carry the previous month's negative 本月…收支狀況, same formula shape as before. Then the budget list, two rows per category — "<類別>美金預算" (D = the USD budget, E = D × 本月匯率, F = USD) and "<類別>新臺幣預算" (E = the NTD budget, F = TWD) — 18 rows for the nine categories; C = 類別. Right below the list: 本月匯率 (label B, value C), the month's single USD→TWD rate — a formula that shows the live rate until the 1st of the month and then locks to the 1st's rate; every conversion on the tab references it — and 預算總額 (label D, value E, every budget in NTD). Further down: 總預算 and the 項目/幣別/金額 income list (薪水 TWD, 沛還 USD, …), then the two lines built the same way, one per account: 本月美金收支狀況 (USD income − 上月美金透支 − the USD budget lines + 本月美金超支), in USD from column D with no conversion, and 本月新臺幣收支狀況 (TWD income − 上月新臺幣透支 − the TWD budget lines + 本月新臺幣超支 − the 乾坤大挪移 手續費). Each subtracts its currency's BUDGET (unspent budget stays reserved) plus that currency's overspend: 本月美金超支 adds up every block's negative 美金 剩餘 (in USD, ≤ 0) and 本月新臺幣超支 every block's negative 新臺幣 剩餘 (≤ 0). 本月美金超支（加上回補） and 本月新臺幣超支（加上回補） add up every block's 剩餘 in that currency, unspent budget included. 總支出 = every block's 美金 總和 × 本月匯率 + every 新臺幣 總和 + 手續費, in NTD.
- Nine category blocks to the right (H…AY, four columns plus a spacer each): a "<category>支出" title (午餐支出 holds the 中餐 budget), then a small table above the entries: a 編列預算 / 總和 / 剩餘 header row, then a 美金 row and a 新臺幣 row (the label in the block's first column, the three figures in the next three). The 美金 row is all in USD: 編列預算 from the "<類別>美金預算" row, 總和 = the entries whose 幣別 is USD, 剩餘 = 編列預算 − 總和. The 新臺幣 row is all in NTD: 編列預算 from "<類別>新臺幣預算", 總和 = every other entry (a blank 幣別 counts as TWD), 剩餘 likewise. Nothing inside a block is converted. Then a 日期/項目/金額/幣別 header and entries running down, open-ended. 幣別 is the currency of the account that PAID — a USD-priced charge paid from the NTD account is TWD, at amount × 本月匯率. 幣別 is a dropdown whose rule the template only puts on its own rows: add_expense copies the 幣別 dropdown rule onto the new row (from the nearest entry above that has it, healing any rows in between; when nothing above has one, from another block's 幣別, onto the block's whole column down to the new row), so log entries with add_expense — a 幣別 written with update_range shows as plain text. Never write anything below a block except entries: the open-ended 總和 counts every number in its column.
- 乾坤大挪移 (NTD→USD transfers) sits after the last block (BA–BG) with the same anatomy: 總和 on top, the header, open-ended entries. Only its 手續費 counts as spending.
- A budget month has no 信用卡帳單對帳區, 銀行餘額, 帳戶實際數字對應 or 午餐預算 log.
- start_month copies the "Budget Based" template tab — its starting entries, budgets and income come along as they are — then writes the title, points both carries at the previous month and writes the 本月匯率 formula. replace_old_layout:true rebuilds an EXISTING old-layout month: the old tab is renamed "N 月 DEP" first; a budget month is never replaced. To change what every new month starts with, edit the template tab by hand.
- Tools on budget months: add_expense (tag required, it picks the block; card is refused), delete_expense (tag narrows the search to one block), set_income, add_transfer, month_summary (returns layout:'budget', each block's money per currency), get_categories (returns the blocks) and start_month. add_lunch, set_expense_date and adjust_balance refuse. Never insert or delete whole rows on a budget tab — the budget list, income and blocks share sheet rows; scope delete_rows to one block's own columns.

TRIP TABS — e.g. "2026/07/25 京都東京".
- A mosaic of category blocks in four column bands (A-G, I-O, Q-W, Z-AF), stacked vertically within each band.
- Each block: a header row (日期, 店鋪, 品項, 支付方式, 日幣原價, 臺幣…, 臺幣進位), the category name on the row below it, data rows, and usually a …總花費 total row (the label varies: 分類總花費, 機票住宿分類總花費, 食總花費).
- Known categories: 模型, 鐵道模型, 書, 餐(當下吃的), 機票住宿, 雜支, 衣服/鞋子, 吃的伴手禮, 紀念品小物, 交通, 送禮, 入場券, 電子產品.
- Entries are JPY-priced (¥ → TWD at ~0.22 plus a rounded-up column) or TWD-direct (機票住宿-style: 日幣原價 empty, 臺幣 holds the NTD amount).
- Data rows render 日期 as mm/dd hh:mm (a real datetime), 日幣原價 with a ¥ sign, both 臺幣 columns with an NTD sign, and 店鋪/品項 centered — add_trip_entry stamps these formats onto the row it writes, so cells created by a block-scoped insert or never-formatted empties still render canonically.
- A budget-vs-actual summary titled 目前實際開銷 occupies the bottom-right of the grid (~AI46) — it is not a category block. A 分類/金額/預算/預算餘額/餘額 JP header sits under the title, then one row per budget category: 金額 = actual spend so far, 預算餘額 = what's left of that category's 預算, 餘額 JP = the remainder in JPY. Its 分類 names are budget buckets and need not match the category blocks one-to-one. Read it with trip_budget_status instead of raw reads.
- Never insert or delete whole sheet rows in a trip tab: a row insert or delete cuts across all bands and damages neighboring blocks. add_trip_entry writes into empty rows inside a block, or inserts cells scoped to the block's own columns; to remove an entry, delete_rows with columns set to that block's band (A-G, I-O, Q-W, Z-AF).
- A trip tab may carry its own 乾坤大挪移 block (NTD→JPY, columns A-G below all content) — see the transfer bullet above; add_transfer currency:'jpy' owns it.

OTHER — "火車模型" is a hobby purchase planner; monthly tabs may cross-reference its cells.

Prefer the tailored tools (add_expense, set_income, add_transfer, add_lunch, set_expense_date, adjust_balance, month_summary, start_month, add_trip_entry, trip_budget_status) over raw range edits. Locate rows with find_cells — never by reading a big range and counting rows. To REMOVE something, delete the row rather than blanking it: delete_expense for an expense row, delete_rows (with columns scoping it to the section's own band — A-G expense list, H-N 乾坤大挪移/對帳區, P-S 午餐預算, the trip bands) for anything else; both return what they deleted, and delete_rows refuses when a formula points straight at a deleted cell. For any append-like update_range write, pass expect_empty: true (it refuses if the target is not empty); every update_range response includes previousValues so a mistaken overwrite can be reverted. For math, read with mode "raw" — default reads return locale-formatted strings like "13,603.67".`;
