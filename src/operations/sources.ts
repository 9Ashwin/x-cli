import { setTimeout as delay } from "node:timers/promises";
import type { Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import type { TweetRow } from "./comments.ts";
import { waitFor } from "./navigation.ts";
import type { Input } from "./validate.ts";

// Where a round of reading starts.
//
// Three sources — the home timeline, a search, and one status by id — and one
// shape for all of them. That shape is deliberately narrow: what the page
// rendered, with the ids needed to act on it. Nothing here ranks, scores or
// recommends; the caller decides what is worth answering.
//
// There is no "find something and reply to it" command, and this file is where
// that stops. Reading and sending are separate, and the gap between them is
// where a person decides what to say.

const HOME = "https://x.com/home";
const LIMITS = [
	"Only the posts the page has rendered are returned. X loads more as the page scrolls, so an empty list means nothing loaded, not that nobody posted.",
	"X orders these results itself. This command does not re-sort or filter them beyond excluding promoted posts.",
	"`items[].id` is accepted directly by `comment post --status` and `comment list --status`.",
];

export interface SourceResult {
	source: "timeline" | "search" | "status";
	query: string | null;
	items: TweetRow[];
	scope: "loaded_dom";
	complete: false;
	scrolls: number;
	limits: string[];
}

// A promoted post has a status id like any other, so replying to one would reach
// an advertiser's account through an ad the caller never meant to address. They
// are reported rather than dropped: a caller counting what the page served needs
// to see them, and a caller picking targets can filter on the flag.
function split(rows: TweetRow[]): { items: TweetRow[]; promoted: number } {
	const organic = rows.filter((row) => !row.promoted);
	return { items: organic, promoted: rows.length - organic.length };
}

async function collect(session: Session, input: Input, signal: AbortSignal, limit: number) {
	const collected = new Map<string, TweetRow>();
	const read = async () => {
		for (const row of await session.call<TweetRow[]>("tweet.list")) collected.set(row.id, row);
	};
	await read();
	const scrolls = Math.min(Math.max(input.scrolls ?? 0, 0), 30);
	const wanted = Math.min(Math.max(limit, 1), 200);
	let done = 0;
	while (done < scrolls && collected.size < wanted) {
		signal.throwIfAborted();
		const before = collected.size;
		const moved = await session.call<{ moved: boolean }>("conversation.scroll", { pixels: 900 });
		done++;
		if (!moved.moved) break;
		let grew = false;
		for (let attempt = 0; attempt < 8; attempt++) {
			await delay(300, undefined, { signal });
			await read();
			if (collected.size > before) {
				grew = true;
				break;
			}
		}
		if (!grew) break;
	}
	return { rows: [...collected.values()], scrolls: done };
}

// A page that answered but has nothing on it is not the same as a page that
// refused. X states both in text, and reporting the wrong one sends the caller
// looking for a selector that is fine.
async function emptyReason(session: Session): Promise<string | null> {
	const state = await session.status();
	if (state.login_required) return "login_required";
	if (state.verification_required) return "verification_required";
	const text = await session
		.call<{ visible_text?: string }>("status", { include_text: true })
		.then((value) => value.visible_text ?? "")
		.catch(() => "");
	if (/rate limit|too many requests|Something went wrong|Try again|暂时无法|操作过于频繁/i.test(text)) return "limited";
	return null;
}

export async function readTimeline(session: Session, input: Input, signal: AbortSignal): Promise<SourceResult> {
	await session.tab.goto(HOME, { waitUntil: "domcontentloaded" });
	const state = await waitFor(
		() => session.status(),
		(value) => value.login_required || value.verification_required || value.page_kind === "home",
		signal,
		20_000,
		"the home timeline",
	);
	if (state.login_required)
		throw new CliError("login_required", "X requires a signed-in session", { hint: "Run xx auth login." });
	if (state.verification_required)
		throw new CliError("verification_required", "X is asking for human verification", {
			hint: "Complete it in headed Chrome, then run auth status.",
		});
	const wanted = input.limit ?? 20;
	// The timeline renders its first batch a moment after the shell. Waiting for a
	// row rather than for a timer is what makes the read below meaningful.
	await waitFor(
		() => session.call<TweetRow[]>("tweet.list"),
		(rows) => rows.length > 0,
		signal,
		15_000,
		"timeline posts",
	).catch(async () => {
		const reason = await emptyReason(session);
		if (reason === "login_required")
			throw new CliError("login_required", "X requires a signed-in session", { hint: "Run xx auth login." });
		if (reason === "verification_required")
			throw new CliError("verification_required", "X is asking for human verification", {
				hint: "Complete it in headed Chrome, then run auth status.",
			});
		if (reason === "limited")
			throw new CliError("unsupported_page", "X rate-limited this read", {
				hint: "The page loaded but served nothing. Wait, then try again.",
				details: { source: "timeline" },
			});
	});
	const { rows, scrolls } = await collect(session, input, signal, wanted);
	const { items, promoted } = split(rows);
	return {
		source: "timeline",
		query: null,
		items: items.slice(0, wanted),
		scope: "loaded_dom",
		complete: false,
		scrolls,
		limits: [
			...LIMITS,
			`${promoted} promoted post(s) were excluded from \`items\`.`,
			"Reads whichever timeline tab is active (For you by default).",
		],
	};
}

// The search URL, not the search box. Typing into the box races its own
// autocomplete and occasionally selects a suggested user instead of the query;
// the route is unambiguous and takes the same parameters the box ends up with.
export function searchUrl(query: string): string {
	return `https://x.com/search?q=${encodeURIComponent(query)}&f=live`;
}

export async function readSearch(session: Session, input: Input, signal: AbortSignal): Promise<SourceResult> {
	const query = (input.query ?? "").trim();
	if (!query) throw new CliError("invalid_argument", "A search query is required");
	await session.tab.goto(searchUrl(query), { waitUntil: "domcontentloaded" });
	const state = await waitFor(
		() => session.status(),
		(value) => value.login_required || value.verification_required || value.page_kind === "search",
		signal,
		20_000,
		"the search page",
	);
	if (state.login_required)
		throw new CliError("login_required", "X requires a signed-in session", { hint: "Run xx auth login." });
	if (state.verification_required)
		throw new CliError("verification_required", "X is asking for human verification", {
			hint: "Complete it in headed Chrome, then run auth status.",
		});
	const wanted = input.limit ?? 20;
	await waitFor(
		() => session.call<TweetRow[]>("tweet.list"),
		(rows) => rows.length > 0,
		signal,
		15_000,
		"search results",
	).catch(async () => {
		const reason = await emptyReason(session);
		if (reason === "login_required")
			throw new CliError("login_required", "X requires a signed-in session", { hint: "Run xx auth login." });
		if (reason === "verification_required")
			throw new CliError("verification_required", "X is asking for human verification", {
				hint: "Complete it in headed Chrome, then run auth status.",
			});
		if (reason === "limited")
			throw new CliError("unsupported_page", "X rate-limited this read", {
				hint: "The page loaded but served nothing. Wait, then try again.",
				details: { source: "search", query },
			});
		// A search with genuinely no live results is an answer, not a failure.
		// Returning an empty list with the reason spelled out is better than an
		// error the caller has to decode.
	});
	const { rows, scrolls } = await collect(session, input, signal, wanted);
	const { items, promoted } = split(rows);
	return {
		source: "search",
		query,
		items: items.slice(0, wanted),
		scope: "loaded_dom",
		complete: false,
		scrolls,
		limits: [
			...LIMITS,
			`${promoted} promoted post(s) were excluded from \`items\`.`,
			"Uses the Latest tab. Engagement counts are not used for ordering.",
		],
	};
}
