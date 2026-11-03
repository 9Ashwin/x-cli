import assert from "node:assert/strict";
import test from "node:test";

// Which element the signed-in handle is read from. The first version read the
// first `UserAvatar-Container-*` on the page, which is whatever avatar rendered
// first — on a status page that is the post's author, not the account. One run
// reported `0xsmerkzz` while signed in as somebody else. `mine` on every row and
// the ownership check before a delete are both built on this handle, so a wrong
// answer is worse than no answer.

// The source order, mirrored from src/page/page.ts so the precedence is pinned
// without a DOM in the unit tests. The real reader lives in the page adapter.
function resolve(sources: {
	profileLink: string | null;
	switcherLink: string | null;
	switcherAvatar: string | null;
	firstAvatarOnPage: string | null;
}): string | null {
	const RESERVED = new Set([
		"home",
		"explore",
		"notifications",
		"messages",
		"i",
		"search",
		"settings",
		"compose",
		"jobs",
		"premium",
		"communities",
		"lists",
		"bookmarks",
		"grok",
	]);
	const fromHref = (href: string | null) => {
		const segment = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(href ?? "")?.[1];
		return segment && !RESERVED.has(segment.toLowerCase()) ? segment : null;
	};
	return (
		fromHref(sources.profileLink) ??
		fromHref(sources.switcherLink) ??
		(sources.switcherAvatar?.replace("UserAvatar-Container-", "") || null) ??
		null
	);
}

test("the nav profile link is the account", () => {
	assert.equal(
		resolve({
			profileLink: "/NarcissusWWWWWW",
			switcherLink: null,
			switcherAvatar: null,
			firstAvatarOnPage: "UserAvatar-Container-elonmusk",
		}),
		"NarcissusWWWWWW",
	);
});

test("a composer open on someone else's post does not change the answer", () => {
	// The observed failure: the conversation's first avatar is the author.
	assert.equal(
		resolve({
			profileLink: "/NarcissusWWWWWW",
			switcherLink: null,
			switcherAvatar: null,
			firstAvatarOnPage: "UserAvatar-Container-0xsmerkzz",
		}),
		"NarcissusWWWWWW",
	);
});

test("the account switcher is the fallback when the profile tab is absent", () => {
	assert.equal(
		resolve({
			profileLink: null,
			switcherLink: "/NarcissusWWWWWW",
			switcherAvatar: null,
			firstAvatarOnPage: "UserAvatar-Container-someone",
		}),
		"NarcissusWWWWWW",
	);
});

test("an avatar is only trusted from inside the switcher", () => {
	// An avatar found there really is the owner. One found anywhere else is just
	// the first thing the page rendered.
	assert.equal(
		resolve({
			profileLink: null,
			switcherLink: null,
			switcherAvatar: "UserAvatar-Container-NarcissusWWWWWW",
			firstAvatarOnPage: "UserAvatar-Container-elonmusk",
		}),
		"NarcissusWWWWWW",
	);
	assert.equal(
		resolve({
			profileLink: null,
			switcherLink: null,
			switcherAvatar: null,
			firstAvatarOnPage: "UserAvatar-Container-elonmusk",
		}),
		null,
	);
});

test("nothing readable is null, not a guess", () => {
	assert.equal(resolve({ profileLink: null, switcherLink: null, switcherAvatar: null, firstAvatarOnPage: null }), null);
});

test("a profile link that is not a handle is not read as one", () => {
	// X also links `/home`, `/explore` and friends from the same nav.
	assert.equal(
		resolve({
			profileLink: "/home",
			switcherLink: null,
			switcherAvatar: null,
			firstAvatarOnPage: null,
		}),
		null,
	);
});
