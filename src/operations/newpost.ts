import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ChromeManager, Point, Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import { quiet, type Reproduce } from "../progress.ts";
import type { Receipt, Store } from "../store.ts";
import { type ApprovalRequest, approvalRequest } from "./approval.ts";
import { waitFor } from "./navigation.ts";
import type { Input } from "./validate.ts";

// Posting a new tweet.
//
// This is the same composer as a reply, with the opposite check: a reply must
// have a quoted tweet and a new post must not. That symmetry is what keeps the
// two from being confused — the composer is one component, and the only thing
// that says which one it is, is whether a tweet is attached.
//
// It is a write, so it carries the same contract as a reply: a receipt before the
// press, a guard that re-checks the text at press time, and delivery reported only
// from page evidence.

export interface NewPostResult {
	request_id: string;
	confirmed: boolean;
	changed: boolean;
	result?: unknown;
}

export async function publish(
	input: Input,
	signal: AbortSignal,
	deps: { store: Store; chrome: ChromeManager; timeout: number; progress?: Reproduce; self: string | null },
): Promise<NewPostResult | ApprovalRequest> {
	const { store, chrome, timeout, self } = deps;
	const step = deps.progress ?? quiet;
	const text = input.text ?? "";
	const key = input.request_id ?? randomUUID();
	const fingerprint = createHash("sha256")
		.update(JSON.stringify({ action: "post.create", text }))
		.digest("hex");

	const receipts = await store.receipts();
	const existing = Object.hasOwn(receipts, key) ? receipts[key] : undefined;
	if (existing) {
		if (existing.fingerprint !== fingerprint)
			throw new CliError("idempotency_conflict", "The request ID belongs to different text", {
				details: { request_id: key },
			});
		if (existing.status === "confirmed")
			return { request_id: key, confirmed: true, changed: false, result: existing.result };
		if (existing.status !== "not_sent") throw uncertain(key, existing);
	}

	// The same first look a reply gets. A new post addresses nobody, so the
	// target block is empty; the text is the whole of what is being shown.
	const config = await store.config();
	if (config.review !== false && input.confirm !== true) {
		const repeated = (await store.events()).some(
			(event) => event.operation === "post.create" && (event.data as { text?: unknown })?.text === text,
		);
		return approvalRequest("post", input, text, null, null, key, repeated);
	}

	step("connecting", { operation: "post.create" });
	const session = await chrome.connect(signal, timeout);
	const args = { token: randomUUID(), text, tweet_id: "", target_handle: null, mode: "post" as const };
	let receipt: Receipt | undefined;
	let mayHaveDispatched = false;
	let confirmedSaved = false;
	let typed = false;
	try {
		step("opening_composer");
		await session.tab.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded" });
		const state = await waitFor(
			async () => {
				const current = await session.status();
				const composer = await session
					.call<{ open: boolean; text: string; quoted: unknown }>("reply.composer")
					.catch(() => ({ open: false, text: "", quoted: null }));
				return { ...current, composer };
			},
			(value) => value.login_required || value.verification_required || value.composer.open,
			signal,
			20_000,
			"the post composer",
		);
		if (state.login_required)
			throw new CliError("login_required", "X requires a signed-in session", { hint: "Run xx auth login." });
		if (state.verification_required)
			throw new CliError("verification_required", "X is asking for human verification", {
				hint: "Complete it in headed Chrome, then run auth status.",
			});
		if (state.composer.text.trim())
			throw new CliError("draft_conflict", "The composer already contains a draft", {
				hint: "The draft is preserved. Clear it by hand before posting through the tool.",
				details: { draft: state.composer.text.slice(0, 200) },
			});

		step("filling", { request_id: key });
		const prepared = await session.call<{ selector: string }>("reply.prepare", args);
		await session.tab.locator(prepared.selector).focus();
		typed = true;
		await session.tab.keyboard.insertText(text);
		await delay(250, undefined, { signal });
		const point = await session.call<Point>("reply.arm-write", args);

		const now = new Date().toISOString();
		receipt = {
			request_id: key,
			fingerprint,
			operation: "post.create",
			status: "dispatching",
			created_at: now,
			updated_at: now,
		};
		await store.saveReceipt(receipt);
		mayHaveDispatched = true;
		step("dispatching", { request_id: key });
		await session.click(point);

		step("confirming", { request_id: key });
		const settled = await settle(session, args, signal, self);
		if (settled.blocked && !settled.dispatched) {
			mayHaveDispatched = false;
			throw new CliError("identity_mismatch", "The post was blocked because the composer changed");
		}
		if (!settled.confirmed) {
			if (settled.uncertain_reason) {
				receipt.uncertainty_reason = settled.uncertain_reason;
				receipt.updated_at = new Date().toISOString();
				await store.saveReceipt(receipt);
			}
			throw uncertain(key, receipt, settled.uncertain_reason);
		}
		receipt.status = "confirmed";
		receipt.updated_at = new Date().toISOString();
		receipt.result = { evidence: settled.evidence ?? null, record: settled.record ?? null };
		await store.saveReceipt(receipt);
		confirmedSaved = true;
		await store.append("post.create", { request_id: key, text });
		step("confirmed", { request_id: key });
		return { request_id: key, confirmed: true, changed: true, result: receipt.result };
	} catch (error) {
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

function uncertain(key: string, receipt: Receipt | undefined, reason?: string, cause?: unknown) {
	return new CliError("delivery_uncertain", "The post may have been published; it was not repeated", {
		hint: [
			"Check that the page is not showing a login or verification gate.",
			`Then look at your profile, or run receipt get ${key}.`,
			"A second request with a new id is a second post, not a retry.",
		].join(" "),
		details: { request_id: key, receipt, ...(reason ? { reason } : {}), verify_before_retry: true },
		cause,
	});
}

interface Settled {
	confirmed?: boolean;
	blocked?: boolean;
	dispatched?: boolean;
	uncertain_reason?: string;
	evidence?: string;
	record?: unknown;
}

async function settle(
	session: Session,
	args: { token: string; text: string },
	signal: AbortSignal,
	self: string | null,
): Promise<Settled> {
	const deadline = Date.now() + 12_000;
	let previous: string | undefined;
	let last: Record<string, unknown> | undefined;
	while (Date.now() < deadline) {
		signal.throwIfAborted();
		const result = await session
			.call<Record<string, unknown>>("reply.result", { ...args, self })
			.catch(() => ({ confirmed: false, blocked: false, dispatched: true }));
		last = result;
		if (result.blocked === true && result.dispatched !== true) return result as Settled;
		const signature = JSON.stringify(result);
		if (result.confirmed === true && signature === previous) return result as Settled;
		previous = result.confirmed === true ? signature : undefined;
		await delay(250, undefined, { signal });
	}
	return (last ?? { confirmed: false, dispatched: true, uncertain_reason: "no_delivery_evidence" }) as Settled;
}

async function clearComposer(session: Session): Promise<void> {
	const editor = session.tab.locator('[data-testid^="tweetTextarea_"][contenteditable="true"]').first();
	if (!(await editor.count().catch(() => 0))) return;
	await editor.click({ timeout: 3000 }).catch(() => undefined);
	await session.tab.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
	await session.tab.keyboard.press("Backspace").catch(() => undefined);
	const left = await editor.innerText().catch(() => "");
	if (left.trim())
		throw new CliError("draft_conflict", "The composer still holds text after clearing", {
			hint: `Clear it by hand before retrying. It reads: ${left.slice(0, 120)}`,
		});
}
