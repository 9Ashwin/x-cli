import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ChromeManager, Point, Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import { quiet, type Reproduce } from "../progress.ts";
import type { Receipt, Store } from "../store.ts";
import type { TweetRow } from "./comments.ts";
import { openStatus, waitFor } from "./navigation.ts";
import { authorOf, type Input } from "./validate.ts";

// Sending a reply.
//
// A send is not a click that happened to work. It leaves a receipt before the
// click can dispatch, it proves the reply target from the composer's own state,
// and it reports delivery only from evidence the page produced. A send with no
// evidence is `delivery_uncertain`, which says "this may be out" — and is never
// retried automatically, because a retry is a second reply.

export interface WriteResult {
	confirmed: boolean;
	blocked?: boolean;
	dispatched?: boolean;
	uncertain_reason?: string;
	evidence?: "toast" | "new_row";
	record?: unknown;
}

interface Deps {
	store: Store;
	chrome: ChromeManager;
	timeout: number;
	progress?: Reproduce;
	// The signed-in handle. Delivery proof needs it: a new row only counts when the
	// article says this account wrote it.
	self: string | null;
}

function uncertain(key: string, receipt: Receipt | undefined, reason?: string, cause?: unknown) {
	return new CliError("delivery_uncertain", "The reply may have reached X; it was not repeated", {
		hint: [
			"Check that the page is not showing a login or verification gate — a read under one says nothing about whether this landed.",
			`Then read the conversation and look for your text, or run receipt get ${key}.`,
			"A second request with a new id is a second reply, not a retry.",
		].join(" "),
		details: { request_id: key, receipt, ...(reason ? { reason } : {}), verify_before_retry: true },
		cause,
	});
}

// Which tweet the reply is addressed to, and what identity the page must agree
// with before the post button is pressed. The handle is carried because the
// modal states it, and a modal that says a different account is a refusal.
async function resolveTarget(session: Session, input: Input, rootID: string) {
	const targetID = input.comment_id ? (statusIDOf(input.comment_id) ?? input.comment_id) : rootID;
	const rows = await session.call<TweetRow[]>("tweet.list");
	const root = rows.find((row) => row.id === rootID) ?? null;
	const target = rows.find((row) => row.id === targetID) ?? null;
	if (!target)
		throw new CliError("not_found", "The tweet being replied to is not loaded", {
			hint: "Open the conversation, scroll until the tweet is visible, then retry.",
			details: { target: targetID, loaded: rows.length },
		});
	if (!target.handle)
		throw new CliError("identity_mismatch", "The reply target has no readable handle", {
			hint: "A reply is addressed by handle on the page; refusing rather than guessing which account it is.",
			details: { target: targetID },
		});
	// A root tweet's reply reaches its author. A reply's reply reaches that
	// reply's author — which is the work's author only when the reply was theirs.
	const handle = target.handle;
	return { target: { ...target, handle }, root, rows, handle };
}

