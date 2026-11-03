import assert from "node:assert/strict";
import test from "node:test";
import { measurePace, pacePrompt, THRESHOLD, WINDOW_MINUTES } from "../src/operations/pace.ts";
import type { Event } from "../src/store.ts";

// The pace check is a prompt, never a gate. These pin the two things that make
// it useful rather than annoying: it counts only what this account actually
// sent, and it stops asking once the caller has looked.

function send(at: Date, operation = "comment.post"): Event {
	return { id: `e-${at.getTime()}`, at: at.toISOString(), operation, data: {} };
}

const NOW = new Date("2026-11-03T10:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

test("nothing recent is under the threshold", () => {
	const pace = measurePace([], NOW);
	assert.equal(pace.recent, 0);
	assert.equal(pace.over, false);
});

test("sends inside the window are counted", () => {
	const events = Array.from({ length: THRESHOLD }, (_, index) => send(minutesAgo(index + 1)));
	const pace = measurePace(events, NOW);
	assert.equal(pace.recent, THRESHOLD);
	assert.equal(pace.over, true);
});

test("a send older than the window is not counted", () => {
	const events = Array.from({ length: THRESHOLD }, (_, index) => send(minutesAgo(WINDOW_MINUTES + 5 + index)));
	assert.equal(measurePace(events, NOW).over, false);
});

test("an uncertain or failed attempt is not a send", () => {
	// The log records what was confirmed. A receipt stuck at dispatching is a
	// separate record and must not slow the caller down here.
	const events = Array.from({ length: THRESHOLD }, (_, index) => send(minutesAgo(index + 1), "comment.uncertain"));
	assert.equal(measurePace(events, NOW).over, false);
});

test("replies and posts both count toward the same run", () => {
	const events = [
		...Array.from({ length: THRESHOLD - 1 }, (_, index) => send(minutesAgo(index + 1), "comment.post")),
		send(minutesAgo(THRESHOLD), "comment.reply"),
	];
	assert.equal(measurePace(events, NOW).recent, THRESHOLD);
});

test("the prompt stops the send and names the way forward", () => {
	const pace = measurePace(
		Array.from({ length: THRESHOLD }, (_, index) => send(minutesAgo(index + 1))),
		NOW,
	);
	const prompt = pacePrompt(pace, "post");
	assert.equal(prompt.sent, false);
	assert.equal(prompt.needs_confirmation, true);
	assert.match(prompt.question, new RegExp(`${THRESHOLD}`));
	assert.match(prompt.next, /--confirm/);
	// It says what it does not know, because a number read from a local log is
	// easy to mistake for the platform's own limit.
	assert.ok(prompt.limits.some((line) => line.includes("not X's limits")));
});
