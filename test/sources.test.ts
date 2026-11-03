import assert from "node:assert/strict";
import test from "node:test";
import { parseEngagement } from "../src/operations/hot.ts";
import { searchUrl } from "../src/operations/sources.ts";

// The search URL is a contract with X, not an internal detail: the query has to
// survive encoding and the tab has to be the one the reader expects.

test("a query is encoded, including non-ASCII", () => {
	assert.equal(searchUrl("AI agent"), "https://x.com/search?q=AI%20agent&f=live");
	assert.equal(searchUrl("人工智能"), `https://x.com/search?q=${encodeURIComponent("人工智能")}&f=live`);
});

test("characters that would change the URL are escaped", () => {
	// An unescaped & would end the query and start a second parameter; an
	// unescaped # would drop everything after it.
	const url = searchUrl("a&b#c");
	assert.ok(url.includes("q=a%26b%23c"));
	assert.equal(new URL(url).searchParams.get("q"), "a&b#c");
});

test("the latest tab is the one read", () => {
	assert.equal(new URL(searchUrl("x")).searchParams.get("f"), "live");
});

// Reading engagement from the one label that carries every count.

test("every count is read from the summary label, not from the buttons", () => {
	const parsed = parseEngagement("174 replies, 541 reposts, 2741 likes, 3949 bookmarks, 234215 views");
	assert.deepEqual(parsed, { replies: 174, reposts: 541, likes: 2741, bookmarks: 3949, views: 234215 });
});

test("the bookmark and view counts are not lost when the label is unusual", () => {
	// The bookmark button's own label is just "Bookmark" — no count. Reading the
	// buttons individually is why these two went missing.
	const parsed = parseEngagement("25 replies, 357 reposts, 2558 likes, 4061 bookmarks, 156268 views");
	assert.equal(parsed.bookmarks, 4061);
	assert.equal(parsed.views, 156268);
});

test("a missing label is nulls, not zeroes", () => {
	assert.deepEqual(parseEngagement(null), {
		likes: null,
		replies: null,
		reposts: null,
		bookmarks: null,
		views: null,
	});
});
