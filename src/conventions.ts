/**
 * Single source of truth for the layout of Vincent's personal-finance
 * spreadsheet. Every tailored tool reads its anchors, labels, and lists from
 * here — when the sheet layout changes, this file (and only this file)
 * changes with it.
 */

export const TOTAL_ROW_LABEL = "花費總額";

/** Short category name (tool parameter) → exact label text in column E. */
export const CATEGORIES: Record<string, string> = {
	訂閱費: "訂閱費",
	交通中餐雜支: "交通中餐等等雜支",
	額外雜支: "本月額外雜支",
};

export const DEFAULT_CATEGORY = "額外雜支";

/** Column-A anchor labels for the budget/income section (values in the adjacent column). */
export const OVERDRAFT_LABEL = "上月透支";
export const SALARY_LABEL = "薪水";
export const REPAYMENT_LABEL = "沛還";
export const REMAINDER_LABEL = "剩餘";
export const USD_PAYMENT_LABEL = "美金支付";

/** Items start_month keeps when opening a new month; everything else is a one-off. */
export const RECURRING_ITEMS = new Set<string>([
	"上月透支",
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

export function monthTabName(month: number): string {
	if (!Number.isInteger(month) || month < 1 || month > 12) {
		throw new Error(`Invalid month: ${month} (expected an integer 1-12)`);
	}
	return `${month} 月`;
}

export function currentMonthTab(now: Date = new Date()): string {
	return monthTabName(now.getMonth() + 1);
}

export function previousMonth(month: number): number {
	return month === 1 ? 12 : month - 1;
}

/** Trip tabs: row 2 holds the category block titles (模型, 書, ...). */
export const TRIP_CATEGORY_ROW = 2;
/** Each block is 7 data columns (日期 店鋪 品項 支付方式 日幣原價 臺幣匯率 臺幣進位) + 1 spacer. */
export const TRIP_BLOCK_WIDTH = 8;

export const CONVENTIONS_TEXT = `How this personal-finance spreadsheet is organized:

MONTHLY TABS — named "N 月" (e.g. "9 月", with a space).
- Expense list in columns A-C from row 3 down: A=item, B=美金 (USD), C=新臺幣 (TWD).
- USD rows convert with C = B*GOOGLEFINANCE("CURRENCY:USDTWD").
- The list ends at the "花費總額" row (label in column B, total in C, formula SUM over the window). New expenses must land INSIDE that window — write into an empty row above 花費總額, or insert a row inside the window so the SUM extends. Never append below 花費總額.
- Row 3 "上月透支" carries last month's overdraft via a cross-tab formula.
- Summary block, labels in column E / values in F: 訂閱費, 基本房租生活費 (fixed rent, not a sum), 交通中餐等等雜支, 本月額外雜支. The sums reference hand-picked cells (e.g. sum(C22,C3)) — adding an expense to a category means splicing its C-cell into that formula.
- Below the list: 總預算 / 沛還 / 薪水 / 剩餘 / 美金支付 (labels in column A, values in column B).

TRIP TABS — e.g. "2026/07/25 京都東京".
- Side-by-side category blocks (模型, 書, ...), block titles in row 2, one spacer column between blocks.
- Block columns: 日期, 店鋪, 品項, 支付方式, 日幣原價, 臺幣 0.22 匯率, 臺幣 進位.

OTHER — "火車模型" is a hobby purchase planner; monthly tabs may cross-reference its cells.

Prefer the tailored tools (add_expense, month_summary, start_month, add_trip_entry) over raw range edits. For math, read with mode "raw" — default reads return locale-formatted strings like "13,603.67".`;
