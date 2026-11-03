import type { Event } from "../store.ts";

// What this account has already done to a post.
//
// A trending post stays trending for days. Without this, `auto suggest` proposes
// the same post every run: `seen` only knows what it has suggested, so a post
// that was already answered last week comes back at the top the moment its seen
// window expires — and the caller has no way to tell from the list.
//
// The record is the operation log, not a new file. It already holds every
// confirmed write with the status id, and a second store would be a second thing
// to keep in sync.
//
// Two levels, because two kinds of history mean different things:
//
//   replied  — a reply from this account is already under that post. Proposing
//              it again is proposing a duplicate, so it is excluded.
//   touched  — liked, reposted or bookmarked. That says the post was seen and
//              reacted to, not that there is nothing left to say, so it is
//              demoted rather than removed.
//
// Deleted replies still count as replied: the post was answered, and a caller
// who removed their reply most likely did not mean "propose it again tomorrow".

export type Engaged = "replied" | "touched";

const REPLIES = new Set(["comment.post", "comment.reply"]);
const TOUCHES = new Set(["post.like", "post.repost", "post.bookmark"]);

export interface History {
	post: Engaged;
	// When this account last did it, so a caller can judge how stale it is.
	at: string;
	operation: string;
}

export function historyOf(events: Event[]): Map<string, History> {
	const found = new Map<string, History>();
	for (const event of events) {
		const data = event.data as { status_id?: unknown } | null;
		const status = typeof data?.status_id === "string" ? data.status_id : null;
		if (!status) continue;
		const replied = REPLIES.has(event.operation);
		if (!replied && !TOUCHES.has(event.operation)) continue;
		const seen = found.get(status);
		// A reply outranks a like regardless of which came later: the post is
		// already answered, and that is the fact that matters here.
		if (seen?.post === "replied") continue;
		if (replied) {
			found.set(status, { post: "replied", at: event.at, operation: event.operation });
			continue;
		}
		if (!seen) found.set(status, { post: "touched", at: event.at, operation: event.operation });
	}
	return found;
}
