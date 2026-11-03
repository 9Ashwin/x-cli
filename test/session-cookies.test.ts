import assert from "node:assert/strict";
import test from "node:test";
import { type AuthCookies, signedIn } from "../src/session-cookies.ts";

// Whether the sign-in window can be closed on its own. The previous rule was
// "wait for the owner to close it", which asked a person to act on something the
// profile already answers: once X sets the session cookies, the sign-in is done
// and the window is decoration.

const empty: AuthCookies = { auth_token: null, ct0: null };
const before: AuthCookies = { auth_token: "aaaa", ct0: "bbbb" };
const after: AuthCookies = { auth_token: "cccc", ct0: "dddd" };

test("both cookies present and new means the sign-in landed", () => {
	assert.equal(signedIn(after, empty), true);
	assert.equal(signedIn(after, before), true);
});

test("a cookie missing means not yet", () => {
	// X writes the pair together; one without the other is a half-finished write,
	// not a session.
	assert.equal(signedIn({ auth_token: "cccc", ct0: null }, before), false);
	assert.equal(signedIn({ auth_token: null, ct0: "dddd" }, before), false);
});

test("the same cookies that were there before do not count", () => {
	// A profile already signed in still has an auth_token. Counting that as this
	// sign-in would report success for a window nobody touched.
	assert.equal(signedIn(before, before), false);
});

test("a rotated cookie counts even when the other is unchanged", () => {
	// X rotates the session token on sign-in; the CSRF value can stay put.
	assert.equal(signedIn({ auth_token: "cccc", ct0: "bbbb" }, before), true);
});

test("an unreadable store reads as not yet, not as success", () => {
	assert.equal(signedIn(empty, empty), false);
});
