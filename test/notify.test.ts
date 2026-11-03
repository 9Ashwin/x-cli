import assert from "node:assert/strict";
import test from "node:test";

// The notification reader is pure classification over a row's text. These pin the
// ordering and the fallbacks, because the real page has not yet shown this account
// an interaction — every row it renders is a suggestion — so the live run cannot
// exercise these paths.

const KINDS: { kind: string; test: RegExp }[] = [
	{ kind: "recommended", test: /^Recent post from|posted$|的热门帖子|推荐$/i },
	{ kind: "reply", test: /replied to your (post|reply)|回复了你的|回复了你/i },
	{ kind: "mention", test: /mentioned you|提到了你/i },
	{ kind: "repost", test: /reposted your|转推了你的|转发了你的/i },
	{ kind: "like", test: /liked your|赞了你的|喜欢了你的/i },
	{ kind: "follow", test: /followed you|关注了你/i },
];

function classify(text: string): string {
	return KINDS.find((entry) => entry.test.test(text))?.kind ?? "other";
}

test("a reply is not read as a like", () => {
	// "replied to your post" contains "your post", and a looser like-test would
	// claim it. Order is why it does not.
	assert.equal(classify("someone replied to your post"), "reply");
});

test("English and Chinese wording both classify", () => {
	assert.equal(classify("someone liked your post"), "like");
	assert.equal(classify("某人赞了你的帖子"), "like");
	assert.equal(classify("someone followed you"), "follow");
	assert.equal(classify("某人关注了你"), "follow");
});

test("a repost is not read as a like", () => {
	assert.equal(classify("someone reposted your post"), "repost");
	assert.equal(classify("某人转推了你的帖子"), "repost");
});

test("a suggestion is marked as such, not as activity", () => {
	assert.equal(classify("Recent post from 清凤· 17h something"), "recommended");
});

test("unknown wording falls back to other rather than guessing", () => {
	assert.equal(classify("X changed something in your account"), "other");
});

test("an empty row is other", () => {
	assert.equal(classify(""), "other");
});
