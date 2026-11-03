import assert from "node:assert/strict";
import test from "node:test";
import { chooseFollowers } from "../src/operations/members.ts";

// Who a roster run presses follow on. Only an account already followed is left
// out. A protected account is attempted and produces a request, which the result
// marks `pending`; a cell whose button had not rendered is attempted too, because
// `user follow` re-reads the button on the account's own page before pressing.

const member = (handle: string, following: boolean | null, protectedAccount = false) => ({
	handle,
	following,
	protected: protectedAccount,
});

test("an account already followed is left out", () => {
	const chosen = chooseFollowers([member("a", false), member("b", true), member("c", null), member("d", false)], 10);
	assert.deepEqual(
		chosen.map((one) => one.handle),
		["a", "c", "d"],
	);
});

test("a protected account is attempted", () => {
	// Following one sends a request rather than following, and the result says
	// `pending`. Skipping it would leave a caller's roster permanently incomplete.
	const chosen = chooseFollowers([member("a", false, true), member("b", false)], 10);
	assert.deepEqual(
		chosen.map((one) => one.handle),
		["a", "b"],
	);
});

test("a cell whose button had not rendered is attempted", () => {
	// The roster is a snapshot; the account's own page re-reads the button before
	// anything is pressed, so an unknown state here is not a reason to skip.
	const chosen = chooseFollowers([member("a", null)], 10);
	assert.deepEqual(
		chosen.map((one) => one.handle),
		["a"],
	);
});

test("the limit caps the run, not the reading", () => {
	const chosen = chooseFollowers([member("a", false), member("b", false), member("c", false), member("d", false)], 2);
	assert.deepEqual(
		chosen.map((one) => one.handle),
		["a", "b"],
	);
	assert.equal(chooseFollowers([], 10).length, 0);
});
