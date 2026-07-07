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
 * performance. 7月 2026 titles them 本月美金餘額/本月新臺幣餘額 — the
 * finders accept both. They replace the old 剩餘 / 美金支付 / 新臺幣支付
 * rows; the interim 月剩餘 / 透支沖銷 rows are gone from the sheet.
 */
export const MONTH_USD_NET_LABEL = "本月美金收支狀況";
export const MONTH_NTD_NET_LABEL = "本月新臺幣收支狀況";
/** All titles the month-view rows have carried, newest first — for renamed-anchor lookups. */
export const MONTH_USD_NET_LABELS = [MONTH_USD_NET_LABEL, "本月美金餘額"] as const;
export const MONTH_NTD_NET_LABELS = [MONTH_NTD_NET_LABEL, "本月新臺幣餘額"] as const;

/**
 * Labels for the 銀行餘額 block — the month's per-currency money flow, for
 * reality-checking the real USD and NTD bank accounts. All labels live in
 * column B with their values in column D. The two currencies chain
 * differently month to month: 本月初新臺幣餘額 points at the previous
 * month's 本月底新臺幣餘額 (start_month rewires it), while 本月初美金餘額
 * stays 0 — a USD shortfall carries through the 上月美金透支 expense row
 * instead of the ledger. 本月底美金餘額 = 初 + 收入 − 支出 + 實際美金總和;
 * 本月底新臺幣餘額 = 初 + 收入 − 支出 − 轉出新臺幣總和 + 午餐超支或回補;
 * 保守預計本月底新臺幣餘額 is the same but counts the lunch leftover only
 * when it is negative (an overspend).
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

/** The 銀行餘額 block's header row label. */
export const BANK_BLOCK_LABEL = "銀行餘額";

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

/** 0-indexed columns of the 午餐預算 section (P–R, one right of the original O–Q since the 支付方式 column landed in G). */
export const LUNCH_COLS = {
	/** P — 日期; also the column of the section title, the 編列預算 label, and the budget value. */
	date: 15,
	/** Q — 項目; also the column of the 總和 label. */
	item: 16,
	/** R — 金額; also the 剩餘 value and the 總和 =SUM cell. */
	amount: 17,
} as const;

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

