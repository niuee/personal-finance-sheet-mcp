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

/** The "Budget Based" template as a FORMULA render (row = index+1), with its starting entries. */
export function budgetGrid(): unknown[][] {
	const g: unknown[][] = [];
	const put = (row: number, col: number, v: unknown) => {
		(g[row - 1] ??= [])[col] = v;
	};
	put(1, 0, "11 月花費");
	["日期", "項目", "類別", "美金", "新臺幣", "支付幣別"].forEach((v, c) => put(2, c, v));
	g[2] = ["", "上月美金透支", "透支", "=IF(-('10 月'!D43) > 0, -('10 月'!D43), 0)", "=D3*$C$15", "USD"];
	g[3] = ["", "上月新臺幣透支", "透支", "", "=IF(-('10 月'!D44) > 0, -('10 月'!D44), 0)", "TWD"];
	g[4] = ["", "生活用品預算", "生活用品", "", 31261, "TWD"];
	g[5] = ["", "吃喝預算", "吃喝", "", "=D6*$C$15", "TWD"];
	g[6] = ["", "購物預算", "購物", "", 0, "TWD"];
	g[7] = ["", "訂閱預算", "訂閱", "", 10700, "TWD"];
	g[8] = ["", "訂閱預算", "訂閱", 71.37, "=D9*$C$15", "USD"];
	g[9] = ["", "交通預算", "交通", "", 1000, "TWD"];
	g[10] = ["", "娛樂預算", "娛樂", "", 0, "TWD"];
	g[11] = ["", "學貸預算", "學貸", "=281.43 + 148.5", "=D12*$C$15", "USD"];
	g[12] = ["", "其他預算", "其他", 15, "=D13*$C$15", "USD"];
	g[13] = ["", "中餐預算", "中餐", "", 3900, "TWD"];
	g[14] = ["", "本月匯率", 32.4607, "預算總額", "=SUM(E5:E14)"];
	put(26, 1, "總預算");
	g[26] = ["", "項目", "幣別", "金額"];
	g[27] = ["", "薪水", "TWD", 65271];
	g[28] = ["", "沛還", "USD", 700];
	put(32, 1, "本月美金收支狀況");
	put(32, 3, '=SUMIF(C28:C31,"USD",D28:D31)-D3-(SUMIF(AE7:AE,"USD",AD7:AD))');
	put(33, 1, "本月新臺幣收支狀況");
	put(33, 3, '=SUMIF(C28:C31,"TWD",D28:D31)-E4-SUMIF(F5:F14,"TWD",E5:E14)-BF5');
	put(35, 1, "本月超支");
	put(36, 1, "本月超支（加上回補）");
	put(40, 1, "總支出");
	for (const [cat, c] of Object.entries(BLOCK_START)) {
		put(2, c, TITLES[cat as keyof typeof BLOCK_START]);
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
			["Claude", "=200*$C$15", "TWD"],
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
	return g;
}

/** An old-layout previous month (10 月 flavour): only the two 收支狀況 rows matter here. */
export function oldMonthGrid(): unknown[][] {
	const g: unknown[][] = [];
	g[0] = ["10 月花費"];
	g[34] = ["", "", "", "花費總額", "=SUM(E3:E34)"];
	g[42] = ["", "本月美金收支狀況", "", "=D50-D51"];
	g[43] = ["", "本月新臺幣收支狀況", "", "=D55-D56+D57"];
	return g;
}
