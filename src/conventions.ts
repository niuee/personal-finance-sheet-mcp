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

MONTHLY TABS — named "N 月" (e.g. "10 月", with a space). Every month from 10 月 2026 on uses the budget layout below (a budget month is recognised by the 本月匯率 label in column B); earlier months are read-only history (see OLD MONTHS).
- Left side (A–F), every row located by its label: 上月美金透支 (USD in D, E = D × 本月匯率) and 上月新臺幣透支 (TWD in E) carry the previous month's negative 本月…收支狀況 as =IF(-(that cell) > 0, -(that cell), 0) — a positive month carries 0. Then the budget list, two rows per category — "<類別>美金預算" (D = the USD budget, E = D × 本月匯率, F = USD) and "<類別>新臺幣預算" (E = the NTD budget, F = TWD) — 18 rows for the nine categories; C = 類別. Right below the list: 本月匯率 (label B, value C), the month's single USD→TWD rate — a formula that shows the live rate until the 1st of the month and then locks to the 1st's rate; every conversion on the tab references it — and 預算總額 (label D, value E, every budget in NTD). Further down: 總預算 and the 項目/幣別/金額 income list (薪水 TWD, 沛還 USD, …), then the two lines built the same way, one per account: 本月美金收支狀況 (USD income − 上月美金透支 − the USD budget lines + 本月美金超支), in USD from column D with no conversion, and 本月新臺幣收支狀況 (TWD income − 上月新臺幣透支 − the TWD budget lines + 本月新臺幣超支 − the 乾坤大挪移 手續費). Each subtracts its currency's BUDGET (unspent budget stays reserved) plus that currency's overspend: 本月美金超支 adds up every block's negative 美金 剩餘 (in USD, ≤ 0) and 本月新臺幣超支 every block's negative 新臺幣 剩餘 (≤ 0). 本月美金超支（加上回補） and 本月新臺幣超支（加上回補） add up every block's 剩餘 in that currency, unspent budget included. 總支出 = every block's 美金 總和 × 本月匯率 + every 新臺幣 總和 + 手續費, in NTD.
- Nine category blocks to the right, four columns plus a spacer each — 午餐 H–K, 購物 M–P, 吃喝 R–U, 生活用品 W–Z, 訂閱 AB–AE, 交通 AG–AJ, 娛樂 AL–AO, 學貸 AQ–AT, 其他 AV–AY: a "<category>支出" title (午餐支出 holds the 中餐 budget), then a small table above the entries: a 編列預算 / 總和 / 剩餘 header row, then a 美金 row and a 新臺幣 row (the label in the block's first column, the three figures in the next three). The 美金 row is all in USD: 編列預算 from the "<類別>美金預算" row, 總和 = the entries whose 幣別 is USD, 剩餘 = 編列預算 − 總和. The 新臺幣 row is all in NTD: 編列預算 from "<類別>新臺幣預算", 總和 = every other entry (a blank 幣別 counts as TWD), 剩餘 likewise. Nothing inside a block is converted. Then a 日期/項目/金額/幣別 header and entries running down, open-ended. 幣別 is the currency of the account that PAID — a USD-priced charge paid from the NTD account is TWD, at amount × 本月匯率. 幣別 is a dropdown whose rule the template only puts on its own rows: add_expense copies the 幣別 dropdown rule onto the new row (from the nearest entry above that has it, healing any rows in between; when nothing above has one, from another block's 幣別, onto the block's whole column down to the new row), so log entries with add_expense — a 幣別 written with update_range shows as plain text. Never write anything below a block except entries: the open-ended 總和 counts every number in its column.
- 乾坤大挪移 (NTD→USD transfers) sits after the last block (BA–BG) with the same anatomy: 總和 on top, the header, open-ended entries. Only its 手續費 counts as spending.
- There is no card reconciliation, bank-balance ledger or separate lunch log: lunches are entries in the 午餐 block, and 幣別 is the only payment detail an entry carries.
- start_month copies the "Budget Based" template tab — its starting entries, budgets and income come along as they are — then writes the title, points both carries at the previous month and writes the 本月匯率 formula. It refuses a month that already exists. To change what every new month starts with, edit the template tab by hand.
- Tools: add_expense (tag required, it picks the block), delete_expense (tag narrows the search to one block), set_income, add_transfer, month_summary (returns layout:'budget', each block's money per currency), get_categories (returns the blocks) and start_month. Never insert or delete whole rows on a month tab — the budget list, income and blocks share sheet rows; scope delete_rows to one block's own columns.

OLD MONTHS — 5 月–9 月 2026 and every "N 月 DEP" copy (the months rebuilt onto a newer layout, e.g. 10 月 DEP) are the old layout and read-only: the write tools refuse them, and nothing should be written into them or wired at them. month_summary still reads 5 月–9 月 (it opens "N 月" by number, so read N 月 DEP tabs with read_range). For reading them: one expense list in A–G (日期 項目 類別 美金 新臺幣 支付幣別 支付方式) from row 3 down to the 花費總額 row (total in E), USD rows converted with a live GOOGLEFINANCE; 上月美金透支 / 上月新臺幣透支 carry rows on rows 3–4 (6 月 and earlier: a single 上月透支); below the list 總預算, the income list and 本月美金收支狀況 / 本月新臺幣收支狀況, then the 銀行餘額 block (本月…收入/支出, 本月初/本月底…餘額, 保守預計本月底新臺幣餘額, 調整後 rows) and the 帳戶實際數字對應 block; to the right a 乾坤大挪移 log (H–N), a 午餐預算 lunch log (P–S; early tabs title it 中餐預算; its 剩餘 feeds 午餐超支或回補) and, below the transfer log, the 信用卡帳單對帳區 card statement buckets. 5 月 and 6 月 DEP predate the 類別/支付幣別 columns and end at a single 剩餘 row.

TRIP TABS — e.g. "2026/07/25 京都東京".
- A mosaic of category blocks in four column bands (A-G, I-O, Q-W, Z-AF), stacked vertically within each band.
- Each block: a header row (日期, 店鋪, 品項, 支付方式, 日幣原價, 臺幣…, 臺幣進位), the category name on the row below it, data rows, and usually a …總花費 total row (the label varies: 分類總花費, 機票住宿分類總花費, 食總花費).
- Known categories: 模型, 鐵道模型, 書, 餐(當下吃的), 機票住宿, 雜支, 衣服/鞋子, 吃的伴手禮, 紀念品小物, 交通, 送禮, 入場券, 電子產品.
- Entries are JPY-priced (¥ → TWD at ~0.22 plus a rounded-up column) or TWD-direct (機票住宿-style: 日幣原價 empty, 臺幣 holds the NTD amount).
- Data rows render 日期 as mm/dd hh:mm (a real datetime), 日幣原價 with a ¥ sign, both 臺幣 columns with an NTD sign, and 店鋪/品項 centered — add_trip_entry stamps these formats onto the row it writes, so cells created by a block-scoped insert or never-formatted empties still render canonically.
- A budget-vs-actual summary titled 目前實際開銷 occupies the bottom-right of the grid (~AI46) — it is not a category block. A 分類/金額/預算/預算餘額/餘額 JP header sits under the title, then one row per budget category: 金額 = actual spend so far, 預算餘額 = what's left of that category's 預算, 餘額 JP = the remainder in JPY. Its 分類 names are budget buckets and need not match the category blocks one-to-one. Read it with trip_budget_status instead of raw reads.
- Never insert or delete whole sheet rows in a trip tab: a row insert or delete cuts across all bands and damages neighboring blocks. add_trip_entry writes into empty rows inside a block, or inserts cells scoped to the block's own columns; to remove an entry, delete_rows with columns set to that block's band (A-G, I-O, Q-W, Z-AF).
- A trip tab may carry its own 乾坤大挪移 block (NTD→JPY), columns A-G below all content: 日期 新臺幣 當下日幣 實際日幣 匯差 手續費 當筆總額外花費, data rows, then a 總和 row; the JPYTWD rate is pinned at entry. The JPY received is trip cash and joins no month tab. Log these with add_transfer currency:'jpy' (tab = the trip tab); when the section is full the tool inserts cells scoped to A-G, never whole rows.

OTHER — "火車模型" is a hobby purchase planner; monthly tabs may cross-reference its cells.

Prefer the tailored tools (add_expense, delete_expense, set_income, add_transfer, month_summary, get_categories, start_month, add_trip_entry, trip_budget_status) over raw range edits. Locate rows with find_cells — never by reading a big range and counting rows. To REMOVE something, delete it rather than blanking it: delete_expense for a block entry, delete_rows (with columns scoping it to the section's own band — a block's four columns, BA:BG for 乾坤大挪移, B:D for the income list, the trip bands) for anything else; both return what they deleted, and delete_rows refuses when a formula points straight at a deleted cell. For any append-like update_range write, pass expect_empty: true (it refuses if the target is not empty); every update_range response includes previousValues so a mistaken overwrite can be reverted. For math, read with mode "raw" — default reads return locale-formatted strings like "13,603.67".`;
