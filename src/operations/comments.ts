import { setTimeout as delay } from "node:timers/promises";
import type { Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import { openStatus } from "./navigation.ts";
import { authorOf, type Input } from "./validate.ts";

// Reading a conversation.
//
// X loads replies as the page scrolls, so a read is a bounded window over what
// the page has rendered — never the full thread. That is stated in every
// response rather than left for the caller to assume.

export interface TweetRow {
	id: string;
	handle: string | null;
	name: string | null;
	text: string;
	at: string | null;
	likes: number | null;
	replies: number | null;
	retweets: number | null;
	reply_to: { handle: string; id: string | null } | null;
	root: boolean;
	mine: boolean;
	depth: number;
	// Present on every row the adapter returns; the flag is what keeps a promoted
	// post out of a list a caller is choosing a reply target from.
	promoted?: boolean;
}

export interface ListResult {
	status_id: string;
	root: TweetRow | null;
	items: TweetRow[];
	scope: "loaded_dom";
	complete: false;
	scrolls: number;
	limits: string[];
}

export async function listComments(
	session: Session,
	input: Input,
	id: string,
	signal: AbortSignal,
): Promise<ListResult> {
	await openStatus(session, id, signal, input.resource?.includes("/status/") ? authorOf(input) : null);
	const collected = new Map<string, TweetRow>();
	const collect = (rows: TweetRow[]) => {
		for (const row of rows) collected.set(row.id, row);
	};
	collect(await session.call<TweetRow[]>("tweet.list"));

	const limit = Math.min(Math.max(input.limit ?? 20, 1), 200);
	const scrolls = Math.min(Math.max(input.scrolls ?? 0, 0), 30);
	let done = 0;
	while (done < scrolls && collected.size < limit) {
		signal.throwIfAborted();
		const before = collected.size;
		const moved = await session.call<{ moved: boolean }>("conversation.scroll", { pixels: 900 });
		done++;
		// A list that stops growing has reached the end of what this session can
		// load. Reporting a reason is better than scrolling a page that is static.
		if (!moved.moved) break;
		let grew = false;
		for (let attempt = 0; attempt < 8; attempt++) {
			await delay(300, undefined, { signal });
			collect(await session.call<TweetRow[]>("tweet.list"));
			if (collected.size > before) {
				grew = true;
				break;
			}
		}
		if (!grew) break;
	}

	const rows = [...collected.values()];
	const root = rows.find((row) => row.root) ?? rows[0] ?? null;
	const replies = rows.filter((row) => row.id !== root?.id).slice(0, limit);
	return {
		status_id: id,
		root,
		items: replies,
		scope: "loaded_dom",
		complete: false,
		scrolls: done,
		limits: [
			"Only replies the page has rendered are returned. X loads more as the conversation scrolls, so an empty list means nothing loaded, not that nobody replied.",
			"X may hide replies the author has restricted or that its ranking kept further down; this command does not remove that ordering.",
			"A thread can contain replies to replies. `depth` is 1 for a tweet drawn under another, 0 for one drawn at the top level.",
		],
	};
}

// One reply in full, plus the conversation root it answers, so a caller can read
// the context it is about to answer without a second call.
export async function getComment(
	session: Session,
	input: Input,
	id: string,
	commentID: string,
	signal: AbortSignal,
): Promise<unknown> {
	const listed = await listComments(session, { ...input, limit: 200 }, id, signal);
	const reply = listed.items.find((row) => row.id === commentID);
	if (!reply)
		throw new CliError("not_found", "That reply is not in the loaded window", {
			hint: "Increase --scrolls, or confirm the id with comment list.",
			details: { status_id: id, comment_id: commentID, loaded: listed.items.length },
		});
	return { ...listed, items: [reply] };
}

// Scroll the conversation without reading it, for a caller that wants the page
// positioned where the next read will see more.
export async function scrollConversation(session: Session, pixels: number): Promise<unknown> {
	return session.call("conversation.scroll", { pixels });
}
