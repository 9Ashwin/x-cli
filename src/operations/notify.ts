import type { Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import type { Input } from "./validate.ts";

// Reading the notifications page as a bounded list.
//
// It is one page, so the shape is simple: navigate, wait for rows, optionally
// scroll for more. What it does not do is open anything — a notification row has
// no post id, and following one would mean driving the page for each entry, which
// is a different command with a different cost.

export interface NoticeEntry {
	kind: string;
	actors: string[];
	text: string;
	at: string | null;
	unread: boolean;
}

// The two tabs are links, not a local filter: "All" is /notifications and
// "Mentions" is /notifications/mentions. Clicking a tab by its label meant
// matching a localized name, and pressing the wrong one silently returned the
// same list.
export async function readNotificationsPage(session: Session, input: Input, signal: AbortSignal) {
	const path = input.tab === "mentions" ? "/notifications/mentions" : "/notifications";
	await session.tab.goto(`https://x.com${path}`, { waitUntil: "domcontentloaded" });
	const state = await session.status();
	if (state.login_required)
		throw new CliError("login_required", "X requires a signed-in session", { hint: "Run xx auth login." });
	if (state.verification_required)
		throw new CliError("verification_required", "X is asking for human verification", {
			hint: "Complete it in headed Chrome, then run auth status.",
		});
	const limit = Math.min(Math.max(input.limit ?? 30, 1), 200);
	const collected = new Map<string, NoticeEntry>();
	const read = async () => {
		for (const entry of await session.call<NoticeEntry[]>("notification.list")) collected.set(entry.text, entry);
	};
	// The list renders a few seconds after the shell.
	for (let attempt = 0; attempt < 30 && !collected.size; attempt++) {
		signal.throwIfAborted();
		await read();
		if (!collected.size) await new Promise((resolve) => setTimeout(resolve, 400));
	}
	const scrolls = Math.min(Math.max(input.scrolls ?? 0, 0), 20);
	let done = 0;
	while (done < scrolls && collected.size < limit) {
		signal.throwIfAborted();
		const before = collected.size;
		await session.call("conversation.scroll", { pixels: 1200 });
		done++;
		let grew = false;
		for (let attempt = 0; attempt < 8; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 400));
			await read();
			if (collected.size > before) {
				grew = true;
				break;
			}
		}
		if (!grew) break;
	}
	return {
		items: [...collected.values()].slice(0, limit),
		scope: "loaded_dom",
		complete: false,
		scrolls: done,
		limits: [
			"Only the rows this page has rendered are returned.",
			"Rows carry the actor's handle but not the post id, so a notification does not say which post it is about.",
			"`unread` is only true when the page states it; a row that is unread but unmarked reads as false.",
			"`kind: other` means the row's sentence matched no known wording, including because it is in a locale this reader does not know.",
		],
	};
}
