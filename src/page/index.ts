import { type Action, actionControl, actionResult, repostMenu, toggleState } from "./actions.ts";
import { type ArmArgs, armWrite, cleanup, composerState, prepareWrite, writeResult } from "./composer.ts";
import { caret, confirmButton, confirmDialog, deleteItem, gone } from "./delete.ts";
import { clean, fail, findRendered, type Point, point } from "./dom.ts";
import {
	actionControl as followActionControl,
	actionResult as followActionResult,
	followControl,
	pendingConfirm,
	pendingDialog,
} from "./follow.ts";
import { readNotifications } from "./notify.ts";
import { account, snapshot } from "./page.ts";
import { openRow } from "./trend.ts";
import { findTweet, readTweets, replyControl, scrollConversation } from "./tweets.ts";

// The page adapter. It is bundled on its own and injected into the owned tab;
// every operation answers `{data}` or `{error}`, and nothing here decides what a
// command may do — it only reads and measures the page.

interface Args extends Partial<ArmArgs> {
	tweet_id?: string;
	limit?: number;
	action?: string;
	wanted?: boolean;
	handle?: string;
	index?: number;
	tab?: string;
	pixels?: number;
	include_text?: boolean;
	token?: string;
}

export interface PageError {
	code: string;
	message: string;
	hint?: string;
}

function selfHandle(): string | null {
	return account()?.handle ?? null;
}

