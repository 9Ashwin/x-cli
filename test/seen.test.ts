import assert from "node:assert/strict";
import test from "node:test";
import { type Seen, stateOf } from "../src/operations/seen.ts";

// The seen record is what stops a scheduled `auto suggest` from proposing the
// same post every time it runs. These pin the three states it has to tell apart,
// because getting them mixed up is silent: a wrong answer changes the order of a
// list rather than producing an error anybody would notice.

const now = Date.now();
const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test("an id never seen is new", () => {
	const state = stateOf({}, "123", 7);
	assert.equal(state.seen_before, false);
	assert.equal(state.seen_recently, false);
	assert.equal(state.first_shown, null);
	assert.equal(state.times, 0);
});

test("a post shown an hour ago is recent but a month old one is not", () => {
	const seen: Seen = {
		"123": { first_shown: iso(HOUR), last_shown: iso(HOUR), times: 1 },
		"456": { first_shown: iso(30 * DAY), last_shown: iso(30 * DAY), times: 2 },
	};
	assert.equal(stateOf(seen, "123", 7).seen_recently, true);
	// Still seen before — it just is not recent. Those are different facts, and a
	// caller deciding whether to re-read a month-old post needs both.
	assert.equal(stateOf(seen, "456", 7).seen_before, true);
	assert.equal(stateOf(seen, "456", 7).seen_recently, false);
	assert.equal(stateOf(seen, "456", 7).times, 2);
});

test("a window of zero disables the recency check without forgetting history", () => {
	const seen: Seen = { "123": { first_shown: iso(HOUR), last_shown: iso(HOUR), times: 1 } };
	assert.equal(stateOf(seen, "123", 0).seen_recently, false);
	assert.equal(stateOf(seen, "123", 0).seen_before, true);
});

test("recency is measured from the last showing, not the first", () => {
	// Shown a month ago and again an hour ago: it is recent. Reading
	// `first_shown` here would call it stale and repromote a post the caller just
	// looked at.
	const seen: Seen = { "123": { first_shown: iso(30 * DAY), last_shown: iso(HOUR), times: 4 } };
	assert.equal(stateOf(seen, "123", 7).seen_recently, true);
});

test("an unparseable last_shown is not treated as recent", () => {
	// The reader repairs entries on load, but a value can still reach here through
	// a hand-edited file. "Cannot tell" must not become "seen just now".
	const seen = { "123": { first_shown: iso(HOUR), last_shown: "not a date", times: 1 } } as Seen;
	assert.equal(stateOf(seen, "123", 7).seen_recently, false);
	assert.equal(stateOf(seen, "123", 7).seen_before, true);
});