MONTHLY TABS — named "N 月" (e.g. "9 月", with a space). Layout below applies from 7 月 2026 on; 6 月 and earlier are frozen history on the old layout (no 類別/支付幣別 columns, a hand-entered income list ending at a single 剩餘 row) — read them, but don't write into them.
- Header row 2: 日期 項目 類別 美金 新臺幣 支付幣別 支付方式. Expense list in columns A-G from row 3 down: A=日期 (a real date shown mm/dd; blank on recurring rows), B=item, C=類別 (per-row tag: 訂閱, 吃喝, 交通, 生活用品, 娛樂, 購物, 其他, 透支, 學貸), D=美金 (USD), E=新臺幣 (TWD), F=支付幣別 (USD or TWD — which real account PAID the row; a USD-priced expense paid with a TWD card has D filled but F=TWD), G=支付方式 (the credit card that charged the row — exactly 國泰 CUBE, CHASE Amazon, CHASE Freedom Unlimited, or Apple Card; blank for cash/transfer rows).
- USD rows convert with E = D*GOOGLEFINANCE("CURRENCY:USDTWD").
- The list ends at the "花費總額" row (label in column D, total in E, formula SUM over the window). New expenses must land INSIDE that window — write into an empty row above 花費總額, or insert a row inside the window so the SUM extends. Never append below 花費總額.
- Rows 3-4 carry last month's per-currency shortfalls via cross-tab formulas: 上月美金透支 (USD in D, F=USD, E converts at live GOOGLEFINANCE like any USD row) and 上月新臺幣透支 (TWD in E, F=TWD), each =IF(-('prev'!D<row>) > 0, -(…), 0) against the previous month's 本月…收支狀況 cell — a currency's negative month closes by becoming this month's expense; a positive month carries 0. start_month rebuilds both anchors. Tabs predating the split (6月 and earlier) have a single TWD 上月透支 row anchored at the previous month's 剩餘.
- Categorization is the per-row 類別 tag in column C (see month_summary's per-類別 totals). The old G/H summary block is DEPRECATED — ignore any remnants.
- Below the list, the income section: a 總預算 header row, a 項目/幣別/金額 header row, then the income list (labels in B, 幣別 USD/TWD in C, amounts in D): 沛還, 薪水, plus ad-hoc income rows (e.g. 多一個月薪水) — manage these with set_income, which upserts by 項目 and keeps the rows inside the 本月…收入 SUMIF windows. Further down sit 本月美金收支狀況 / 本月新臺幣收支狀況 (titled 本月美金餘額 / 本月新臺幣餘額 on 7月 — both anchors work): THIS month's 收入−支出 per currency wired to the 銀行餘額 block's cells, the NTD one additionally adding 午餐超支或回補 so the lunch leftover counts toward the month's own performance. The old 剩餘 / 美金支付 / 新臺幣支付 rows and the interim 月剩餘 / 美金透支沖銷 / 新臺幣透支沖銷 rows no longer exist.
- Further down, the 銀行餘額 block tracks the month's per-currency money flow (labels in column B, values in column D): 本月美金收入 / 本月美金支出 / 本月初美金餘額 / 本月底美金餘額, then 本月新臺幣收入 / 本月新臺幣支出 / 午餐超支或回補 / 本月初新臺幣餘額 / 保守預計本月底新臺幣餘額 / 本月底新臺幣餘額. 收入 cells = SUMIF over the income list's 幣別 column; 本月美金支出 = SUMIF of the expense 支付幣別 for USD summing column D; 本月新臺幣支出 = SUMIF for TWD summing column E, plus the transfer block's N總和. Both 支出 SUMIFs span the FULL expense window INCLUDING the 上月…透支 carry row(s) — deliberate: Vincent counts the carried shortfall as an outflow that must be covered out of this month's money. Do not "fix" this as double-counting. The currencies chain differently: 本月初新臺幣餘額 points at the previous month's 本月底新臺幣餘額 (start_month rewires it), while 本月初美金餘額 stays 0 — the USD shortfall carries only through the 上月美金透支 expense row. 本月底美金餘額 = 本月初 + 收入 − 支出 + K總和 (USD received); 本月底新臺幣餘額 = 本月初 + 收入 − 支出 − I總和 (NTD sent) + 午餐超支或回補; 保守預計本月底新臺幣餘額 is the same but counts 午餐超支或回補 only when it is negative (a lunch overspend).
- To the right of the expense list, a 乾坤大挪移 block (the NTD→USD transfer log, from 7月 2026 on) spans columns H-N: the title in H, a header row (日期 新臺幣 當下美金 實際美金 匯差 手續費 當筆總額外花費), data rows, then a 總和 row with per-column SUMs. 當下美金 and 匯差 are pinned to the USDTWD rate at entry time (a literal number, not live GOOGLEFINANCE). The 銀行餘額 block wires to the 總和 row: 本月底美金餘額 adds +K總和 (USD received), 本月底新臺幣餘額 subtracts -I總和 (NTD sent), and 本月新臺幣支出 adds +N總和 so 匯差+手續費 count as the month's NTD spending — the principal itself is a transfer, not income or spending. Log transfers with add_transfer; never hand-extend the 總和 formulas.
- Also to the right, a 午餐預算 block (columns P-R, from 7月 2026 on; early tabs may still title it 中餐預算 — both anchors work): the recurring 中餐 row in the expense list is the month's lunch BUDGET, and actual lunches are logged in this block instead of the expense list. Title in P; a 編列預算 / 剩餘 (負數會加回去支出) values row two rows below it (編列預算 points at the 中餐 expense cell; 剩餘 = 編列預算 − 總和); then a 日期 項目 金額 header, data rows, and a 總和 row (label in Q, =SUM in R). The leftover feeds the 銀行餘額 block's 午餐超支或回補 row: 本月底新臺幣餘額 gains unspent budget back, an overdraft (negative 剩餘) deducts more — and 本月新臺幣收支狀況 adds the same 午餐超支或回補 so the month's own NTD performance includes it. Log lunches with add_lunch; never hand-extend the 總和 formula and never add_expense a lunch.
- Below the 乾坤大挪移 block, from row 50 down, the 信用卡帳單對帳區 (from 7月 2026 on) holds one reconciliation block per credit card in a 2×2 grid (columns H-J and L-N): 國泰 CUBE (bills TWD), CHASE Amazon, CHASE Freedom Unlimited, Apple Card (bill USD). Each block: the card name, 本月結帳日 / 本月繳款日 (the only hand-owned cells; start_month bumps them one month), 本期帳單總額 (the statement that CLOSED this month = previous tab's 結帳日後小計 + this tab's 結帳日前小計), 本月需繳 (what this month's 繳款日 pays — this tab's 本期帳單總額 for CHASE Amazon, the PREVIOUS tab's for the other three), then 結帳日前 and 結帳日後 buckets, each with a SUMIFS 小計 and a FILTER that mirrors matching expense rows (日期/項目/金額). The FILTERs key on 支付方式 (column G, exact card name) and require a real 日期 — a dateless subscription row joins its bucket the moment its date is filled in; 金額 pulls the card's billing-currency column (D for the US cards, E for 國泰 CUBE). Never hand-edit the FILTER spill, 小計, 本期帳單總額, or 本月需繳 — log card expenses with add_expense and its card param. 7月 bootstraps by hand: its previous-month halves are typed-in numbers (6月 has no section).

TRIP TABS — e.g. "2026/07/25 京都東京".
- A mosaic of category blocks in four column bands (A-G, I-O, Q-W, Z-AF), stacked vertically within each band.
- Each block: a header row (日期, 店鋪, 品項, 支付方式, 日幣原價, 臺幣…, 臺幣進位), the category name on the row below it, data rows, and usually a 分類總花費 total row.
- Known categories: 模型, 書, 餐(當下吃的), 機票住宿, 雜支, 衣服/鞋子, 吃的伴手禮, 紀念品小物, 交通, 送禮, 入場券, 電子產品.
- Entries are JPY-priced (¥ → TWD at ~0.22 plus a rounded-up column) or TWD-direct (機票住宿-style: 日幣原價 empty, 臺幣 holds the NTD amount).
- A budget-vs-actual summary occupies the bottom-right of the grid — it is not a category block.
- Never insert whole sheet rows in a trip tab: a row insert cuts across all bands and damages neighboring blocks. add_trip_entry writes into empty rows inside a block, or inserts cells scoped to the block's own columns.

OTHER — "火車模型" is a hobby purchase planner; monthly tabs may cross-reference its cells.

Prefer the tailored tools (add_expense, set_income, add_transfer, add_lunch, month_summary, start_month, add_trip_entry) over raw range edits. Locate rows with find_cells — never by reading a big range and counting rows. For any append-like update_range write, pass expect_empty: true (it refuses if the target is not empty); every update_range response includes previousValues so a mistaken overwrite can be reverted. For math, read with mode "raw" — default reads return locale-formatted strings like "13,603.67".`;
