import { randomUUID } from "node:crypto";
import type { Point, Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import type { Receipt, Store } from "../store.ts";
import { openStatus, waitFor } from "./navigation.ts";
import { authorOf, type Input } from "./validate.ts";

// Liking, bookmarking and reposting.
//
// These are writes with no text, so the receipt has less to prove: the page
// states the state of each toggle before and after, and that state is the
// evidence. What they share with a reply is the rule about not guessing — a
// control that cannot be found, or a state that does not change, is reported
// rather than followed by a second press.

export type Action = "like" | "bookmark" | "repost";

export interface ActionResult {
	action: Action;
	status_id: string;
	confirmed: boolean;
	already: boolean;
	on: boolean;
	label: string | null;
	request_id: string;
}

export async function apply(
	session: Session,
	action: Action,
	input: Input,
	statusID: string,
	signal: AbortSignal,
	deps: { store: Store },
): Promise<ActionResult> {
	const wanted = input.value !== false;
	const key = input.request_id ?? randomUUID();
	const { store } = deps;

	// Replaying a confirmed toggle is an answer, not a repeat: pressing it again
	// would undo the thing the caller asked for.
	const receipts = await store.receipts();
	const existing = Object.hasOwn(receipts, key) ? receipts[key] : undefined;
	if (existing) {
		if (existing.fingerprint !== fingerprint(action, statusID, wanted))
			throw new CliError("idempotency_conflict", "The request ID belongs to different input", {
				details: { request_id: key },
			});
		if (existing.status === "confirmed") return { ...(existing.result as ActionResult), request_id: key };
		if (existing.status !== "not_sent")
			throw new CliError("delivery_uncertain", "That action may already have been applied; it was not repeated", {
				details: { request_id: key, receipt: existing },
			});
	}

	await openStatus(session, statusID, signal, authorOf(input));
	const token = randomUUID();
	const current = await session.call<{ on: boolean }>("action.state", { tweet_id: statusID, action });
	if (current.on === wanted)
		return {
			action,
			status_id: statusID,
			confirmed: true,
			already: true,
			on: current.on,
			label: null,
			request_id: key,
		};

	if (action === "repost") return repost(session, input, statusID, wanted, key, signal, store);

	const control = await session.call<Point & { already: boolean }>("action.control", {
		tweet_id: statusID,
		action,
		wanted,
		token,
	});
	if (control.already)
		return {
			action,
			status_id: statusID,
			confirmed: true,
			already: true,
			on: current.on,
			label: null,
			request_id: key,
		};

	const now = new Date().toISOString();
	const receipt: Receipt = {
		request_id: key,
		fingerprint: fingerprint(action, statusID, wanted),
		operation: `post.${action}`,
		status: "prepared",
		target: { tweet_id: statusID },
		created_at: now,
		updated_at: now,
	};
	await store.saveReceipt(receipt);
	receipt.status = "dispatching";
	receipt.updated_at = new Date().toISOString();
	await store.saveReceipt(receipt);
	await session.click(control);

	const settled = await waitFor(
		() =>
			session.call<{ confirmed: boolean; on: boolean; label: string | null }>("action.result", {
				tweet_id: statusID,
				action,
				wanted,
			}),
		(state) => state.confirmed,
		signal,
		8000,
		`the ${action} to take effect`,
	).catch(() => null);
	if (!settled) {
		receipt.uncertainty_reason = "state_did_not_change";
		receipt.updated_at = new Date().toISOString();
		await store.saveReceipt(receipt);
		throw new CliError("delivery_uncertain", `The ${action} press produced no change on the page`, {
			hint: "Check the post in headed Chrome. Pressing again would undo it if it did land.",
			details: { request_id: key, receipt },
		});
	}
	const result: ActionResult = {
		action,
		status_id: statusID,
		confirmed: true,
		already: false,
		on: settled.on,
		label: settled.label,
		request_id: key,
	};
	receipt.status = "confirmed";
	receipt.updated_at = new Date().toISOString();
	receipt.result = result;
	await store.saveReceipt(receipt);
	await store.append(`post.${action}`, { request_id: key, status_id: statusID, on: wanted });
	return result;
}

// A repost is a menu, and only one item in it is the plain repost. Choosing the
// wrong one opens a quote composer, which would publish text nobody wrote.
async function repost(
	session: Session,
	input: Input,
	statusID: string,
	wanted: boolean,
	key: string,
	signal: AbortSignal,
	store: Store,
): Promise<ActionResult> {
	const control = await session.call<Point & { already: boolean }>("action.control", {
		tweet_id: statusID,
		action: "repost",
		wanted,
		token: randomUUID(),
	});
	if (control.already)
		return {
			action: "repost",
			status_id: statusID,
			confirmed: true,
			already: true,
			on: wanted,
			label: null,
			request_id: key,
		};
	await session.click(control);
	const menu = await waitFor(
		() => session.call<{ repost: Point | null; quote: Point | null }>("repost.menu"),
		(state) => !!state.repost || !!state.quote,
		signal,
		5000,
		"the repost menu",
	);
	if (!menu.repost)
		throw new CliError("selector_changed", "The repost menu offered no plain repost", {
			hint: "A quote item alone means this post cannot be reposted plainly. Nothing was pressed.",
			details: { menu: Object.keys(menu) },
		});
	const now = new Date().toISOString();
	const receipt: Receipt = {
		request_id: key,
		fingerprint: fingerprint("repost", statusID, wanted),
		operation: "post.repost",
		status: "dispatching",
		target: { tweet_id: statusID },
		created_at: now,
		updated_at: now,
	};
	await store.saveReceipt(receipt);
	await session.click(menu.repost);
	const settled = await waitFor(
		() =>
			session.call<{ confirmed: boolean; on: boolean; label: string | null }>("action.result", {
				tweet_id: statusID,
				action: "repost",
				wanted,
			}),
		(state) => state.confirmed,
		signal,
		8000,
		"the repost to take effect",
	).catch(() => null);
	if (!settled) {
		receipt.uncertainty_reason = "state_did_not_change";
		await store.saveReceipt(receipt);
		throw new CliError("delivery_uncertain", "The repost produced no change on the page", {
			details: { request_id: key, receipt },
		});
	}
	const result: ActionResult = {
		action: "repost",
		status_id: statusID,
		confirmed: true,
		already: false,
		on: settled.on,
		label: settled.label,
		request_id: key,
	};
	receipt.status = "confirmed";
	receipt.updated_at = new Date().toISOString();
	receipt.result = result;
	await store.saveReceipt(receipt);
	await store.append("post.repost", { request_id: key, status_id: statusID, on: wanted });
	void input;
	return result;
}

function fingerprint(action: Action, statusID: string, wanted: boolean): string {
	return `${action}:${statusID}:${wanted}`;
}
