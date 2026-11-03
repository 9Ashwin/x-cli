import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Point, Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import type { Receipt, Store } from "../store.ts";
import type { TweetRow } from "./comments.ts";
import { openStatus, waitFor } from "./navigation.ts";
import { authorOf, type Input } from "./validate.ts";

// Deleting one of this account's own posts.
//
// This is the one operation with nothing to undo, so it is built around proving
// which post is about to go:
//
// 1. The post must be the one the URL names, read off the page.
// 2. It must be this account's, proven by the author link rather than by the
//    menu being present — a post by someone else has a caret too.
// 3. The menu must offer exactly one delete item, and the ownership check runs
//    again between opening the menu and pressing it.
// 4. The confirmation dialog names nothing, so it is only trusted because it
//    followed this exact press; the caller has to have said --confirm.
//
// Point 3 is the one that matters. A previous hand-cleaning run pressed a caret
// that belonged to the first article on the page instead of the reply being
// cleaned up, and the dialog — which says nothing about its target — accepted it.
// A post was deleted that was never meant to be touched.

export interface DeleteResult {
	status_id: string;
	handle: string | null;
	text: string;
	kind: "post" | "reply" | "repost";
	deleted: boolean;
	request_id: string;
	verification: { gone_from_page: boolean; check_url: string };
}

export async function remove(
	session: Session,
	input: Input,
	statusID: string,
	signal: AbortSignal,
	deps: { store: Store; self: string | null },
): Promise<DeleteResult> {
	const { store, self } = deps;
	if (input.confirm !== true)
		throw new CliError("invalid_argument", "Deleting cannot be undone", {
			hint: "Re-run with --confirm once you have checked the post is the one you mean.",
			details: { status_id: statusID },
		});
	const key = input.request_id ?? randomUUID();

	// A delete replayed is not a delete repeated: the post is already gone, and
	// pressing anything again would act on whatever now occupies its place.
	const receipts = await store.receipts();
	const existing = Object.hasOwn(receipts, key) ? receipts[key] : undefined;
	if (existing) {
		if (existing.fingerprint !== `delete:${statusID}`)
			throw new CliError("idempotency_conflict", "The request ID belongs to a different post", {
				details: { request_id: key },
			});
		if (existing.status === "confirmed") return { ...(existing.result as DeleteResult), request_id: key };
		if (existing.status !== "not_sent")
			throw new CliError("delivery_uncertain", "That delete may already have happened; it was not repeated", {
				details: { request_id: key, receipt: existing },
			});
	}

	await openStatus(session, statusID, signal, authorOf(input));
	// openStatus waits for the conversation to render, but the article the URL
	// names can settle a beat later. Polling for the specific row is what keeps a
	// slow render from being reported as "not on the page".
	let rows = await session.call<TweetRow[]>("tweet.list");
	for (let attempt = 0; attempt < 20 && !rows.some((row) => row.id === statusID); attempt++) {
		await delay(300, undefined, { signal });
		rows = await session.call<TweetRow[]>("tweet.list");
	}
	const target = rows.find((row) => row.id === statusID);
	if (!target)
		throw new CliError("not_found", "That post is not on the page", {
			hint: "It may already be deleted, or it belongs to an account this session cannot see.",
			details: { status_id: statusID },
		});
	// Ownership is decided by the author link, not by whether a menu appeared.
	if (!self)
		throw new CliError("identity_mismatch", "The signed-in account is not readable", {
			hint: "Run auth status. Refusing to delete without knowing whose post this is.",
		});
	if (target.handle?.toLowerCase() !== self.toLowerCase())
		throw new CliError("identity_mismatch", "That post belongs to another account", {
			hint: "Only this account's own posts can be deleted. Nothing was changed.",
			details: { status_id: statusID, author: target.handle, self },
		});

	// `tweet.list` reading the row does not mean the page has painted it — the
	// caret is rendered with the action row, which lands a frame later. Retrying
	// the measurement is what separates "still painting" from "this post has no
	// menu", and those two need different answers.
	const token = randomUUID();
	let open: Point | null = null;
	for (let attempt = 0; attempt < 15 && !open; attempt++) {
		open = await session.call<Point>("delete.caret", { tweet_id: statusID, token }).catch((error: unknown) => {
			if (error instanceof CliError && error.code === "selector_changed") return null;
			throw error;
		});
		if (!open) await delay(300, undefined, { signal });
	}
	if (!open)
		throw new CliError("selector_changed", "This post has no more-menu", {
			hint: "The post may not be yours, or it is not deletable from this page. Nothing was changed.",
			details: { status_id: statusID, kind: target.kind },
		});
	const item = await (async () => {
		await session.click(open);
		return waitFor(
			async () => {
				const point = await session.call<Point>("delete.item", { token }).catch((error: unknown) => {
					// A menu that has not finished rendering is a wait, not a refusal.
					if (error instanceof CliError && error.code === "selector_changed") return null;
					throw error;
				});
				return point;
			},
			(point) => !!point,
			signal,
			5000,
			"the delete menu item",
		).catch(() => null);
	})();
	if (!item)
		throw new CliError("selector_changed", "The more-menu offered no delete item", {
			hint: "The post may not be this account's, or it is not deletable from this page. Nothing was changed.",
			details: { status_id: statusID, kind: target.kind },
		});

	const now = new Date().toISOString();
	const receipt: Receipt = {
		request_id: key,
		fingerprint: `delete:${statusID}`,
		operation: "comment.delete",
		status: "dispatching",
		target: { tweet_id: statusID },
		created_at: now,
		updated_at: now,
	};
	await store.saveReceipt(receipt);
	await session.click(item);
	const dialog = await waitFor(
		() => session.call<{ open: boolean; text: string }>("delete.confirm"),
		(state) => state.open,
		signal,
		5000,
		"the delete confirmation",
	).catch(() => null);
	if (!dialog)
		throw new CliError("selector_changed", "The delete confirmation did not open", {
			hint: "The menu item was pressed but nothing asked to confirm. Check the post in headed Chrome.",
			details: { request_id: key, receipt },
		});
	const confirm = await session.call<Point>("delete.confirm-button", { token: randomUUID() });
	await session.click(confirm);

	// A delete is confirmed by the post leaving the page. Waiting for that rather
	// than for the dialog closing means a slow dialog cannot be mistaken for a
	// failed delete, and a failed delete cannot look like a success.
	let gone = false;
	for (let attempt = 0; attempt < 20 && !gone; attempt++) {
		await delay(400, undefined, { signal });
		const state = await session.call<{ gone: boolean }>("delete.state", { tweet_id: statusID }).catch(() => null);
		gone = state?.gone === true;
	}
	if (!gone) {
		receipt.uncertainty_reason = "post_still_listed";
		receipt.updated_at = new Date().toISOString();
		await store.saveReceipt(receipt);
		throw new CliError("delivery_uncertain", "The delete was confirmed but the post is still there", {
			hint: "Check the post in headed Chrome. Do not press delete again without looking.",
			details: { request_id: key, receipt },
		});
	}
	const result: DeleteResult = {
		status_id: statusID,
		handle: target.handle,
		text: target.text.slice(0, 200),
		kind: target.kind ?? "post",
		deleted: true,
		request_id: key,
		verification: { gone_from_page: true, check_url: `https://x.com/i/web/status/${statusID}` },
	};
	receipt.status = "confirmed";
	receipt.updated_at = new Date().toISOString();
	receipt.result = result;
	await store.saveReceipt(receipt);
	await store.append("comment.delete", { request_id: key, status_id: statusID, kind: target.kind });
	return result;
}

