/** 0-indexed start column of each block in the template, keyed by category. */
export const BLOCK_START = { 中餐: 7, 購物: 12, 吃喝: 17, 生活用品: 22, 訂閱: 27, 交通: 32, 娛樂: 37, 學貸: 42, 其他: 47 } as const;

const TITLES: Record<keyof typeof BLOCK_START, string> = {
	中餐: "午餐支出",
	購物: "購物支出",
	吃喝: "吃喝支出",
	生活用品: "生活用品支出",
	訂閱: "訂閱支出",
	交通: "交通支出",
	娛樂: "娛樂支出",
	學貸: "學貸支出",
	其他: "其他支出",
};

const chr = (n: number) => String.fromCharCode(65 + n);
/** 0-indexed column → letters (BG = 58). */
const L = (c: number) => (c < 26 ? chr(c) : chr(Math.floor(c / 26) - 1) + chr(c % 26));

type Put = (row: number, col: number, v: unknown) => void;

/** `put` sets one cell; `row` sets cells from column A without touching the rest of that row (block entries share rows with the left side). */
function grid(): { g: unknown[][]; put: Put; row: (r: number, cells: unknown[]) => void } {
	const g: unknown[][] = [];
	const put: Put = (r, col, v) => {
		(g[r - 1] ??= [])[col] = v;
	};
	return { g, put, row: (r, cells) => cells.forEach((v, c) => put(r, c, v)) };
}

/** What both template shapes share: title, header, carries, income, block titles/headers/entries, 乾坤大挪移. `rate` is the 本月匯率 cell. */
function shared(put: Put, row: (r: number, cells: unknown[]) => void, rate: string): void {
	put(1, 0, "11 月花費");
	["日期", "項目", "類別", "美金", "新臺幣", "支付幣別"].forEach((v, c) => put(2, c, v));
	row(3, ["", "上月美金透支", "透支", "=IF(-('10 月'!D43) > 0, -('10 月'!D43), 0)", `=D3*${rate}`, "USD"]);
	row(4, ["", "上月新臺幣透支", "透支", "", "=IF(-('10 月'!D44) > 0, -('10 月'!D44), 0)", "TWD"]);
	put(26, 1, "總預算");
	row(27, ["", "項目", "幣別", "金額"]);
	row(28, ["", "薪水", "TWD", 65271]);
	row(29, ["", "沛還", "USD", 700]);
	put(32, 1, "本月美金收支狀況");
	put(33, 1, "本月新臺幣收支狀況");
	put(34, 1, "本月美金超支");
	put(35, 1, "本月新臺幣超支");
	put(40, 1, "總支出");
	for (const [cat, c] of Object.entries(BLOCK_START)) {
		put(2, c, TITLES[cat as keyof typeof BLOCK_START]);
		["日期", "項目", "金額", "幣別"].forEach((v, i) => put(6, c + i, v));
		put(7, c + 3, "TWD");
		put(8, c + 3, "TWD");
	}
	const sub = BLOCK_START.訂閱;
	(
		[
			["ElevenLabs", 6, "USD"],
			["iCloud", 9.99, "USD"],
			["Google One", 7.99, "USD"],
			["Netflix", 26.99, "USD"],
			["ChatGPT", 20.4, "USD"],
			["Claude", `=200*${rate}`, "TWD"],
		] as const
	).forEach(([item, amt, cur], i) => {
		put(7 + i, sub + 1, item);
		put(7 + i, sub + 2, amt);
		put(7 + i, sub + 3, cur);
	});
	const other = BLOCK_START.其他;
	put(7, other + 1, "每月銀行管理");
	put(7, other + 2, 15);
	put(7, other + 3, "USD");
	put(2, 52, "乾坤大挪移");
	put(5, 52, "總和");
	for (let i = 1; i <= 6; i++) put(5, 52 + i, `=SUM(${L(52 + i)}7:${L(52 + i)})`);
	["日期", "新臺幣", "當下美金", "實際美金", "匯差", "手續費", "當筆總額外花費"].forEach((v, i) => put(6, 52 + i, v));
}

