/**
 * Single source of truth for the layout of Vincent's personal-finance
 * spreadsheet. Every tailored tool reads its anchors, labels, and lists from
 * here — when the sheet layout changes, this file (and only this file)
 * changes with it.
 */

export const TOTAL_ROW_LABEL = "花費總額";

/** 類別 tags seen in the sheet's column C. Documentation, not validation — the cell is free text. */
export const KNOWN_TAGS = ["訂閱", "吃喝", "交通", "生活用品", "娛樂", "購物", "其他", "透支"] as const;

/** Column-A anchor labels for the budget/income section (values in the adjacent column). */
export const OVERDRAFT_LABEL = "上月透支";
export const SALARY_LABEL = "薪水";
export const REPAYMENT_LABEL = "沛還";
export const REMAINDER_LABEL = "剩餘";
export const USD_PAYMENT_LABEL = "美金支付";
export const NTD_PAYMENT_LABEL = "新臺幣支付";
export const BUDGET_HEADER_LABEL = "總預算";

/**
 * Post-migration budget-block rows (labels in column B, values in column D).
 * 月美金餘額/月新臺幣餘額 are THIS month's 收入−支出 per currency (no
 * carry-over); 月剩餘 converts the USD net at GOOGLEFINANCE USDTWD and adds
 * the NTD net. They replace the old 剩餘 / 美金支付 / 新臺幣支付 rows.
 */
export const MONTH_USD_NET_LABEL = "月美金餘額";
export const MONTH_NTD_NET_LABEL = "月新臺幣餘額";
export const MONTH_REMAINDER_LABEL = "月剩餘";

/**
 * Labels for the 銀行餘額 (bank-balance reconciliation) block — a per-currency
 * running balance that carries over month to month, for reality-checking the
 * real USD and NTD bank accounts. USD and NTD are tracked as independent
 * ledgers: USD expenses (column D) hit only the USD balance, native-NTD
 * expenses hit only the NTD balance. Each currency's ending balance =
 * last month's ending balance + this month's income − this month's spending,
 * so both surplus and overdraft carry forward. All eight live in column B with
 * their values in column D, like the rest of the budget block.
 */
export const USD_INCOME_LABEL = "美金收入";
export const USD_SPENDING_LABEL = "美金支出";
export const PREV_USD_BALANCE_LABEL = "上月美金餘額";
export const USD_BALANCE_LABEL = "美金餘額";
export const NTD_INCOME_LABEL = "新臺幣收入";
export const NTD_SPENDING_LABEL = "新臺幣支出";
export const PREV_NTD_BALANCE_LABEL = "上月新臺幣餘額";
export const NTD_BALANCE_LABEL = "新臺幣餘額";

/** Post-migration names of the running bank balances (old tabs keep 美金餘額/新臺幣餘額 — look up with fallback). */
export const TOTAL_USD_BALANCE_LABEL = "總美金餘額";
export const TOTAL_NTD_BALANCE_LABEL = "總新臺幣餘額";

