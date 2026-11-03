import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Point, Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import type { Receipt, Store } from "../store.ts";
import { waitFor } from "./navigation.ts";
import type { Input } from "./validate.ts";

// Following and unfollowing one account.
//
// The button carries the target's numeric id, so both sides can be checked: the
// profile belongs to the handle asked for, and the button belongs to that same
// account. A profile page also lists follow buttons for suggested accounts in the
// sidebar, which is why the handle in the aria-label is part of the match and not
// decoration.

export interface FollowResult {
	handle: string;
	user_id: string | null;
	following: boolean;
	already: boolean;
	request_id: string;
	pending?: boolean;
}

export async function follow(
	session: Session,
	input: Input,
	handle: string,
	signal: AbortSignal,
	deps: { store: Store },
): Promise<FollowResult> {
	const wanted = input.value !== false;
	const key = input.request_id ?? randomUUID();
	const { store } = deps;

	const receipts = await store.receipts();
	const existing = Object.hasOwn(receipts, key) ? receipts[key] : undefined;
	if (existing) {
		if (existing.fingerprint !== `follow:${handle}:${wanted}`)
			throw new CliError("idempotency_conflict", "The request ID belongs to different input", {
				details: { request_id: key },
			});
		if (existing.status === "confirmed") return { ...(existing.result as FollowResult), request_id: key };
		if (existing.status !== "not_sent")
			throw new CliError("delivery_uncertain", "That follow may already have been applied; it was not repeated", {
				details: { request_id: key, receipt: existing },
			});
	}

	await session.tab.goto(`https://x.com/${handle}`, { waitUntil: "domcontentloaded" });
	const state = await waitFor(
		() => session.status(),
		(value) => value.login_required || value.verification_required || value.page_kind === "profile",
		signal,
		20_000,
		"the profile",
	);
	if (state.login_required)
		throw new CliError("login_required", "X requires a signed-in session", { hint: "Run x-cli auth login." });
	if (state.verification_required)
		throw new CliError("verification_required", "X is asking for human verification", {
			hint: "Complete it in headed Chrome, then run auth status.",
		});
	// The page has to render its header before the button exists, and the handle in
	// the URL can be a redirect target rather than the account asked for.
	// account() returns null on a page that has not rendered the nav yet; treating
	// that as "no account" and continuing is right, but reading through the null
	// crashed the command before it could look at the button.
	const current = await session.call<{ handle: string | null } | null>("account");
	if (current?.handle?.toLowerCase() === handle.toLowerCase())
		throw new CliError("invalid_argument", "That is this account", { hint: "You cannot follow yourself." });

	const token = randomUUID();
	let control: (Point & { already: boolean }) | null = null;
	for (let attempt = 0; attempt < 20 && !control; attempt++) {
		control = await session
			.call<Point & { already: boolean }>("follow.control", { handle, wanted, token })
			.catch((error: unknown) => {
				if (error instanceof CliError && error.code === "selector_changed") return null;
				throw error;
			});
		if (!control) await delay(400, undefined, { signal });
	}
	if (!control)
		throw new CliError("selector_changed", "This profile has no follow control", {
			hint: "The account may be your own, suspended, or the page has not rendered.",
			details: { handle },
		});
	if (control.already) {
		const now = await session.call<{ following: boolean }>("follow.state", { handle });
		return {
			handle,
			user_id: null,
			following: now.following,
			already: true,
			request_id: key,
		};
	}

	const now = new Date().toISOString();
	const receipt: Receipt = {
		request_id: key,
		fingerprint: `follow:${handle}:${wanted}`,
		operation: wanted ? "user.follow" : "user.unfollow",
		status: "dispatching",
		target: {},
		created_at: now,
		updated_at: now,
	};
	await store.saveReceipt(receipt);
	await session.click(control);

	// A protected account answers with a confirmation dialog rather than applying
	// the follow. That is a different outcome, and it is reported rather than
	// retried: the request is pending until they accept.
	const dialog = await session.call<{ open: boolean; text: string }>("follow.pending");
	if (dialog.open) {
		const confirm = await session.call<Point>("follow.pending-confirm", { token: randomUUID() });
		await session.click(confirm);
	}

	const settled = await waitFor(
		() =>
			session.call<{ confirmed: boolean; pending: boolean; following: boolean }>("follow.result", { handle, wanted }),
		(value) => value.confirmed || value.pending,
		signal,
		10_000,
		"the follow to take effect",
	).catch(() => null);
	if (!settled) {
		receipt.uncertainty_reason = "state_did_not_change";
		receipt.updated_at = new Date().toISOString();
		await store.saveReceipt(receipt);
		throw new CliError("delivery_uncertain", "The follow press produced no change on the page", {
			hint: "Check the profile in headed Chrome. Pressing again would unfollow if it did land.",
			details: { request_id: key, receipt },
		});
	}
	const result: FollowResult = {
		handle,
		user_id: null,
		following: settled.following,
		already: false,
		request_id: key,
		...(settled.pending ? { pending: true } : {}),
	};
	receipt.status = "confirmed";
	receipt.updated_at = new Date().toISOString();
	receipt.result = result;
	await store.saveReceipt(receipt);
	await store.append(wanted ? "user.follow" : "user.unfollow", { request_id: key, handle, pending: settled.pending });
	return result;
}