/** The budget list's categories, top to bottom, with their USD and NTD budgets. */
const LIST: ReadonlyArray<readonly [string, number | string, number]> = [
	["生活用品", 0, 31261],
	["吃喝", 0, 0],
	["購物", 0, 0],
	["訂閱", 71.37, 10700],
	["交通", 0, 1000],
	["娛樂", 0, 0],
	["學貸", "=281.43 + 148.5", 0],
	["其他", 15, 0],
	["中餐", 0, 3900],
];

/** Sums one cell per block: `cell(amountCol, currencyCol, remainingCol)` → "K4" etc. */
function perBlock(f: (c: number) => string, join: string): string {
	return Object.values(BLOCK_START).map(f).join(join);
}

/** The "Budget Based" template as a FORMULA render (row = index+1), in the per-currency layout: 18 budget rows, a 美金 and a 新臺幣 row per block, the rate at row 23. */
export function budgetGrid(): unknown[][] {
	const { g, put, row } = grid();
	shared(put, row, "$C$23");
	LIST.forEach(([cat, usd, ntd], i) => {
		const r = 5 + 2 * i;
		row(r, ["", `${cat}美金預算`, cat, usd, `=D${r}*$C$23`, "USD"]);
		row(r + 1, ["", `${cat}新臺幣預算`, cat, "", ntd, "TWD"]);
	});
	row(23, ["", "本月匯率", 32.4607, "預算總額", "=SUM(E5:E22)"]);
	put(32, 3, '=SUMIF(C28:C31,"USD",D28:D31)-D3-SUMIF(F5:F22,"USD",D5:D22)+D34');
	put(33, 3, '=SUMIF(C28:C31,"TWD",D28:D31)-E4-SUMIF(F5:F22,"TWD",E5:E22)+D35-BF5');
	put(34, 3, `=${perBlock((c) => `MIN(0,${L(c + 3)}4)`, "+")}`);
	put(35, 3, `=${perBlock((c) => `MIN(0,${L(c + 3)}5)`, "+")}`);
	put(36, 1, "本月美金超支（加上回補）");
	put(36, 3, `=${perBlock((c) => `${L(c + 3)}4`, "+")}`);
	put(37, 1, "本月新臺幣超支（加上回補）");
	put(37, 3, `=${perBlock((c) => `${L(c + 3)}5`, "+")}`);
	put(40, 3, `=SUM(${perBlock((c) => `${L(c + 2)}4`, ",")})*$C$23+SUM(${perBlock((c) => `${L(c + 2)}5`, ",")})+BF5`);
	for (const [cat, c] of Object.entries(BLOCK_START)) {
		const [amt, cur, budget, total] = [L(c + 2), L(c + 3), L(c + 1), L(c + 2)];
		["", "編列預算", "總和", "剩餘"].forEach((v, i) => put(3, c + i, v));
		put(4, c, "美金");
		put(4, c + 1, `=SUMIF($B$5:$B$22,"${cat}美金預算",$D$5:$D$22)`);
		put(4, c + 2, `=SUMIF(${cur}7:${cur},"USD",${amt}7:${amt})`);
		put(4, c + 3, `=ROUND(${budget}4-${total}4,2)`);
		put(5, c, "新臺幣");
		put(5, c + 1, `=SUMIF($B$5:$B$22,"${cat}新臺幣預算",$E$5:$E$22)`);
		put(5, c + 2, `=SUMIF(${cur}7:${cur},"<>USD",${amt}7:${amt})`);
		put(5, c + 3, `=${budget}5-${total}5`);
	}
	return g;
}