export async function send(operation: string, input: Input, signal: AbortSignal, deps: Deps): Promise<unknown> {
	const { store, chrome, timeout, self } = deps;
	const step = deps.progress ?? quiet;
	const text = input.text ?? "";
	const rootID = statusIDOf(input.status_id ?? input.resource) ?? "";
	const targetID = input.comment_id ? (statusIDOf(input.comment_id) ?? input.comment_id) : rootID;
	const payload = {
		action: operation,
		status_id: rootID,
		comment_id: input.comment_id ?? null,
		text,
	};
	const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
	const key = input.request_id ?? randomUUID();
	const receipts = await store.receipts();
	const existing = Object.hasOwn(receipts, key) ? receipts[key] : undefined;
	if (existing) {
		if (existing.fingerprint !== fingerprint)
			throw new CliError("idempotency_conflict", "The request ID belongs to different input", {
				details: { request_id: key },
			});
		if (existing.status === "confirmed")
			return { request_id: key, confirmed: true, replayed: true, result: existing.result };
		if (existing.status !== "not_sent") throw uncertain(key, existing);
	}

	step("connecting", { operation });
	const session = await chrome.connect(signal, timeout);
	const args = { token: randomUUID(), text, tweet_id: targetID };
	let receipt: Receipt | undefined;
	let mayHaveDispatched = false;
	let confirmedSaved = false;
	let typed = false;
	try {
		step("opening_status", { status_id: rootID });
		await openStatus(session, rootID, signal, authorOf(input));
		const { target } = await resolveTarget(session, input, rootID);

		// A composer already open would be someone else's draft; the page adapter
		// refuses to overwrite it, so it is reported before anything is typed.
		const open = await session.call<{ open: boolean; text: string }>("reply.composer");
		if (open.open && open.text.trim())
			throw new CliError("draft_conflict", "A reply composer is open with a draft", {
				hint: "The draft belongs to whoever wrote it. Clear or send it by hand, then retry.",
				details: { draft: open.text.slice(0, 200) },
			});

		step("opening_reply", { tweet_id: targetID, handle: target.handle });
		// A plain post composer is open on the status page before the reply control
		// is pressed, so "a composer exists" is true either way and would return
		// immediately. What is waited for is a composer that names a quoted tweet,
		// which only the reply modal has.
		//
		// One retry: the control is rendered by the server before the page's own
		// handlers are attached, so a press that arrives early does nothing at all.
		// Retrying the same button is safe — pressing a reply control only opens a
		// composer, and nothing is typed yet.
		const opened = async () => {
			const control = await session.call<Point>("reply.control", { tweet_id: targetID, token: args.token });
			await session.click(control);
			return waitFor(
				() => session.call<{ quoted: unknown }>("reply.composer"),
				(state) => !!state.quoted,
				signal,
				8_000,
				"the reply composer",
			).then(
				() => true,
				() => false,
			);
		};
		if (!(await opened())) {
			await delay(1200, undefined, { signal });
			if (!(await opened()))
				throw new CliError("selector_changed", "The reply composer did not open", {
					hint: "The reply control was pressed twice and no reply dialog appeared. Check the page in headed Chrome.",
					details: await session.call("reply.composer"),
				});
		}

		// A reply modal and a new-post modal are the same dialog. What makes the
		// open one a reply is the quoted tweet inside it, so that is what is
		// checked — pressing post in a plain composer would publish to everyone.
		const openComposer = await session.call<{
			quoted: { text: string; handle: string | null } | null;
			modal: boolean;
		}>("reply.composer");
		if (!openComposer.quoted)
			throw new CliError("identity_mismatch", "The composer is not in reply mode", {
				hint: "The reply control opened a plain post composer, which would be public to everyone. Nothing was typed.",
			});
		if (openComposer.quoted.handle && openComposer.quoted.handle.toLowerCase() !== target.handle.toLowerCase())
			throw new CliError("identity_mismatch", "The composer replies to a different account", {
				details: { expected: target.handle, shown: openComposer.quoted.handle },
			});

		step("filling", { request_id: key });
		const prepared = await session.call<{ selector: string }>("reply.prepare", {
			...args,
			target_handle: target.handle,
			target_text: target.text,
		});
		await session.tab.locator(prepared.selector).focus();
		typed = true;
		await session.tab.keyboard.insertText(text);
		// The page may reformat while the text settles (autolink, mentions). The
		// guard below reads what the page holds, so a reformat that changes the
		// text is a refusal rather than a silent edit.
		await delay(250, undefined, { signal });

		const point = await session.call<Point>("reply.arm-write", {
			...args,
			target_handle: target.handle,
			target_text: target.text,
		});

		const now = new Date().toISOString();
		receipt = {
			request_id: key,
			fingerprint,
			operation,
			status: "prepared",
			target: { tweet_id: rootID, ...(input.comment_id ? { comment_id: targetID } : {}) },
			created_at: now,
			updated_at: now,
		};
		await store.saveReceipt(receipt);
		receipt.status = "dispatching";
		receipt.updated_at = new Date().toISOString();
		await store.saveReceipt(receipt);
		mayHaveDispatched = true;
		step("dispatching", { request_id: key });
		await session.click(point);

		step("confirming", { request_id: key });
		const outcome = await settle(session, { ...args, tweet_id: rootID }, signal, self);
		if (outcome.blocked && !outcome.dispatched) {
			mayHaveDispatched = false;
			const reason = await session.call<string | null>("reply.blocked").catch(() => null);
			throw new CliError("identity_mismatch", "The post was blocked because the composer changed", {
				hint: reason ? `The page refused the press: ${reason}` : "",
			});
		}
		if (!outcome.confirmed) {
			if (outcome.uncertain_reason) {
				receipt.uncertainty_reason = outcome.uncertain_reason;
				receipt.updated_at = new Date().toISOString();
				await store.saveReceipt(receipt);
			}
			throw uncertain(key, receipt, outcome.uncertain_reason);
		}
		receipt.status = "confirmed";
		receipt.updated_at = new Date().toISOString();
		receipt.result = {
			evidence: outcome.evidence ?? null,
			...(outcome.record ? { record: outcome.record } : {}),
			reply_to: { tweet_id: targetID, handle: target.handle },
		};
		await store.saveReceipt(receipt);
		confirmedSaved = true;
		await store.append(operation, { request_id: key, ...payload, result: receipt.result });
		step("confirmed", { request_id: key });
		return { request_id: key, confirmed: true, changed: true, result: receipt.result };
	} catch (error) {
		// Nothing was sent, so this attempt's typing is residue. Leaving it makes
		// the composer look like an owner's draft to every later command.
		if (typed && !mayHaveDispatched) await clearComposer(session);
		if (receipt && !mayHaveDispatched) {
			receipt.status = "not_sent";
			receipt.updated_at = new Date().toISOString();
			await store.saveReceipt(receipt);
		}
		if (mayHaveDispatched && !confirmedSaved) {
			if (error instanceof CliError && error.code === "delivery_uncertain") throw error;
			throw uncertain(key, receipt, undefined, error);
		}
		throw error;
	} finally {
		await session.call("cleanup").catch(() => undefined);
		await session.close();
	}
}

