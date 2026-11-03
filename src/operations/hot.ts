import type { Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import type { TweetRow } from "./comments.ts";
import { searchUrl } from "./sources.ts";
import type { Input } from "./validate.ts";

// Finding posts that are being talked about.
//
// X's own search already ranks by engagement when the Top tab is asked for, and
// its operators (`min_faves:`, `lang:`, `since:`) narrow that to a topic and a
// language. This composes those into one query instead of re-ranking the
// results: the platform's ordering is better informed than anything computed
// from five visible cards, and inventing a second ranking would make the numbers
// in the response mean something other than what X said.

export interface Engagement {
	likes: number | null;
	replies: number | null;
	reposts: number | null;
	bookmarks: number | null;
	views: number | null;
}

export interface HotPost extends TweetRow {
	engagement: Engagement;
	// What the page put in front of this card, in the order it put it.
	rank: number;
}

export interface HotResult {
	query: string;
	search_text: string;
	items: HotPost[];
	scope: "loaded_dom";
	complete: false;
	limits: string[];
}

// X writes every count into one aria-label on the group of action buttons:
// "174 replies, 541 reposts, 2741 likes, 3949 bookmarks, 234215 views". Reading
// each button separately misses bookmarks and views entirely — the bookmark
// button's label is just "Bookmark", with no count.
export function parseEngagement(label: string | undefined | null): Engagement {
	const parsed: Engagement = { likes: null, replies: null, reposts: null, bookmarks: null, views: null };
	if (!label) return parsed;
	const pattern = /([\d,]+)\s*(replies|reposts|likes|bookmarks|views|quotes)/g;
	for (const match of label.matchAll(pattern)) {
		const value = Number.parseInt(match[1].replace(/,/g, ""), 10);
		if (!Number.isFinite(value)) continue;
		const key = match[2];
		if (key === "replies") parsed.replies = value;
		else if (key === "reposts") parsed.reposts = value;
		else if (key === "likes") parsed.likes = value;
		else if (key === "bookmarks") parsed.bookmarks = value;
		else if (key === "views") parsed.views = value;
	}
	return parsed;
}

// The query the page is asked for. Numbers the caller gives are floors, not
// targets: X applies them as filters, and a result below one would mean the
// filter did not apply rather than that the search found something close.
export function hotQuery(input: Input): string {
	const topic = (input.query ?? "").trim();
	if (!topic)
		throw new CliError("invalid_argument", "A topic is required", { hint: "Pass --query with a word or phrase." });
	const parts = [topic];
	if (input.language) parts.push(`lang:${input.language}`);
	// X applies this before its own ranking, and a floor that is even slightly too
	// high empties the Top tab rather than returning fewer posts. It stays opt-in
	// for that reason: a larger `--limit` plus local selection is usually the
	// better tool, and a filter that returns nothing looks like "no such topic".
	if (input.min_likes) parts.push(`min_faves:${Math.max(1, Math.floor(input.min_likes))}`);
	if (input.min_replies) parts.push(`min_replies:${Math.max(1, Math.floor(input.min_replies))}`);
	if (input.since) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(input.since))
			throw new CliError("invalid_argument", "--since must be a date, YYYY-MM-DD");
		parts.push(`since:${input.since}`);
	}
	// Retweets are copies of something already in the results; without this the
	// Top tab spends slots on the same post twice.
	parts.push("-filter:retweets");
	return parts.join(" ");
}

export async function findHot(session: Session, input: Input, signal: AbortSignal): Promise<HotResult> {
	const search = hotQuery(input);
	await session.tab.goto(searchUrl(search), { waitUntil: "domcontentloaded" });
	// The Top tab is what ranks by engagement. searchUrl asks for Latest, so the
	// tab is switched rather than assumed: a Latest list ordered by time would
	// make "most engaged" mean "most recent", which is a different question.
	await session.tab
		.getByRole("tab", { name: /^Top$/ })
		.first()
		.click({ timeout: 5000 })
		.catch(() => undefined);
	const limit = Math.min(Math.max(input.limit ?? 10, 1), 100);

	const collected = new Map<string, HotPost>();
	// The tab switches tabs and navigates while this polls, and a read that lands
	// mid-navigation fails with "Execution context was destroyed". That is the page
	// moving, not a broken selector — it is a wait, and retrying it is what turns
	// a half-second race into an answer instead of an internal error.
	const read = async () => {
		const rows = await session
			.call<(TweetRow & { engagement_label?: string | null })[]>("tweet.list", { engagement: true })
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : "";
				if (/Execution context|context was destroyed|Target closed|navigat/i.test(message)) return [];
				throw error;
			});
		rows.forEach((row, index) => {
			if (!row.id || row.promoted) return;
			collected.set(row.id, {
				...row,
				engagement: parseEngagement(row.engagement_label),
				rank: collected.size + index + 1,
			});
		});
	};
	// The results render after the shell, and a card can exist before its summary
	// label does — the skeleton row has the author and text but no counts. Waiting
	// only for a row therefore returned a full list of posts with every engagement
	// number null, and since the scroll loop below stops once the list is at the
	// limit, those nulls were never corrected. The wait is for a row that actually
	// carries counts.
	const labelled = async () => {
		let rows: (TweetRow & { engagement_label?: string | null })[] = [];
		try {
			rows = await session.call<(TweetRow & { engagement_label?: string | null })[]>("tweet.list", {
				engagement: true,
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "";
			if (!/Execution context|context was destroyed|Target closed|navigat/i.test(message)) throw error;
		}
		return rows.some((row) => !row.promoted && (row.engagement_label ?? "").trim().length > 0);
	};
	for (let attempt = 0; attempt < 40 && !(collected.size > 0 && (await labelled())); attempt++) {
		signal.throwIfAborted();
		await read();
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	// One more pass, so the last rows read are the ones with labels rather than the
	// skeleton versions the first poll may have captured.
	await read();
	const scrolls = Math.min(Math.max(input.scrolls ?? 0, 0), 20);
	for (let done = 0; done < scrolls && collected.size < limit; done++) {
		signal.throwIfAborted();
		const before = collected.size;
		await session.call("conversation.scroll", { pixels: 1200 });
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

	if (!collected.size) {
		const state = await session.status();
		if (state.login_required)
			throw new CliError("login_required", "X requires a signed-in session", { hint: "Run x-cli auth login." });
	}
	const items = [...collected.values()].slice(0, limit);
	return {
		query: input.query ?? "",
		search_text: search,
		items,
		scope: "loaded_dom",
		complete: false,
		limits: [
			"Ordered by X's Top tab for this query. The ordering is the platform's; this command does not re-rank it.",
			`Engagement counts are what the cards show, read from one aria-label per card. A count the page did not print is null rather than zero.`,
			"An empty list means the query returned nothing on the Top tab, not that no post matched. `--min-likes` is applied by X before its ranking and empties the tab more often than it narrows it; prefer a larger --limit and choose locally.",
			"`items[].id` is accepted by `comment list --status` and `comment post --status`.",
		],
	};
}
