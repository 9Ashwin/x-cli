import { setTimeout as delay } from "node:timers/promises";
import type { Session, Snapshot } from "../browser.ts";
import { CliError } from "../errors.ts";

// Opening a status. Navigation never writes.

const BASE = "https://x.com";

export function permalink(id: string, handle?: string | null): string {
	// X resolves /i/web/status/<id> without knowing the author, and redirects to
	// the canonical /handle/status/<id>. Using it when the handle is unknown
	// avoids guessing a name from a URL the caller may have copied oddly.
	return handle ? `${BASE}/${handle}/status/${id}` : `${BASE}/i/web/status/${id}`;
}

export async function waitFor<T>(
	read: () => Promise<T>,
	done: (value: T) => boolean,
	signal: AbortSignal,
	timeout = 15_000,
	label = "the page",
): Promise<T> {
	const deadline = Date.now() + timeout;
	let last: T | undefined;
	while (Date.now() < deadline) {
		signal.throwIfAborted();
		try {
			last = await read();
		} catch (error) {
			// A read during a navigation can fail because the execution context was
			// destroyed. That is a wait, not a verdict on the page.
			const message = error instanceof Error ? error.message : "";
			if (!/Execution context|context was destroyed|Target closed|navigat/i.test(message)) throw error;
			last = undefined;
		}
		if (last !== undefined && done(last)) return last;
		await delay(250, undefined, { signal });
	}
	throw new CliError("selector_changed", `Timed out waiting for ${label}`, { details: last });
}

export async function openStatus(
	session: Session,
	id: string,
	signal: AbortSignal,
	handle?: string | null,
): Promise<Snapshot> {
	await session.tab.goto(permalink(id, handle), { waitUntil: "domcontentloaded" });
	const state = await waitFor(
		() => session.status(),
		(value) => value.page_kind === "login" || value.page_kind === "verify" || !!value.status?.id,
		signal,
		20_000,
		"the status page",
	);
	if (state.login_required)
		throw new CliError("login_required", "X requires a signed-in session", { hint: "Run xx auth login." });
	if (state.verification_required)
		throw new CliError("verification_required", "X is asking for human verification", {
			hint: "Complete it in headed Chrome, then run auth status.",
		});
	if (state.status?.id !== id)
		throw new CliError("identity_mismatch", "The open status is not the requested one", {
			details: { requested: id, open: state.status },
		});
	// The conversation renders after the root tweet. Waiting for the article
	// rather than for a timer is what makes the following read meaningful.
	await waitFor(
		() => session.call<unknown[]>("tweet.list"),
		(rows) => rows.length > 0,
		signal,
		15_000,
		"the conversation",
	).catch(async () => {
		const state = await session.status();
		if (state.login_required)
			throw new CliError("login_required", "X requires a signed-in session", { hint: "Run xx auth login." });
		if (state.verification_required)
			throw new CliError("verification_required", "X is asking for human verification", {
				hint: "Complete it in headed Chrome, then run auth status.",
			});
		throw new CliError("selector_changed", "The conversation rendered no tweets", {
			hint: "The status may be deleted, protected, or the account is signed out. Check status in headed Chrome.",
			details: state,
		});
	});
	return session.status();
}

export async function requireSignedIn(session: Session): Promise<Snapshot> {
	const state = await session.status();
	if (state.verification_required)
		throw new CliError("verification_required", "X is asking for human verification", {
			hint: "Complete it in headed Chrome, then run auth status.",
		});
	if (state.login_required)
		throw new CliError("login_required", "X requires a signed-in session", { hint: "Run xx auth login." });
	return state;
}