/** The template as it was before the per-currency split (rate at row 15, one mixed 編列預算/總和/剩餘 per block) — kept so the tools' refusal of that shape stays tested. */
export function legacyBudgetGrid(): unknown[][] {
	const { g, put, row } = grid();
	shared(put, row, "$C$15");
	row(5, ["", "生活用品預算", "生活用品", "", 31261, "TWD"]);
	row(6, ["", "吃喝預算", "吃喝", "", "=D6*$C$15", "TWD"]);
	row(7, ["", "購物預算", "購物", "", 0, "TWD"]);
	row(8, ["", "訂閱預算", "訂閱", "", 10700, "TWD"]);
	row(9, ["", "訂閱預算", "訂閱", 71.37, "=D9*$C$15", "USD"]);
	row(10, ["", "交通預算", "交通", "", 1000, "TWD"]);
	row(11, ["", "娛樂預算", "娛樂", "", 0, "TWD"]);
	row(12, ["", "學貸預算", "學貸", "=281.43 + 148.5", "=D12*$C$15", "USD"]);
	row(13, ["", "其他預算", "其他", 15, "=D13*$C$15", "USD"]);
	row(14, ["", "中餐預算", "中餐", "", 3900, "TWD"]);
	row(15, ["", "本月匯率", 32.4607, "預算總額", "=SUM(E5:E14)"]);
	put(32, 3, '=SUMIF(C28:C31,"USD",D28:D31)-D3-SUMIF(F5:F14,"USD",D5:D14)+D34');
	put(33, 3, '=SUMIF(C28:C31,"TWD",D28:D31)-E4-SUMIF(F5:F14,"TWD",E5:E14)+D35-BF5');
	put(34, 3, '=MIN(0,ROUND(SUMIFS($D$3:$D$23,$B$3:$B$23,"訂閱預算",$F$3:$F$23,"USD")-SUMIF(AE7:AE,"USD",AD7:AD),2))');
	put(35, 3, '=MIN(0,SUMIFS($E$3:$E$23,$B$3:$B$23,"中餐預算",$F$3:$F$23,"TWD")-SUMIF(K7:K,"<>USD",J7:J))');
	put(36, 1, "本月超支");
	put(37, 1, "本月超支（加上回補）");
	for (const [cat, c] of Object.entries(BLOCK_START)) {
		put(3, c, "編列預算");
		put(3, c + 2, "剩餘 (負數會加回去支出）");
		put(4, c, `=SUMIF($B$3:$B$23,"${cat}預算",$E$3:$E$23)`);
		put(4, c + 2, `=${L(c)}4-${L(c + 2)}5`);
		put(5, c + 1, "總和");
		put(
			5,
			c + 2,
			`=SUMIF(${L(c + 3)}7:${L(c + 3)},"<>USD",${L(c + 2)}7:${L(c + 2)})+SUMIF(${L(c + 3)}7:${L(c + 3)},"USD",${L(c + 2)}7:${L(c + 2)})*$C$15`,
		);
	}
	return g;
}

/**
 * An old-layout month (10 月 DEP flavour, FORMULA render): an expense list
 * ending at 花費總額, the income list, both 收支狀況 rows (D43 / D44 — the
 * carries start_month points at), the 本月美金收入 SUMIF and an empty
 * 乾坤大挪移 log at H51. Everything the old write paths used to accept.
 */
export function oldMonthGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["10 月花費"];
	g[1] = ["日期", "項目", "類別", "美金", "新臺幣", "支付幣別", "支付方式"];
	g[2] = ["", "上月美金透支", "透支", "=IF(-('9 月'!D76) > 0, -('9 月'!D76), 0)", '=D3*GOOGLEFINANCE("CURRENCY:USDTWD")', "USD"];
	g[3] = ["", "上月新臺幣透支", "透支", "", "=IF(-('9 月'!D77) > 0, -('9 月'!D77), 0)", "TWD"];
	g[4] = ["", "Google Cloud", "訂閱", 11.53, '=D5*GOOGLEFINANCE("CURRENCY:USDTWD")', "USD"];
	g[34] = ["", "", "", "花費總額", "=SUM(E3:E34)"];
	g[36] = ["", "總預算"];
	g[37] = ["", "項目", "幣別", "金額"];
	g[38] = ["", "沛還", "USD", 700];
	g[39] = ["", "薪水", "TWD", 65271];
	g[42] = ["", "本月美金收支狀況", "", "=D51-D52"];
	g[43] = ["", "本月新臺幣收支狀況", "", "=D56-D57+D58"];
	g[49] = ["", "銀行餘額"];
	g[50] = ["", "本月美金收入", "", '=SUMIF(C38:C41,"USD",D38:D41)', "", "", "", "乾坤大挪移"];
	g[51] = ["", "本月美金支出", "", '=SUMIF(F3:F34,"USD",D3:D34)', "", "", "", "日期", "新臺幣", "當下美金", "實際美金", "匯差", "手續費", "當筆總額外花費"];
	g[53] = ["", "", "", "", "", "", "", "總和", "=sum(I53)", "=sum(J53)", "=sum(K53)", "=sum(L53)", "=sum(M53)", "=sum(N53)"];
	return g;
}
