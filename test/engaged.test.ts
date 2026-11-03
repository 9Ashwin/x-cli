import assert from "node:assert/strict";
import test from "node:test";
import { historyOf } from "../src/operations/engaged.ts";
import type { Event } from "../src/store.ts";

// What this account has already done to a post, read from its own operation log.
// Without this, a post answered last week comes back at the top of the list the
// moment its "seen" window expires, and the caller cannot tell from the list.

const event = (operation: string, status_id: string, at = "2026-11-03T10:00:00.000Z"): Event => ({
	id: `${operation}-${status_id}`,
	at,
	operation,
	data: { status_id },
});

test("a reply marks the post as answered", () => {
	const map = historyOf([event("comment.post", "111")]);
	assert.equal(map.get("111")?.post, "replied");
});

test("a reply to a reply also answers the post it is under", () => {
	// `comment.reply` records the conversation's status id, which is the post
	// that would be proposed again.
	const map = historyOf([event("comment.reply", "111")]);
	assert.equal(map.get("111")?.post, "replied");
});

test("a like is a touch, not an answer", () => {
	const map = historyOf([event("post.like", "222")]);
	assert.equal(map.get("222")?.post, "touched");
});

test("a reply outranks a like whatever the order", () => {
	// Liked first, answered later.
	const later = historyOf([event("post.like", "333", "2026-11-01T00:00:00.000Z"), event("comment.post", "333")]);
	assert.equal(later.get("333")?.post, "replied");
	// Answered first, liked later: still answered.
	const earlier = historyOf([event("comment.post", "444", "2026-11-01T00:00:00.000Z"), event("post.like", "444")]);
	assert.equal(earlier.get("444")?.post, "replied");
});

test("a deleted reply still counts as answered", () => {
	// The log keeps the reply; the delete is a separate event. The post was
	// answered, and removing the reply does not mean "propose it again".
	const map = historyOf([event("comment.post", "555"), event("comment.delete", "555")]);
	assert.equal(map.get("555")?.post, "replied");
});

test("reading a post is not engagement", () => {
	// Reads are not in the log at all, and a read is not a reason to stop
	// proposing something.
	const map = historyOf([event("feed.read", "666"), event("search.keyword", "777")]);
	assert.equal(map.size, 0);
});

test("an event without a status id is ignored", () => {
	const map = historyOf([{ id: "x", at: "2026-11-03T10:00:00.000Z", operation: "comment.post", data: {} }]);
	assert.equal(map.size, 0);
});
