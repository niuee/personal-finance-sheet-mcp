/**
 * A tiny stand-in for the Sheets batchUpdate the migration sends: enough to
 * replay updateCells and cutPaste on a FORMULA-render grid. Formats and
 * merges don't exist in a values grid, so repeatCell and unmergeCells are
 * no-ops here.
 */

type Cell = { userEnteredValue?: { formulaValue?: string; numberValue?: number; stringValue?: string } };

function valueOf(cell: Cell): unknown {
	const v = cell.userEnteredValue;
	if (v === undefined) return undefined;
	return v.formulaValue ?? v.numberValue ?? v.stringValue;
}

/** A copy of `grid` with `requests` applied in order. A cutPaste of row R to row S also rewrites `$C$R` to `$C$S` in every formula, as Sheets does for references to moved cells. */
export function applyRequests(grid: unknown[][], requests: object[]): unknown[][] {
	const g: unknown[][] = grid.map((row) => (row ? [...row] : []));
	const set = (r: number, c: number, v: unknown) => {
		(g[r] ??= [])[c] = v;
	};
	for (const req of requests as any[]) {
		if (req.updateCells) {
			const { start, rows } = req.updateCells;
			(rows as Array<{ values: Cell[] }>).forEach((row, i) =>
				row.values.forEach((cell, j) => set(start.rowIndex + i, start.columnIndex + j, valueOf(cell))),
			);
		} else if (req.cutPaste) {
			const { source, destination } = req.cutPaste;
			const moved: unknown[][] = [];
			for (let r = source.startRowIndex; r < source.endRowIndex; r++) {
				moved.push([]);
				for (let c = source.startColumnIndex; c < source.endColumnIndex; c++) {
					moved[moved.length - 1]!.push(g[r]?.[c]);
					set(r, c, undefined);
				}
			}
			moved.forEach((row, i) => row.forEach((v, j) => set(destination.rowIndex + i, destination.columnIndex + j, v)));
			const from = new RegExp(`\\$C\\$${source.startRowIndex + 1}(?!\\d)`, "g");
			const to = `$C$${destination.rowIndex + 1}`;
			for (const row of g) {
				if (!row) continue;
				row.forEach((v, c) => {
					if (typeof v === "string" && v.startsWith("=")) row[c] = v.replace(from, to);
				});
			}
		}
	}
	return g;
}

/** Blank cells ("", null, undefined) compare equal, and trailing blanks are dropped, so two grids compare by content. */
export function normalize(grid: unknown[][]): unknown[][] {
	const rows = Array.from(grid, (row) => {
		const cells = Array.from(row ?? [], (v) => (v === "" || v === null || v === undefined ? undefined : v));
		while (cells.length > 0 && cells[cells.length - 1] === undefined) cells.pop();
		return cells;
	});
	while (rows.length > 0 && rows[rows.length - 1]!.length === 0) rows.pop();
	return rows;
}