// Removing a batch of this account's own posts.
//
// The single delete above proves each target before touching it; this repeats
// that for a list, and adds the two things a loop needs: it stops on the first
// thing it cannot prove rather than pressing on, and it reports what it did and
// did not reach. There is no undo for any of it, so a partial run is the honest
// outcome when something goes wrong midway.
//
// It only ever deletes posts whose author is this account. A post by someone
// else in the list is skipped and named, never deleted.

export interface BatchResult {
	attempted: number;
	deleted: string[];
	skipped: { id: string; reason: string }[];
	stopped: { at: string; reason: string } | null;
	request_ids: string[];
}

export async function removeMany(
	session: Session,
	input: Input,
	ids: string[],
	signal: AbortSignal,
	deps: { store: Store; self: string | null },
): Promise<BatchResult> {
	if (input.confirm !== true)
		throw new CliError("invalid_argument", "Deleting cannot be undone", {
			hint: `Re-run with --confirm to delete ${ids.length} post(s). Nothing was changed.`,
			details: { count: ids.length, status_ids: ids.slice(0, 50) },
		});
	const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
	const wanted = ids.slice(0, limit);
	const result: BatchResult = { attempted: wanted.length, deleted: [], skipped: [], stopped: null, request_ids: [] };
	for (const statusID of wanted) {
		signal.throwIfAborted();
		try {
			const one = await remove(
				session,
				{
					...input,
					status_id: statusID,
					request_id: `${input.request_id ?? "delete"}-${statusID}`,
				},
				statusID,
				signal,
				deps,
			);
			result.deleted.push(one.status_id);
			result.request_ids.push(one.request_id);
		} catch (error) {
			// Ownership and not-found are per-post answers: skip and keep going.
			// Anything else means the page is not behaving, and continuing would be
			// guessing at what the next press hits.
			if (error instanceof CliError && ["identity_mismatch", "not_found"].includes(error.code)) {
				result.skipped.push({ id: statusID, reason: error.message });
				continue;
			}
			result.stopped = { at: statusID, reason: error instanceof Error ? error.message : String(error) };
			break;
		}
	}
	if (!result.stopped && result.skipped.length === 0) result.stopped = null;
	return result;
}
