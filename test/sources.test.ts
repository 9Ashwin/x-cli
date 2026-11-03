import assert from "node:assert/strict";
import test from "node:test";
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