// The accept form is what a caller types when they mean an id. Accepting a full
// status URL here too keeps a copied link usable as a reply target.
function statusIDOf(value: string | undefined): string | null {
	if (!value) return null;
	const text = value.trim();
	if (/^\d{1,25}$/.test(text)) return text;
	return /\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/(\d{1,25})/.exec(text)?.[1] ?? null;
}

// Confirmation requires the same answer twice, so one optimistic DOM frame is
// not mistaken for a delivered reply. The composer closing and reappearing in a
// re-render is exactly the kind of single frame this guards against.
async function settle(
	session: Session,
	args: { token: string; text: string; tweet_id: string },
	signal: AbortSignal,
	self: string | null,
): Promise<WriteResult & { confirmed?: boolean }> {
	const deadline = Date.now() + 12_000;
	let previous: string | undefined;
	let last: WriteResult | undefined;
	while (Date.now() < deadline) {
		signal.throwIfAborted();
		// `self` lets the page check that the new row's author is this account. Without
		// it a row by somebody else carrying the same words would confirm the send.
		const result = await session.call<WriteResult>("reply.result", { ...args, self });
		last = result;
		if (result.blocked && !result.dispatched) return result;
		const signature = JSON.stringify(result);
		if (result.confirmed && signature === previous) return result;
		previous = result.confirmed ? signature : undefined;
		await delay(250, undefined, { signal });
	}
	return last ?? { confirmed: false, dispatched: true, uncertain_reason: "no_delivery_evidence" };
}

// The composer is a Draft.js-backed editor; the platform's own select-all is
// used because the browser's select-all command does not reach its state on
// macOS the way a person's keyboard does.
async function clearComposer(session: Session): Promise<void> {
	// The prefix alone matches the label and container divs around the editor;
	// only the contenteditable one holds the text.
	const editor = session.tab.locator('[data-testid^="tweetTextarea_"][contenteditable="true"]').first();
	if (!(await editor.count().catch(() => 0))) return;
	await editor.click({ timeout: 3000 }).catch(() => undefined);
	await session.tab.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
	await session.tab.keyboard.press("Backspace").catch(() => undefined);
	const left = await editor.innerText().catch(() => "");
	if (left.trim()) {
		// Saying so is more useful than pretending the box is empty: the draft is
		// now in the way of the next attempt, and the owner has to see it.
		throw new CliError("draft_conflict", "The composer still holds text after clearing", {
			hint: `Clear it by hand before retrying. It reads: ${left.slice(0, 120)}`,
		});
	}
}
