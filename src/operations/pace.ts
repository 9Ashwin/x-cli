import type { Event } from "../store.ts";

// How much this account has been posting lately.
//
// The point is not to enforce a limit — X's own limits are not published, and a
// number this tool invented would be wrong in both directions: too low and it
// refuses something the account could do, too high and it is decoration. What it
// can know is its own history, and the useful thing to do with that is put it in
// front of the caller before a send, once it looks like a run of replies.
//
// So this never blocks. Above a threshold, the send stops and asks. The caller
// answers by repeating the command with --confirm, or by deciding not to.

export interface Pace {
	// Successful sends inside the window, counted from the local event log.
	recent: number;
	window_minutes: number;
	// When the oldest counted send happened, so a caller can see the actual span.
	since: string | null;
	// The threshold this window was measured against.
	threshold: number;
	over: boolean;
}

export const WINDOW_MINUTES = 30;
export const THRESHOLD = 8;

const SENDS = new Set(["comment.post", "comment.reply"]);

// Only confirmed sends are counted. An attempt that failed, was refused, or came
// back uncertain is not a reply the account made — counting it would slow down a
// caller for something that never went out.
export function measurePace(events: Event[], now = new Date()): Pace {
	const cutoff = now.getTime() - WINDOW_MINUTES * 60_000;
	const recent = events.filter((event) => {
		if (!SENDS.has(event.operation)) return false;
		const at = Date.parse(event.at);
		return Number.isFinite(at) && at >= cutoff && at <= now.getTime();
	});
	return {
		recent: recent.length,
		window_minutes: WINDOW_MINUTES,
		since: recent[0]?.at ?? null,
		threshold: THRESHOLD,
		over: recent.length >= THRESHOLD,
	};
}

// What the caller is told instead of a send. It states the count and the window,
// because "slow down" without the evidence is the kind of message that gets
// ignored, and names the one flag that resumes.
export function pacePrompt(pace: Pace, kind: "post" | "reply") {
	return {
		sent: false,
		needs_confirmation: true,
		pace,
		question:
			`This account has made ${pace.recent} ${kind === "post" ? "posts" : "replies"} in the last ${pace.window_minutes} minutes ` +
			`(the prompt appears at ${pace.threshold}).`,
		next: "If this is intended, run the same command with --confirm. Nothing has been sent.",
		limits: [
			"Counted from this machine's own confirmed sends. Replies made elsewhere, or from another copy of the tool, are not included.",
			"These are not X's limits, which are not published. This is a pause for the caller to look at, not a guarantee that a send will succeed.",
		],
	};
}
