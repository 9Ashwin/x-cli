import assert from "node:assert/strict";
import test from "node:test";
import { matchesTopic } from "../src/operations/trend.ts";

// The board reorders while it is open, so the row an index named a moment ago
// can be a different row by the time the click lands. What the page actually
// opened is checked against what was asked for; a silent mismatch would return
// one topic's posts under another topic's title.

test("a trending word opens a search for that same word", () => {
	assert.equal(matchesTopic("Bears", "Bears"), true);
	assert.equal(matchesTopic("Draymond", "Draymond"), true);
});

test("a hashtag is the same topic with or without the hash", () => {
	// The entry reads "#GMMTVNEXT" and the search carries "%23GMMTVNEXT".
	assert.equal(matchesTopic("#GMMTVNEXT", "#gmmtvnext"), true);
	assert.equal(matchesTopic("#dwts", "dwts"), true);
});

test("a multi-word phrase survives encoding and casing", () => {
	assert.equal(matchesTopic("Today is Election Day", "Today is Election Day"), true);
	assert.equal(matchesTopic("Today is Election Day", "today is election day"), true);
});

test("a different topic is refused, not returned", () => {
	// This is the failure that was observed: index 6 was read as one row and the
	// click opened Sam Darnold.
	assert.equal(matchesTopic("Draymond", "Sam Darnold"), false);
	assert.equal(matchesTopic("Bears", "Bears trade rumors"), true);
});

test("an empty side is not treated as a mismatch", () => {
	// A story row opens a topic page, which carries no query; the title check
	// covers that case instead.
	assert.equal(matchesTopic("Draymond", ""), true);
	assert.equal(matchesTopic("", "anything"), true);
});
