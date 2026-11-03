import type { Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import type { TweetRow } from "./comments.ts";
import { type Engagement, parseEngagement } from "./hot.ts";
import type { Input } from "./validate.ts";

// The Explore board, and the posts under each entry.
//
// X's Explore has four tabs and they are not the same kind of thing:
//
//   Explore | Trending | News | Sports | Entertainment
//
// Trending is a ranked list of *words* — a topic, a category, sometimes related
// terms. News, Sports and Entertainment are one-line stories with a time and a
// post count. Neither is a post. That matters because "what is hot" usually means
// "which posts are getting attention", and the answer only exists one level down:
// every entry opens a topic page with the posts under it, and those posts carry
// full engagement.
//
// So this command has two halves: read the board, and read the posts under one
// entry. The second is the part that answers the question, and it needs no search
// term at all — which is the difference between this and `search hot`.

export type Tab = "trending" | "news" | "sports" | "entertainment";

export interface TrendEntry {
	tab: Tab;
	// X's own rank on the Trending tab; null on the story tabs, which are ordered
	// but not numbered.
	rank: number | null;
	// "Sports · Trending", or "Trending now · News · 1.8K posts".
	meta: string;
	topic: string;
	// Related terms the row names, e.g. "Trending with Seahawks, Seattle".
	context: string | null;
	// Present on the story tabs: the structured reading of `meta`.
	posts: number | null;
	age: string | null;
	// The topic page, `/i/trending/<id>`. This is what `--topic` takes.
	topic_id: string | null;
	url: string | null;
	// Position on the board, which is how the row is opened: the entry carries no
	// id until something clicks it.
	row_index: number;
}

export interface TrendBoard {
	tab: Tab;
	items: TrendEntry[];
	scope: "loaded_dom";
	complete: false;
	limits: string[];
}

export interface TopicPosts {
	// A Trending word opens a search page rather than a topic page, and search
	// pages have no topic id. Null says which kind of page this was.
	topic_id: string | null;
	url: string;
	title: string | null;
	items: (TweetRow & { engagement: Engagement })[];
	scope: "loaded_dom";
	complete: false;
	limits: string[];
}

const TABS: Record<Tab, string> = {
	trending: "https://x.com/explore/tabs/trending",
	news: "https://x.com/explore/tabs/news",
	sports: "https://x.com/explore/tabs/sports",
	entertainment: "https://x.com/explore/tabs/entertainment",
};

export function tabOf(value: string | undefined): Tab {
	const tab = (value ?? "trending").toLowerCase();
	if (tab in TABS) return tab as Tab;
	throw new CliError("invalid_argument", `--tab must be one of ${Object.keys(TABS).join(", ")}`);
}

export async function waitForBoard(session: Session, tab: Tab, signal: AbortSignal): Promise<TrendEntry[]> {
	await session.tab.goto(TABS[tab], { waitUntil: "domcontentloaded" });
	const state = await session.status();
	if (state.login_required)
		throw new CliError("login_required", "X requires a signed-in session", { hint: "Run xx auth login." });
	if (state.verification_required)
		throw new CliError("verification_required", "X is asking for human verification", {
			hint: "Complete it in headed Chrome, then run auth status.",
		});
	// The board renders a few seconds after the shell; reading immediately returned
	// an empty list on a page that had thirty entries a moment later.
	let items: TrendEntry[] = [];
	for (let attempt = 0; attempt < 30 && !items.length; attempt++) {
		signal.throwIfAborted();
		items = await session.call<TrendEntry[]>("trend.list", { tab });
		if (!items.length) await new Promise((resolve) => setTimeout(resolve, 400));
	}
	return items;
}

export async function readBoard(session: Session, input: Input, signal: AbortSignal): Promise<TrendBoard> {
	const tab = tabOf(input.tab);
	const all = await waitForBoard(session, tab, signal);
	const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
	return {
		tab,
		items: all.slice(0, limit),
		scope: "loaded_dom",
		complete: false,
		limits: [
			"An entry is a topic or a story, not a post. Pass its `row_index` (and the same `--tab`) to `trend posts --index` to read the posts under it.",
			tab === "trending"
				? "Rank is X's own. Promoted entries are excluded so the ranks stay as X numbered them."
				: "These tabs show a title, an age and a post count. The count is how many posts the topic has, not how many are loaded.",
			"The board is ordered and localized by X; this command does not translate or re-rank it.",
		],
	};
}

// The posts under one entry. This is where the actual engagement lives: the
// board says "1.8K posts", and this says which of them are being read.
//
// The board row has no href and no id of its own — X opens the topic page from a
// click handler — so the id exists only after the row is opened. `--index` is how
// a caller names a row it just read: the command reopens the same tab, clicks the
// row with that `row_index`, and follows the URL. `--topic` skips that when the id
// is already known.
export async function readTopic(session: Session, input: Input, signal: AbortSignal): Promise<TopicPosts> {
	const tab = tabOf(input.tab);
	const topic = (input.topic ?? "").trim();
	let title: string | null = null;
	if (topic) {
		if (!/^\d{1,25}$/.test(topic))
			throw new CliError("invalid_argument", "--topic must be the numeric topic_id from trend read");
		await session.tab.goto(`https://x.com/i/trending/${topic}`, { waitUntil: "domcontentloaded" });
	} else {
		const index = Number(input.index);
		if (!Number.isInteger(index) || index < 0)
			throw new CliError("invalid_argument", "Pass --topic or --index", {
				hint: "trend read returns row_index for every entry; pass one of them as --index.",
			});
		await waitForBoard(session, tab, signal);
		const board = await session.call<TrendEntry[]>("trend.list", { tab });
		title = board.find((entry) => entry.row_index === index)?.topic ?? null;
		const opened = await session.call<{ found: boolean }>("trend.open", { index });
		if (!opened.found)
			throw new CliError("not_found", "The board has no row at that index", {
				hint: "Read the board again with trend read and use one of its row_index values.",
				details: { index, tab },
			});
		// The click navigates, and where it lands depends on the tab: a News story
		// opens `/i/trending/<id>`, while a Trending word opens `/search?q=…`. Both
		// render posts, and both are what a reader wants, so either is followed —
		// only the topic id is conditional on which one it was.
		let landed = false;
		for (let attempt = 0; attempt < 40 && !landed; attempt++) {
			signal.throwIfAborted();
			landed = !Object.values(TABS).includes(session.tab.url());
			if (!landed) await new Promise((resolve) => setTimeout(resolve, 200));
		}
		if (!landed)
			throw new CliError("not_found", "That row did not open", {
				hint: "The board may not have finished loading. Read it again with trend read.",
				details: { index, tab, url: session.tab.url() },
			});
	}
	const state = await session.status();
	if (state.login_required)
		throw new CliError("login_required", "X requires a signed-in session", { hint: "Run xx auth login." });
	if (state.verification_required)
		throw new CliError("verification_required", "X is asking for human verification", {
			hint: "Complete it in headed Chrome, then run auth status.",
		});

	const url = session.tab.url();
	const resolved = /\/i\/trending\/(\d{1,25})/.exec(url)?.[1] ?? topic;
	const collected = new Map<string, TweetRow & { engagement: Engagement }>();
	const read = async () => {
		const rows = await session
			.call<(TweetRow & { engagement_label?: string | null })[]>("tweet.list")
			.catch((error: unknown) => {
				// The topic page renders its posts after the header; a read that lands
				// mid-navigation is a wait, not a broken selector.
				const message = error instanceof Error ? error.message : "";
				if (/Execution context|context was destroyed|Target closed|navigat/i.test(message)) return [];
				throw error;
			});
		for (const row of rows) {
			if (row.promoted) continue;
			collected.set(row.id, { ...row, engagement: parseEngagement(row.engagement_label) });
		}
	};
	for (let attempt = 0; attempt < 30 && !collected.size; attempt++) {
		signal.throwIfAborted();
		await read();
		if (!collected.size) await new Promise((resolve) => setTimeout(resolve, 400));
	}
	if (!collected.size)
		throw new CliError("selector_changed", "The topic page rendered no posts", {
			hint: "The topic may have expired. Read the board again and pick a current entry.",
			details: { topic: resolved },
		});

	const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
	return {
		topic_id: resolved || null,
		url,
		title,
		items: [...collected.values()].slice(0, limit),
		scope: "loaded_dom",
		complete: false,
		limits: [
			"A News/Sports/Entertainment row opens a topic page; a Trending word opens a search page. Both are read the same way and `url` says which one it was.",
			"Posts are in the order the page gave them, which X ranks by its own mix of recency and engagement.",
			"Engagement comes from each card's summary label. A count the page did not print is null, not zero.",
			"`items[].id` is accepted by `comment list --status`, `comment section --status` and `comment post --status`.",
		],
	};
}