function execute(operation: string, args: Args): unknown {
	switch (operation) {
		case "status":
			return snapshot(args.include_text === true);
		case "account":
			return account();
		case "tweet.list": {
			const rows = readTweets(selfHandle());
			return args.limit ? rows.slice(0, args.limit) : rows;
		}
		case "reply.control": {
			if (!args.tweet_id) fail("invalid_argument", "tweet_id is required");
			// The reply control and the post button carry different marks. Sharing one
			// token meant `[data-x-cli-control="…"]` matched both once the composer
			// opened, and the press was refused as ambiguous — the same selector was
			// used to open the composer and to send from it.
			return point(replyControl(findTweet(args.tweet_id)), `${args.token ?? "reply"}-open`) satisfies Point;
		}
		case "reply.composer":
			// Called before the control is pressed, so a composer that is already
			// open is a wait rather than an error.
			return composerState();
		case "reply.prepare":
			return prepareWrite(args as ArmArgs);
		case "reply.arm-write":
			return armWrite(args as ArmArgs);
		case "reply.result":
			return writeResult(args as { token: string; text: string });
		case "reply.blocked":
			return window.__xCLI?.blocked_reason ?? null;
		case "action.state": {
			if (!args.tweet_id || !args.action) fail("invalid_argument", "tweet_id and action are required");
			return toggleState(args.action as Action, args.tweet_id);
		}
		case "action.control": {
			if (!args.tweet_id || !args.action) fail("invalid_argument", "tweet_id and action are required");
			return actionControl(args.action as Action, args.tweet_id, args.wanted === true, args.token ?? "action");
		}
		case "action.result": {
			if (!args.tweet_id || !args.action) fail("invalid_argument", "tweet_id and action are required");
			// A repost's menu is still open when the result is read; the plain item
			// is what was pressed, and the menu closing is the page acknowledging it.
			return actionResult(args.action as Action, args.tweet_id, args.wanted === true);
		}
		case "repost.menu":
			return repostMenu();
		case "follow.state":
			return { following: followControl(args.handle ?? "").state.following };
		case "follow.control": {
			const control = followActionControl(args.handle ?? "", args.wanted === true, args.token ?? "follow");
			return control;
		}
		case "follow.result":
			return followActionResult(args.handle ?? "", args.wanted === true);
		case "follow.pending":
			return pendingDialog();
		case "follow.pending-confirm":
			return pendingConfirm(args.token ?? "follow-confirm");
		case "delete.caret":
			return caret(args.tweet_id ?? "", args.token ?? "caret");
		case "delete.item":
			return deleteItem(args.token ?? "delete");
		case "delete.confirm":
			return confirmDialog();
		case "delete.confirm-button":
			return confirmButton(args.token ?? "confirm");
		case "delete.state":
			return gone(args.tweet_id ?? "");
		case "trend.open":
			return openRow(args.index ?? -1);
		case "notification.list":
			return readNotifications();
		case "trend.list": {
			// The four Explore tabs render the same `trend` row shape but say different
			// things in it. Trending: rank, category, topic. News/Sports/Entertainment:
			// a title, an age, a category and a post count. One reader handles both by
			// reading the meta line rather than assuming which tab it is.
			const rows = findRendered<HTMLElement>(document, '[data-testid="trend"]');
			const tab = args.tab ?? "trending";
			return rows
				.map((row) => {
					const leaves = [...row.querySelectorAll("span")]
						.map((span) => clean(span.textContent))
						.filter((text) => text && text !== "·");
					// A promoted entry is an ad, not a topic. It is dropped rather than
					// numbered, so the ranks stay the ones X printed.
					if (/Promoted|推广|广告/i.test(clean(row.textContent))) return null;
					const rankText = /^\d{1,3}$/.test(leaves[0] ?? "") ? leaves[0] : null;
					const meta =
						// The category line is localized and its words vary: "Sports · Trending"
						// in English, but "美国 的趋势" in Chinese — the region replaces the
						// category noun and the word for "trending" changes shape. The row's
						// category line is the one that carries the separator and no rank, so
						// it is matched by shape, with the known words as a preference.
						leaves.find(
							(text) =>
								text.includes("·") &&
								/Trending|News|Sports|Entertainment|热门|新闻|体育|娱乐|趋势|時事|トレンド/i.test(text),
						) ??
						leaves.find((text) => text !== rankText && !/^\d{1,3}$/.test(text) && text.length <= 12) ??
						leaves.find((text) => text.includes("·")) ??
						"";
					const rest = leaves.filter((text) => text !== rankText && text !== meta);
					// The meta line of a story tab reads "17 hours ago · News · 4.8K posts".
					const postMatch = /([\d.,]+)\s*([KkMm])?\s*posts?/i.exec(meta);
					const posts = postMatch
						? Math.round(
								Number.parseFloat(postMatch[1].replace(/,/g, "")) *
									(postMatch[2]?.toUpperCase() === "K" ? 1000 : postMatch[2]?.toUpperCase() === "M" ? 1_000_000 : 1),
							)
						: null;
					const age =
						/^(\d+ (?:second|minute|hour|day|week)s? ago|\d+[小时天周]前|刚刚|Trending now|正在热门)$/i.exec(
							meta.split("·")[0]?.trim() ?? "",
						)?.[0] ?? null;
					const href = row.querySelector('a[href*="/i/trending/"],a[href*="search"]')?.getAttribute("href") ?? null;
					const topicID = href ? (/\/i\/trending\/(\d{1,25})/.exec(href)?.[1] ?? null) : null;
					return {
						tab,
						rank: rankText ? Number(rankText) : null,
						// The row carries no href and no id of its own: X opens the topic
						// page from a click handler. The index is what a later call can name
						// the row by, so it is recorded here while the board is on screen.
						row_index: rows.indexOf(row),
						meta,
						topic: rest[0] ?? "",
						context: rest.length > 1 ? rest.slice(1).join(" | ") : null,
						posts,
						age,
						topic_id: topicID,
						url: href,
					};
				})
				.filter((row): row is NonNullable<typeof row> => !!row && !!row.topic);
		}
		case "conversation.scroll":
			return scrollConversation(args.pixels ?? 900);
		case "cleanup":
			return cleanup();
		default:
			fail("invalid_argument", `Unknown browser operation: ${operation}`);
	}
}

export async function call(operation: string, args: Args & { seconds?: number }) {
	try {
		return { data: await execute(operation, args) };
	} catch (error: unknown) {
		const value = error as Partial<PageError>;
		return {
			error: {
				code: typeof value?.code === "string" ? value.code : "selector_changed",
				message: typeof value?.message === "string" ? value.message : "Browser operation failed",
				hint: value?.hint ?? "",
			},
		};
	}
}
