import { clean, findRendered, rendered } from "./dom.ts";

// Opening the topic page behind one row of the Explore board.
//
// The row has no href and no id: X renders it as a clickable div and the topic id
// exists only after the click. So the row is chosen by its position on the board,
// read from the same list the board reader numbered, and the resulting URL is what
// gives the id. That is why this is a separate step rather than a field on the
// board: the id does not exist until something opens it.

export function openRow(index: number): { found: boolean } {
	// Unfiltered on purpose: `row_index` is the row's position in what the board
	// reader saw. Filtering promoted rows here instead would shift every later
	// index by one and click the entry next to the one that was asked for.
	const rows = findRendered<HTMLElement>(document, '[data-testid="trend"]');
	const row = rows[index];
	if (!row) return { found: false };
	// The board reader drops promoted rows, so no index it hands out can be an ad.
	// A caller that passes one anyway is refused rather than sent to a sponsored
	// search page.
	if (/Promoted|推广|广告/i.test(clean(row.textContent))) return { found: false };
	// A row the board reader saw may be below the fold, and a click on an element
	// outside the viewport does not reach it. Requiring it to be visible made
	// `--index` work only for the rows that happened to be on screen — a board of
	// twenty rows answered `not_found` for anything past the ninth. Scrolling it
	// into view first is the same thing a reader does.
	const box = row.getBoundingClientRect();
	if (box.top < 0 || box.bottom > innerHeight) row.scrollIntoView({ block: "center", behavior: "instant" });
	if (!rendered(row)) return { found: false };
	row.click();
	return { found: true };
}
