import type { Store } from "../store.ts";

// What this tool has already put in front of its caller.
//
// A scheduled run of `auto suggest` reads the same timeline and the same board
// every time. Without a record of what was already suggested, the second run
// returns the first run's list and the caller either repeats the work or replies
// to the same post twice — and the second one is the costly mistake.
//
// So every suggestion is remembered by post id, together with when it was first
// shown. A candidate seen recently is reported but ranked last, not deleted: the
// caller still needs to know the post exists, and "everything here is new" is
// often false. Nothing about this decides what to reply to. It only stops the
// same post from being a fresh discovery twice.
//
// The record is in the state directory, not in the repository: it is about this
// account's history, and it is not something to publish alongside the tool.

const FILE = "seen.json";
const DAY = 24 * 60 * 60 * 1000;

export type Seen = Record<string, { first_shown: string; last_shown: string; times: number }>;

export async function readSeen(store: Store): Promise<Seen> {
	const value = await store.read<Seen>(FILE, {});
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const clean: Seen = {};
	for (const [id, entry] of Object.entries(value)) {
		if (!entry || typeof entry !== "object") continue;
		if (typeof entry.first_shown !== "string" || Number.isNaN(Date.parse(entry.first_shown))) continue;
		clean[id] = {
			first_shown: entry.first_shown,
			last_shown: typeof entry.last_shown === "string" ? entry.last_shown : entry.first_shown,
			times: typeof entry.times === "number" ? entry.times : 1,
		};
	}
	return clean;
}

export interface SeenState {
	// Shown before, inside the window the command was asked to respect.
	seen_recently: boolean;
	// Shown before at all. A post first seen a month ago and never acted on is a
	// different thing from one shown an hour ago, and both are different from new.
	seen_before: boolean;
	first_shown: string | null;
	times: number;
}

export function stateOf(seen: Seen, id: string, withinDays: number): SeenState {
	const entry = Object.hasOwn(seen, id) ? seen[id] : undefined;
	if (!entry) return { seen_recently: false, seen_before: false, first_shown: null, times: 0 };
	const last = Date.parse(entry.last_shown);
	const recent = withinDays > 0 && Number.isFinite(last) && Date.now() - last < withinDays * DAY;
	return { seen_recently: recent, seen_before: true, first_shown: entry.first_shown, times: entry.times };
}

export async function remember(store: Store, ids: string[]): Promise<void> {
	if (!ids.length) return;
	const seen = await readSeen(store);
	const now = new Date().toISOString();
	for (const id of ids) {
		const entry = Object.hasOwn(seen, id) ? seen[id] : undefined;
		seen[id] = entry
			? { first_shown: entry.first_shown, last_shown: now, times: entry.times + 1 }
			: { first_shown: now, last_shown: now, times: 1 };
	}
	// The file is small and read whole; old entries are dropped rather than grown
	// forever. A post older than the retention window cannot come back from the
	// timeline anyway.
	const cutoff = Date.now() - 90 * DAY;
	for (const [id, entry] of Object.entries(seen)) {
		const last = Date.parse(entry.last_shown);
		if (Number.isFinite(last) && last < cutoff) delete seen[id];
	}
	// A cap as well as a cutoff: a busy account can clear 90 days' worth.
	const kept = Object.entries(seen)
		.sort((left, right) => Date.parse(right[1].last_shown) - Date.parse(left[1].last_shown))
		.slice(0, 5000);
	await store.write(FILE, Object.fromEntries(kept));
}
