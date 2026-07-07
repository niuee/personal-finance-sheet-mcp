/**
 * Single source of truth for the layout of Vincent's personal-finance
 * spreadsheet. Every tailored tool reads its anchors, labels, and lists from
 * here — when the sheet layout changes, this file (and only this file)
 * changes with it.
 */

export const TOTAL_ROW_LABEL = "花費總額";

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
 * keep the single TWD 上月透支 row.
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
 * Labels for the 銀行餘額 block — the month's per-currency money flow, for
 * reality-checking the real USD and NTD bank accounts. All labels live in
 * column B with their values in column D. Since the 調整 layout (2026-07,
 * present on 6月 on) BOTH currencies chain month to month: each 本月初…餘額
 * points at the previous month's 調整後(的)本月底…餘額 (start_month rewires
 * them). On tabs predating the 調整 rows, only NTD chained (to the raw
 * 本月底新臺幣餘額) and 本月初美金餘額 stayed 0 — the USD shortfall carried
 * through the 上月美金透支 expense row instead. 本月底美金餘額 = 初 + 收入 −
 * 支出 + 實際美金總和; 本月底新臺幣餘額 = 初 + 收入 − 支出 − 轉出新臺幣總和
 * + 午餐超支或回補; 保守預計本月底新臺幣餘額 is the same but counts the
 * lunch leftover only when it is negative (an overspend). Each 調整後 row =
 * its raw 本月底 row + the currency's 餘額調整 cell in the 帳戶實際數字對應
 * block (shared with that block's own 調整後 rows). The NTD title carries a
 * 的 (調整後的…) on every tab; the USD one only on 6月 — finders accept both.
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
 * 帳戶實際數字對應 — the real-account reconciliation block below the 銀行餘額
 * block (labels in column B, values in column D), from 7月 2026 on. Where
 * 銀行餘額 books every expense when it is INCURRED, this block mirrors what
 * the real bank accounts see: cash rows (支付方式 = 現金) when they happen
 * plus credit-card bills when they are PAID (the cards' 本月需繳款 cells).
 * Per currency: 本月初…真實餘額 points at the previous month's
 * 調整後本月底…真實餘額 (the raw 本月底…真實餘額 on tabs predating the 調整
 * rows) — start_month rewires BOTH currencies; 本月…現金支出 = SUMIFS over
 * the expense window keyed on 支付幣別 + 支付方式="現金" (the NTD one adds the
 * transfer block's M總和 fees); 本月新臺幣信用卡繳費 = the TWD-billed card's
 * 本月需繳款, 本月美金信用卡繳費 = the three US cards'; 本月底…真實餘額 =
 * 初 + 收入 − 現金支出 − 信用卡繳費, minus I總和 (NTD sent) on the NTD side
 * and plus K總和 (USD received) on the USD side.
 *
 * Below each currency's 本月底…真實餘額 sit the 調整 rows (from 2026-07):
 * …餘額調整 is the ONLY hand/tool-owned cell — the delta between what the
 * formulas compute and what the real bank account shows (actual − 本月底…
 * 真實餘額; adjust_balance writes it, overwriting any previous value) — and
 * 調整後本月底…真實餘額 = 本月底…真實餘額 + 調整. The same 調整 cell also
 * feeds the 銀行餘額 view's 調整後 row, so one reconciliation moves both
 * views. start_month resets both 調整 cells to 0 on the new tab (the
 * duplicate would otherwise inherit last month's delta).
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

/** Items start_month keeps when opening a new month; everything else is a one-off. */
export const RECURRING_ITEMS = new Set<string>([
	OVERDRAFT_LABEL,
	PREV_USD_OVERDRAFT_LABEL,
	PREV_NTD_OVERDRAFT_LABEL,
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
	"ChatGPT",
	"GitHub Action Minutes",
	"Claude",
	"基本生活費",
]);

/** Income rows start_month keeps; every other income row is ad-hoc and cleared. */
export const RECURRING_INCOME = new Set<string>([REPAYMENT_LABEL, SALARY_LABEL]);

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
 * 乾坤大挪移 — the NTD→USD transfer log, present on monthly tabs from 7月
 * 2026 (start_month copies it forward). Title in column H, a header row
 * below it, data rows, then a 總和 row (label in H, =SUM per column I–N).
 * The 銀行餘額 block wires to the 總和 row: 本月底美金餘額 +K (USD
 * received), 本月底新臺幣餘額 −I (NTD sent), 本月新臺幣支出 +N (匯差+手續費
 * count as the month's NTD spending). The principal is a transfer, not
 * income/spending.
 */
export const TRANSFER_SECTION_LABEL = "乾坤大挪移";
export const TRANSFER_TOTAL_LABEL = "總和";

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

/**
 * 午餐預算 (originally titled 中餐預算) — the lunch-budget log (columns P–R), present on monthly tabs from
 * 7月 2026 (start_month copies it forward and clears its data rows). The
 * recurring 中餐 row in the expense list IS the month's lunch budget; actual
 * lunches are logged here, never in the expense list. Title in P; two rows
 * below it a values row (P=編列預算 pointing at the 中餐 expense cell,
 * R=剩餘 = 編列預算 − 總和); then a 日期/項目/金額 header, data rows, and a
 * 總和 row (label in Q, =SUM in R). The 銀行餘額 block wires to the leftover:
 * 午餐超支或回補 = the 剩餘 cell, feeding 本月底新臺幣餘額 (and, only when
 * negative, 保守預計本月底新臺幣餘額) — unspent budget flows back to the
 * bank, an overdraft (negative 剩餘) deducts more.
 */
export const LUNCH_SECTION_LABEL = "午餐預算";
/** The section's original title (7月 2026 setup) — the finders accept both. */
export const LUNCH_SECTION_LEGACY_LABEL = "中餐預算";
export const LUNCH_TOTAL_LABEL = "總和";
export const LUNCH_DEFAULT_ITEM = "中餐";
export const LUNCH_ADJUST_LABEL = "午餐超支或回補";

/** 0-indexed columns of the 午餐預算 section (P–S, one right of the original O–Q since the 支付方式 column landed in G). */
export const LUNCH_COLS = {
	/** P — 日期; also the column of the section title, the 編列預算 label, and the budget value. */
	date: 15,
	/** Q — 項目; also the column of the 總和 label. */
	item: 16,
	/** R — 金額; also the 剩餘 value and the 總和 =SUM cell. */
	amount: 17,
	/** S — 支付方式, the card that paid the lunch (a TWD-billed CREDIT_CARDS name) or 現金/blank for cash. */
	paidMethod: 18,
} as const;

/**
 * 信用卡帳單對帳區 — per-card statement reconciliation blocks in a 2×2 grid
 * (columns H–J and L–N) below the 乾坤大挪移 block, from 7月 2026 on. Each
 * block: card name, 本月結帳日/本月繳款日 dates, then 本月需繳款 — computed
 * directly across two months, with no 本期帳單總額 row in between: for
 * CHASE Amazon (statementLag 0) it's this tab's 結帳日前小計 + the previous
 * tab's 結帳日後小計; for the other three (statementLag 1) it's the previous
 * tab's 結帳日前小計 + the tab-before-that's 結帳日後小計 (omitted when that
 * tab doesn't exist). Then 結帳日前 and 結帳日後 buckets: each a label row, a
 * 日期/項目/金額 header row, a mirror formula that spills matching rows
 * date-sorted, and a 小計 row (label in the block's 2nd column, =SUMIFS in
 * the 3rd) keyed on the expense list's 支付方式 column (G) and 日期 vs 結帳日:
 * 結帳日前 is strictly 日期 < 結帳日 — a row dated ON the 結帳日 belongs to
 * 結帳日後, the next statement. Everything except the two date cells is
 * formula-owned.
 */
export interface CreditCard {
	/** Exact string used in column G, the block title, and the FILTER/SUMIFS conditions. */
	name: string;
	/** Which expense column the card's statements bill in: USD → D (美金), TWD → E (新臺幣). */
	billingCurrency: "USD" | "TWD";
	/** Which two months' buckets 本月需繳款 wires to: 0 = this tab's 結帳日前 + prev tab's 結帳日後, 1 = prev tab's 結帳日前 + prev-prev tab's 結帳日後. */
	statementLag: 0 | 1;
}

export const CREDIT_CARDS: readonly CreditCard[] = [
	{ name: "國泰 CUBE", billingCurrency: "TWD", statementLag: 1 },
	{ name: "CHASE Amazon", billingCurrency: "USD", statementLag: 0 },
	{ name: "CHASE Freedom", billingCurrency: "USD", statementLag: 1 },
	{ name: "Apple Card", billingCurrency: "USD", statementLag: 1 },
];

/**
 * The 支付方式 dropdown (expense column G, lunch column S) holds the four
 * CREDIT_CARDS names plus these non-card options. 現金 = the money left a
 * real bank account directly (cash, debit, auto-pay) — the 帳戶實際數字對應
 * block's 現金支出 SUMIFS key on it. 沛 = 沛 paid, no tracked account was
 * hit. Non-card rows have no 對帳區 bucket, so the bucket room guard never
 * runs for them.
 */
export const CASH_METHOD_LABEL = "現金";
export const PEI_METHOD_LABEL = "沛";
export const NON_CARD_PAYMENT_METHODS: readonly string[] = [CASH_METHOD_LABEL, PEI_METHOD_LABEL];

export const CREDIT_SECTION_LABEL = "信用卡帳單對帳區";
export const CREDIT_CLOSE_LABEL = "本月結帳日";
export const CREDIT_PAY_LABEL = "本月繳款日";
export const CREDIT_DUE_LABEL = "本月需繳款";
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
/** A block's terminator row contains this substring (may be prefixed, e.g. 機票住宿分類總花費). */
export const TRIP_TOTAL_LABEL = "分類總花費";
/** Scan cap for blocks with no terminator row. */
export const TRIP_MAX_BLOCK_ROWS = 30;
/** Each block is 7 data columns (日期 店鋪 品項 支付方式 日幣原價 臺幣 臺幣進位) + 1 spacer. */
export const TRIP_BLOCK_WIDTH = 8;

export const CONVENTIONS_TEXT = `How this personal-finance spreadsheet is organized:

MONTHLY TABS — named "N 月" (e.g. "9 月", with a space). Layout below applies from 6 月 2026 on (6 月 was rebuilt onto it; the original June tab survives as "6 月 DEP"). 5 月 and 6 月 DEP are frozen history on the old layout (no 類別/支付幣別 columns, a hand-entered income list ending at a single 剩餘 row) — never write into them and never wire formulas at them.
- Header row 2: 日期 項目 類別 美金 新臺幣 支付幣別 支付方式. Expense list in columns A-G from row 3 down: A=日期 (a real date shown mm/dd; blank on recurring rows), B=item, C=類別 (per-row tag: 訂閱, 吃喝, 交通, 生活用品, 娛樂, 購物, 其他, 透支, 學貸), D=美金 (USD), E=新臺幣 (TWD), F=支付幣別 (USD or TWD — which real account PAID the row; a USD-priced expense paid with a TWD card has D filled but F=TWD), G=支付方式, how the row was actually charged — a dropdown holding exactly: 國泰 CUBE, CHASE Amazon, CHASE Freedom, Apple Card (feeds that card's 信用卡帳單對帳區 buckets), 現金 (money left a bank account directly — cash/debit/auto-pay; feeds the 帳戶實際數字對應 block's 現金支出), and 沛 (沛 paid — hits no tracked account); blank = the row isn't wired to any account. add_expense's card param accepts every dropdown option, not just cards.
- USD rows convert with E = D*GOOGLEFINANCE("CURRENCY:USDTWD").
- The list ends at the "花費總額" row (label in column D, total in E, formula SUM over the window). New expenses must land INSIDE that window — write into an empty row above 花費總額, or insert a row inside the window so the SUM extends. Never append below 花費總額.
- Rows 3-4 carry last month's per-currency shortfalls via cross-tab formulas: 上月美金透支 (USD in D, F=USD, E converts at live GOOGLEFINANCE like any USD row) and 上月新臺幣透支 (TWD in E, F=TWD), each =IF(-('prev'!D<row>) > 0, -(…), 0) against the previous month's 本月…收支狀況 cell — a currency's negative month closes by becoming this month's expense; a positive month carries 0. start_month rebuilds both anchors. Tabs predating the split (6月 and earlier) have a single TWD 上月透支 row anchored at the previous month's 剩餘.
- Categorization is the per-row 類別 tag in column C (see month_summary's per-類別 totals). The old G/H summary block is DEPRECATED — ignore any remnants.
- Below the list, the income section: a 總預算 header row, a 項目/幣別/金額 header row, then the income list (labels in B, 幣別 USD/TWD in C, amounts in D): 沛還, 薪水, plus ad-hoc income rows (e.g. 多一個月薪水) — manage these with set_income, which upserts by 項目 and keeps the rows inside the 本月…收入 SUMIF windows. Further down sit 本月美金收支狀況 / 本月新臺幣收支狀況 (legacy exports may still title them 本月美金餘額 / 本月新臺幣餘額 — the finders accept both): THIS month's 收入−支出 per currency wired to the 銀行餘額 block's cells, the NTD one additionally adding 午餐超支或回補 so the lunch leftover counts toward the month's own performance. The old 剩餘 / 美金支付 / 新臺幣支付 rows and the interim 月剩餘 / 美金透支沖銷 / 新臺幣透支沖銷 rows no longer exist.
- Further down, the 銀行餘額 block tracks the month's per-currency money flow (labels in column B, values in column D): 本月美金收入 / 本月美金支出 / 本月初美金餘額 / 本月底美金餘額, then 本月新臺幣收入 / 本月新臺幣支出 / 午餐超支或回補 / 本月初新臺幣餘額 / 保守預計本月底新臺幣餘額 / 本月底新臺幣餘額. 收入 cells = SUMIF over the income list's 幣別 column; 本月美金支出 = SUMIF of the expense 支付幣別 for USD summing column D; 本月新臺幣支出 = SUMIF for TWD summing column E, plus the transfer block's N總和. Both 支出 SUMIFs span the FULL expense window INCLUDING the 上月…透支 carry row(s) — deliberate: Vincent counts the carried shortfall as an outflow that must be covered out of this month's money. Do not "fix" this as double-counting. BOTH currencies chain since the 調整 layout: 本月初美金餘額 / 本月初新臺幣餘額 point at the previous month's 調整後 rows (start_month rewires them; 本月初美金餘額 is no longer a hardcoded 0). 本月底美金餘額 = 本月初 + 收入 − 支出 + K總和 (USD received); 本月底新臺幣餘額 = 本月初 + 收入 − 支出 − I總和 (NTD sent) + 午餐超支或回補; 保守預計本月底新臺幣餘額 is the same but counts 午餐超支或回補 only when it is negative (a lunch overspend). Below each 本月底 row sits 調整後本月底美金餘額 / 調整後的本月底新臺幣餘額 (6月 titles the USD one 調整後的… too) = the raw 本月底 + that currency's …餘額調整 cell from the 帳戶實際數字對應 block — the bank view absorbs the same reconciliation delta.
- Right below that, the 帳戶實際數字對應 block (from 7月 2026 on; labels in B, values in D) reconciles the REAL bank-account numbers: where 銀行餘額 books every expense when it is incurred, this block books money when it actually moves — cash rows (支付方式=現金) as they happen, credit-card charges only when the bill is PAID. NTD block: 本月初新臺幣真實餘額 (start_month rewires it to the previous month's 調整後本月底新臺幣真實餘額), 本月新臺幣現金支出 (SUMIFS over the expense window keyed 支付幣別=TWD + 支付方式=現金, plus the transfer block's M總和 fees), 本月新臺幣信用卡繳費 (= the TWD-billed card's 本月需繳款), 本月底新臺幣真實餘額 (= 初 + income SUMIF − 現金支出 − 信用卡繳費 − I總和 NTD sent), then 新臺幣餘額調整 and 調整後本月底新臺幣真實餘額 (= 本月底 + 調整). A blank row, then the mirrored USD block ending in 美金餘額調整 / 調整後本月底美金真實餘額. The …餘額調整 cells are the ONLY hand/tool-owned cells here: when the real bank account disagrees with the computed 本月底…真實餘額, log the ACTUAL balance with adjust_balance — it writes actual − 本月底…真實餘額 into the 調整 cell (overwriting, not accumulating), which flows into both this block's 調整後 row and the 銀行餘額 view's. start_month resets both 調整 cells to 0 on the new tab and chains every 本月初 row from the 調整後 rows, so a reconciled month closes into the next month's opening balances. 6月 seeds its 本月初 cells with hand-typed numbers.
- To the right of the expense list, a 乾坤大挪移 block (the NTD→USD transfer log, from 7月 2026 on) spans columns H-N: the title in H, a header row (日期 新臺幣 當下美金 實際美金 匯差 手續費 當筆總額外花費), data rows, then a 總和 row with per-column SUMs. 當下美金 and 匯差 are pinned to the USDTWD rate at entry time (a literal number, not live GOOGLEFINANCE). The 銀行餘額 block wires to the 總和 row: 本月底美金餘額 adds +K總和 (USD received), 本月底新臺幣餘額 subtracts -I總和 (NTD sent), and 本月新臺幣支出 adds +N總和 so 匯差+手續費 count as the month's NTD spending — the principal itself is a transfer, not income or spending. Log transfers with add_transfer; never hand-extend the 總和 formulas.
- Also to the right, a 午餐預算 block (columns P-S, from 7月 2026 on; early tabs may still title it 中餐預算 — both anchors work): the recurring 中餐 row in the expense list is the month's lunch BUDGET, and actual lunches are logged in this block instead of the expense list. Title in P; a 編列預算 / 剩餘 (負數會加回去支出) values row two rows below it (編列預算 points at the 中餐 expense cell; 剩餘 = 編列預算 − 總和); then a 日期 項目 金額 支付方式 header, data rows, and a 總和 row (label in Q, =SUM in R). The leftover feeds the 銀行餘額 block's 午餐超支或回補 row: 本月底新臺幣餘額 gains unspent budget back, an overdraft (negative 剩餘) deducts more — and 本月新臺幣收支狀況 adds the same 午餐超支或回補 so the month's own NTD performance includes it. S=支付方式: a TWD-billed card name (currently 國泰 CUBE) when a card paid the lunch, 現金 or blank for cash — card lunches ALSO appear in that card's 信用卡帳單對帳區 buckets and count into its 本月需繳款; the 中餐 budget row in the expense list must NEVER carry a 支付方式 in G (it is a budget, not a charge — the individual lunches are the card charges). Log lunches with add_lunch; never hand-extend the 總和 formula and never add_expense a lunch.
- Below the expense list, from row 50 down, the 信用卡帳單對帳區 (from 7月 2026 on) holds one reconciliation block per credit card in a 2×2 grid (columns H-J and L-N): 國泰 CUBE (bills TWD), CHASE Amazon, CHASE Freedom, Apple Card (bill USD). Each block: the card name, 本月結帳日 / 本月繳款日 (hand-owned dates; start_month bumps them one month), 本月需繳款 (what this month's 繳款日 pays — CHASE Amazon: this tab's 結帳日前小計 + the previous tab's 結帳日後小計; the other three: the previous tab's 結帳日前小計 + the tab-before-that's 結帳日後小計), then 結帳日前 and 結帳日後 buckets: each a label row, a 日期/項目/金額 header row, a mirror formula that spills matching rows date-sorted, and a 小計 row (label in the block's 2nd column, =SUMIFS in the 3rd). 結帳日前 is strictly 日期 < 結帳日 — a row dated ON the 結帳日 belongs to 結帳日後 (the next statement). The mirrors key on 支付方式: the expense list's column G, and — for the TWD-billed 國泰 CUBE only — also the 午餐預算 log's column S (QUERY-merged). Rows need a real 日期 (a dateless subscription joins the moment its date is filled) and 金額 is the card's billing currency: D for the US cards, E (and lunch R) for 國泰 CUBE. Never hand-edit the mirror spills, 小計s, or 本月需繳款 — log card expenses with add_expense (card param) and card lunches with add_lunch (card param). The buckets' spill areas GROW automatically when a tool adds a card row (add_expense with card+date, add_lunch with card, set_expense_date on a card row) — but a date filled by hand in the UI triggers nothing: an overflowing bucket shows #REF! until the next guarded write or a manual row insert above the 小計. 7月 bootstraps by hand: the lag-1 cards' 本月需繳款 and CHASE Amazon's June tail are typed in (5月/6月 have no section).

TRIP TABS — e.g. "2026/07/25 京都東京".
- A mosaic of category blocks in four column bands (A-G, I-O, Q-W, Z-AF), stacked vertically within each band.
- Each block: a header row (日期, 店鋪, 品項, 支付方式, 日幣原價, 臺幣…, 臺幣進位), the category name on the row below it, data rows, and usually a 分類總花費 total row.
- Known categories: 模型, 書, 餐(當下吃的), 機票住宿, 雜支, 衣服/鞋子, 吃的伴手禮, 紀念品小物, 交通, 送禮, 入場券, 電子產品.
- Entries are JPY-priced (¥ → TWD at ~0.22 plus a rounded-up column) or TWD-direct (機票住宿-style: 日幣原價 empty, 臺幣 holds the NTD amount).
- A budget-vs-actual summary occupies the bottom-right of the grid — it is not a category block.
- Never insert whole sheet rows in a trip tab: a row insert cuts across all bands and damages neighboring blocks. add_trip_entry writes into empty rows inside a block, or inserts cells scoped to the block's own columns.

OTHER — "火車模型" is a hobby purchase planner; monthly tabs may cross-reference its cells.

Prefer the tailored tools (add_expense, set_income, add_transfer, add_lunch, set_expense_date, adjust_balance, month_summary, start_month, add_trip_entry) over raw range edits. Locate rows with find_cells — never by reading a big range and counting rows. For any append-like update_range write, pass expect_empty: true (it refuses if the target is not empty); every update_range response includes previousValues so a mistaken overwrite can be reverted. For math, read with mode "raw" — default reads return locale-formatted strings like "13,603.67".`;
