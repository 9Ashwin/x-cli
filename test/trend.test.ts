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

// Whether a post is about the topic, used to keep the home timeline from
// polluting a topic-scoped `auto suggest`. Latin words are matched on word
// boundaries because "ai" sits inside `AlchainHust` and `BirdAlbum`; a CJK word
// has no boundaries to use.
function aboutTopic(text: string, query: string): boolean {
	const words = query
		.toLowerCase()
		.split(/[\s,，]+/)
		.map((word) => word.trim())
		.filter((word) => word.length >= 2);
	if (!words.length) return true;
	const patterns = words.map((word) =>
		/[㐀-鿿]/.test(word)
			? null
			: new RegExp(`(^|[^a-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_]|$)`, "i"),
	);
	return words.some((word, index) => {
		const pattern = patterns[index];
		return pattern ? pattern.test(text) : text.toLowerCase().includes(word);
	});
}

test("a two-letter latin word does not match inside a name", () => {
	assert.equal(aboutTopic("BirdAlbum 发布，全球最好的观鸟科普网站", "AI agent"), false);
	assert.equal(aboutTopic("AlchainHust 的周报", "AI agent"), false);
});

test("a latin word matches as a word", () => {
	assert.equal(aboutTopic("Exa 把播客接进了 Search API，agent 可以直接搜", "AI agent"), true);
	assert.equal(aboutTopic("we built a new AI backend", "AI agent"), true);
});

test("a chinese word matches as written", () => {
	assert.equal(aboutTopic("这套课把工具调用讲得很细，智能体那部分尤其", "智能体"), true);
	assert.equal(aboutTopic("今天天气不错", "智能体"), false);
});

test("any word of the query is enough", () => {
	// The search box understands the phrase; a post only has to be about it.
	assert.equal(aboutTopic("agent 记忆这块我一直没想明白", "AI agent"), true);
});

test("an empty query keeps everything", () => {
	assert.equal(aboutTopic("anything at all", ""), true);
});
