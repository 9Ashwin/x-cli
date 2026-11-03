import type { Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import type { TweetRow } from "./comments.ts";
import type { Input } from "./validate.ts";

// Going back over what this account already kept.
//
// Two lists: the posts bookmarked, and the posts liked. Both are the same page
// with a tab selected, and both render ordinary post cards, so the reader is the
// one the rest of the tool uses.
//
// The point of reading them back is that keeping something is not the same as
// having read it. A bookmark from three weeks ago can be re-read, unbookmarked,
// or turned into a reply now that there is something to say — and the state of
// each card (`liked`, `bookmarked`) says which of those are still true without
// opening anything.

export type Shelf = "bookmarks" | "likes";

const PATH: Record<Shelf, string> = {
	// The bookmarks tab has its own path; the likes tab lives under the history
	// route. Both are the same view, reached two ways.
	bookmarks: "https://x.com/i/history",
	likes: "https://x.com/i/history/likes",
};

export interface ShelfItem extends TweetRow {
	// What the card says this account has already done to it.
	liked: boolean;
	bookmarked: boolean;
}

export interface ShelfResult {
	shelf: Shelf;
	items: ShelfItem[];
	scope: "loaded_dom";
	complete: false;
	scrolls: number;
	limits: string[];
}

export async function readShelf(
	session: Session,
	input: Input,
	shelf: Shelf,
	signal: AbortSignal,
): Promise<ShelfResult> {
	await session.tab.goto(PATH[shelf], { waitUntil: "domcontentloaded" });
	const state = await session.status();
	if (state.login_required)
		throw new CliError("login_required", "X requires a signed-in session", { hint: "Run xx auth login." });
	if (state.verification_required)
		throw new CliError("verification_required", "X is asking for human verification", {
			hint: "Complete it in headed Chrome, then run auth status.",
		});

	// The page opens on Bookmarks; asking for likes means selecting the tab rather
	// than trusting the URL alone, which X rewrites once the view mounts.
	if (shelf === "likes") {
		await session.tab
			.getByRole("tab", { name: /^Likes$/ })
			.first()
			.click({ timeout: 5000 })
			.catch(() => undefined);
	}

	const limit = Math.min(Math.max(input.limit ?? 20, 1), 200);
	const collected = new Map<string, ShelfItem>();
	const read = async () => {
		const rows = await session.call<(TweetRow & { liked: boolean; bookmarked: boolean })[]>("tweet.list");
		for (const row of rows) collected.set(row.id, row);
	};
	for (let attempt = 0; attempt < 30 && !collected.size; attempt++) {
		signal.throwIfAborted();
		await read();
		if (!collected.size) await new Promise((resolve) => setTimeout(resolve, 400));
	}

	const scrolls = Math.min(Math.max(input.scrolls ?? 0, 0), 20);
	let done = 0;
	while (done < scrolls && collected.size < limit) {
		signal.throwIfAborted();
		const before = collected.size;
		const moved = await session.call<{ moved: boolean }>("conversation.scroll", { pixels: 1200 });
		done++;
		if (!moved.moved) break;
		let grew = false;
		for (let attempt = 0; attempt < 8; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 400));
			await read();
			if (collected.size > before) {
				grew = true;
				break;
			}
		}
		if (!grew) break;
	}

	return {
		shelf,
		items: [...collected.values()].slice(0, limit),
		scope: "loaded_dom",
		complete: false,
		scrolls: done,
		limits: [
			"Only the cards this page has rendered are returned. X loads older entries as the list scrolls.",
			"`liked` and `bookmarked` are the current state of each card, so an item here can be one this account has since undone.",
			"An empty list means nothing loaded, not that nothing was ever saved.",
			"`items[].id` is accepted by `post like`, `post bookmark` and `comment post`.",
		],
	};
}
