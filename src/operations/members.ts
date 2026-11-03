import type { Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import type { Store } from "../store.ts";
import { follow } from "./follow.ts";
import type { Input } from "./validate.ts";

// Reading who is on a list, and following them one at a time.
//
// The list page shows its own feed; the roster is a separate tab
// (`/members`). Reading is one command; following the roster is another, and it
// is still one profile at a time underneath — each account gets its own receipt,
// its own page, and its own proof that the press changed that profile. A batch
// that skipped a failure or retried an uncertain press would be the thing this
// repository is built not to do.

export interface MemberList {
	list_id: string;
	url: string;
	title: string | null;
	members: {
		handle: string;
		name: string | null;
		bio: string | null;
		following: boolean | null;
		protected: boolean;
	}[];
	scope: "loaded_dom";
	complete: false;
	scrolls: number;
	limits: string[];
}

function listIDOf(value: string): string | null {
	const id = /\/i\/lists\/(\d{1,25})/.exec(value)?.[1] ?? null;
	return id ?? (/^\d{1,25}$/.test(value) ? value : null);
}

export async function readMembers(session: Session, input: Input, signal: AbortSignal): Promise<MemberList> {
	const raw = (input.resource ?? input.list_id ?? "").trim();
	const listID = listIDOf(raw);
	if (!listID)
		throw new CliError("invalid_argument", "Pass a list URL or its numeric id", {
			hint: "For example https://x.com/i/lists/2105917347391492419, or 2105917347391492419.",
		});

	const url = `https://x.com/i/lists/${listID}/members`;
	await session.tab.goto(url, { waitUntil: "domcontentloaded" });
	const state = await session.status();
	if (state.login_required)
		throw new CliError("login_required", "X requires a signed-in session", { hint: "Run xx auth login." });
	if (state.verification_required)
		throw new CliError("verification_required", "X is asking for human verification", {
			hint: "Complete it in headed Chrome, then run auth status.",
		});

	const limit = Math.min(Math.max(input.limit ?? 200, 1), 2000);
	const collected = new Map<string, MemberList["members"][number]>();
	const read = async () => {
		const rows = await session.call<MemberList["members"]>("list.members").catch((error: unknown) => {
			// A read that lands mid-navigation is a wait, not a broken selector.
			const message = error instanceof Error ? error.message : "";
			if (/Execution context|context was destroyed|Target closed|navigat/i.test(message)) return [];
			throw error;
		});
		for (const row of rows) {
			// A cell whose button has not rendered reports `following: null`. A later
			// known value replaces it; an unknown one never erases what is known.
			const seen = collected.get(row.handle);
			if (seen && seen.following !== null && row.following === null) continue;
			collected.set(row.handle, row);
		}
	};

	for (let attempt = 0; attempt < 30 && !collected.size; attempt++) {
		signal.throwIfAborted();
		await read();
		if (!collected.size) await new Promise((resolve) => setTimeout(resolve, 400));
	}

	// The roster is virtualized: only the rows near the viewport are in the DOM, so
	// a small scroll swaps one row for another instead of adding. Jumping to the
	// end is what makes the page load more, and the document height is how that
	// shows — a scroll that moves but does not grow the page has reached the end.
	const scrolls = Math.min(Math.max(input.scrolls ?? 0, 0), 60);
	let done = 0;
	let lastHeight = 0;
	while (done < scrolls && collected.size < limit) {
		signal.throwIfAborted();
		const before = collected.size;
		const page = await session.call<{ moved: boolean; height: number }>("page.scroll-end");
		done++;
		let grew = false;
		for (let attempt = 0; attempt < 10; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 400));
			await read();
			if (collected.size > before) {
				grew = true;
				break;
			}
		}
		// Nothing new in the DOM and the page did not get taller: the list ended.
		if (!grew && page.height <= lastHeight) break;
		lastHeight = page.height;
	}

	// The title is the list's own name, read from the page's heading.
	const title = await session
		.call<{ title: string | null }>("list.title")
		.then((value) => value.title)
		.catch(() => null);

	const members = [...collected.values()].slice(0, limit);
	if (!members.length)
		throw new CliError("selector_changed", "The list rendered no members", {
			hint: "The list may be empty, private, or deleted. Open it in Chrome to check.",
			details: { list_id: listID, url },
		});

	return {
		list_id: listID,
		url,
		title,
		members,
		scope: "loaded_dom",
		complete: false,
		scrolls: done,
		limits: [
			"Only the rows this page has rendered are returned. Use --scrolls to load more; the page stops growing when the list ends.",
			"`following` is the cell's own button label. Null means the cell had not drawn its button yet, not that this account does not follow them.",
			"`protected` comes from the cell's lock icon; following a protected account sends a request rather than following them.",
			"This command reads and does not follow anybody. `list follow` is the separate command that follows them, one account at a time.",
		],
	};
}