/** Items start_month keeps when opening a new month; everything else is a one-off. */
export const RECURRING_ITEMS = new Set<string>([
	OVERDRAFT_LABEL,
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
	"中餐額外",
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
	/** C — 類別, the per-row tag (訂閱, 吃喝, …). */
	tag: 2,
	/** D — 美金 (USD). */
	usd: 3,
	/** E — 新臺幣 (TWD). */
	twd: 4,
	/** F — 支付幣別, which real account paid the row (USD/TWD). */
	paidWith: 5,
	/** D — the 花費總額 label. */
	totalLabel: 3,
	/** E — the 花費總額 =SUM window. */
	totalValue: 4,
	/** B — budget-block labels (沛還/薪水/剩餘/美金支付). */
	budgetLabel: 1,
	/** D — budget-block values. */
	budgetValue: 3,
} as const;

/** Sheets date serial: days since 1899-12-30. */
export function dateSerial(year: number, month: number, day: number): number {
	return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000);
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

MONTHLY TABS — named "N 月" (e.g. "9 月", with a space). Layout below applies from 7 月 2026 on; 6 月 and earlier lack the 類別 column.
- Header row 2: 日期 項目 類別 美金 新臺幣. Expense list in columns A-E from row 3 down: A=日期 (a real date shown mm/dd; blank on recurring rows), B=item, C=類別 (per-row tag: 訂閱, 吃喝, 交通, 生活用品, 娛樂, 購物, 其他, 透支), D=美金 (USD), E=新臺幣 (TWD).
- USD rows convert with E = D*GOOGLEFINANCE("CURRENCY:USDTWD").
- The list ends at the "花費總額" row (label in column D, total in E, formula SUM over the window). New expenses must land INSIDE that window — write into an empty row above 花費總額, or insert a row inside the window so the SUM extends. Never append below 花費總額.
- Row 3 "上月透支" carries last month's overdraft via a cross-tab formula.
- Categorization is the per-row 類別 tag in column C (see month_summary's per-類別 totals). Older tabs also carried a summary block in columns G/H (訂閱費 / 基本房租生活費 / 交通中餐等等雜支 / 本月額外雜支) built from hand-picked sums; that block is DEPRECATED and being removed. The tailored tools no longer read or maintain it — ignore any lingering G/H block and never splice into it.
- Below the list: 總預算 / 沛還 / 薪水 / 剩餘 / 美金支付 / 新臺幣支付 (labels in column B, values in column D). 剩餘 is the old single-currency budget view: income − 花費總額, carrying only overdraft (透支) into next month via row 3.
- Further down, a 銀行餘額 block reconciles the real USD and NTD bank accounts as two INDEPENDENT running ledgers (labels in column B, values in column D): 美金收入 / 美金支出 / 上月美金餘額 / 美金餘額, then 新臺幣收入 / 新臺幣支出 / 上月新臺幣餘額 / 新臺幣餘額. 美金支出 = SUM of the USD column (D) over the expense window; 新臺幣支出 = SUMIF of the NTD column (E) for native-NTD rows only (D blank), so USD expenses never double-count against NTD. Each 餘額 = 上月餘額 + 收入 − 支出 (surplus AND overdraft both carry). 上月美金餘額 / 上月新臺幣餘額 point at the previous month's matching 餘額 cell (start_month rewires them); in the earliest month they are seeded by hand with the real bank balances. Coexists with 剩餘 — it does not replace it.

TRIP TABS — e.g. "2026/07/25 京都東京".
- A mosaic of category blocks in four column bands (A-G, I-O, Q-W, Z-AF), stacked vertically within each band.
- Each block: a header row (日期, 店鋪, 品項, 支付方式, 日幣原價, 臺幣…, 臺幣進位), the category name on the row below it, data rows, and usually a 分類總花費 total row.
- Known categories: 模型, 書, 餐(當下吃的), 機票住宿, 雜支, 衣服/鞋子, 吃的伴手禮, 紀念品小物, 交通, 送禮, 入場券, 電子產品.
- Entries are JPY-priced (¥ → TWD at ~0.22 plus a rounded-up column) or TWD-direct (機票住宿-style: 日幣原價 empty, 臺幣 holds the NTD amount).
- A budget-vs-actual summary occupies the bottom-right of the grid — it is not a category block.
- Never insert whole sheet rows in a trip tab: a row insert cuts across all bands and damages neighboring blocks. add_trip_entry writes into empty rows inside a block, or inserts cells scoped to the block's own columns.

OTHER — "火車模型" is a hobby purchase planner; monthly tabs may cross-reference its cells.

Prefer the tailored tools (add_expense, month_summary, start_month, add_trip_entry) over raw range edits. Locate rows with find_cells — never by reading a big range and counting rows. For any append-like update_range write, pass expect_empty: true (it refuses if the target is not empty); every update_range response includes previousValues so a mistaken overwrite can be reverted. For math, read with mode "raw" — default reads return locale-formatted strings like "13,603.67".`;