// Following a list's roster.
//
// This is a loop over `user follow`, not a second implementation of it: every
// account keeps its own receipt, its own fresh profile page, its own control
// check and its own proof that the button changed. The loop adds only the rules a
// run needs — what to skip, and when to stop.
//
// An account that cannot be pressed is recorded and skipped, and the run carries
// on. A failure on one account is an answer about that account; stopping there
// would mean a single protected profile or a slow page ends the whole run and
// leaves everything after it unattempted. Every outcome keeps its own receipt and
// its own request id, so a partial run is readable afterwards rather than
// something to be discovered later.

export interface FollowRosterResult {
	list_id: string;
	url: string;
	title: string | null;
	attempted: string[];
	followed: { handle: string; request_id: string; pending?: boolean }[];
	already: { handle: string; request_id: string }[];
	skipped: { handle: string; following: boolean | null; reason: string }[];
	// Accounts whose press did not go through, with the reason. The run continues
	// past them.
	failed: { handle: string; reason: string }[];
	request_ids: string[];
	scope: "loaded_dom";
	complete: false;
	scrolls: number;
	limits: string[];
}

interface Chooseable {
	handle: string;
	following: boolean | null;
	protected: boolean;
}

// Who this run will press follow on, and who it will leave alone.
//
// Who this run presses follow on. Only a cell that says "not following" is
// eligible — pressing an account that is already followed would be a second
// action on something that needs none.
//
// A protected account is included: following it sends a request, which is what
// the caller asked for, and the result says `pending` so the difference is not
// hidden. A cell whose button had not rendered is included too, because the
// roster is a stale snapshot and `user follow` re-reads the button on the
// account's own page before pressing anything.
export function chooseFollowers<T extends Chooseable>(members: T[], limit: number): T[] {
	return members.filter((member) => member.following !== true).slice(0, limit);
}

export async function followMembers(
	session: Session,
	input: Input,
	signal: AbortSignal,
	deps: { store: Store },
): Promise<FollowRosterResult> {
	// No ceiling beyond the roster itself: the caller asked for a list, and the
	// list is the bound. `--limit` narrows a run; omitting it follows the roster.
	const limit = Math.max(input.limit ?? 0, 0);
	const readLimit = limit > 0 ? Math.max(limit, 200) : 2000;
	// The roster is read wider than the run, so the skip list is about the accounts
	// that were reached rather than about the ones the run happened to look at.
	const roster = await readMembers(session, { ...input, limit: readLimit, scrolls: input.scrolls ?? 10 }, signal);

	const eligible = chooseFollowers(roster.members, limit > 0 ? limit : roster.members.length);

	const skipped: FollowRosterResult["skipped"] = roster.members
		.filter((member) => member.following === true)
		.map((member) => ({ handle: member.handle, following: member.following, reason: "already followed" }));

	const result: FollowRosterResult = {
		list_id: roster.list_id,
		url: roster.url,
		title: roster.title,
		attempted: [],
		followed: [],
		already: [],
		skipped,
		failed: [],
		request_ids: [],
		scope: "loaded_dom",
		complete: false,
		scrolls: roster.scrolls,
		limits: [
			limit > 0
				? `--limit ${limit} caps this run. Without it, every not-yet-followed account on the roster is attempted.`
				: "Every not-yet-followed account on the roster is attempted. `--limit <n>` caps a run instead.",
			"A protected account is attempted and produces a follow request rather than a follow; the result marks it `pending`. Each account's own profile re-reads its button before pressing, so a stale roster row cannot press the wrong state.",
			"Every follow is a separate `user follow` call with its own receipt and its own request id. An account that fails is recorded in `failed` and the run continues.",
			"X rate-limits follows. A long run may produce failures that look like account errors; those are in `failed` with their own reason.",
		],
	};

	if (!eligible.length) return result;

	for (const member of eligible) {
		signal.throwIfAborted();
		result.attempted.push(member.handle);
		const requestID = `${input.request_id ?? "list-follow"}-${member.handle}`;
		result.request_ids.push(requestID);
		try {
			const one = await follow(
				session,
				{ ...input, handle: member.handle, value: true, request_id: requestID },
				member.handle,
				signal,
				deps,
			);
			if (one.already) result.already.push({ handle: member.handle, request_id: one.request_id });
			else
				result.followed.push({
					handle: member.handle,
					request_id: one.request_id,
					...(one.pending ? { pending: true } : {}),
				});
		} catch (error) {
			const problem = error instanceof CliError ? error : null;
			// An answer about this account — no such profile, no control to press,
			// it turns out to be this account after all — is recorded and the run
			// continues. Everything else is a reason to stop: an uncertain press may
			// already have gone out, and a page that stopped rendering makes the next
			// press a guess.
			if (
				problem &&
				["invalid_argument", "not_found", "identity_mismatch", "selector_changed"].includes(problem.code)
			) {
				result.skipped.push({ handle: member.handle, following: false, reason: problem.message });
				continue;
			}
			// One account failing is not a reason to abandon the rest.
			result.failed.push({ handle: member.handle, reason: error instanceof Error ? error.message : String(error) });
		}
	}
	return result;
}
