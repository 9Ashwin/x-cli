import assert from "node:assert/strict";
import test from "node:test";
import { CliError } from "../src/errors.ts";
import { statusID, validateTarget, validateText } from "../src/operations/validate.ts";

// statusID is the single boundary every status target crosses. A URL, a bare id
// and a copied link all become the same numeric id, and anything else is refused
// rather than guessed — a wrong id replies to the wrong person.

test("a bare id is its own identity", () => {
	assert.equal(statusID("1234567890"), "1234567890");
});

test("a canonical status URL resolves to its id", () => {
	assert.equal(statusID("https://x.com/someone/status/1789456123456789012"), "1789456123456789012");
	assert.equal(statusID("https://twitter.com/someone/status/1789456123456789012?s=20"), "1789456123456789012");
});

test("the author path does not decide the id", () => {
	// X redirects /i/web/status/<id> to the author's path. Both name one status.
	assert.equal(statusID("https://x.com/i/web/status/1789456123456789012"), "1789456123456789012");
	assert.equal(statusID("https://x.com/renamed_handle/status/1789456123456789012"), "1789456123456789012");
});

test("another origin is not a status", () => {
	assert.equal(statusID("https://example.com/someone/status/123"), null);
	assert.equal(statusID("https://x.com.evil.example/someone/status/123"), null);
});

test("a profile URL is not a status", () => {
	assert.equal(statusID("https://x.com/someone"), null);
});

test("empty and garbage resolve to nothing", () => {
	assert.equal(statusID(undefined), null);
	assert.equal(statusID("   "), null);
	assert.equal(statusID("not a url"), null);
});

test("text is required and trimmed", () => {
	assert.equal(validateText("  hello  ", "comment.post"), "hello");
	assert.throws(
		() => validateText("   ", "comment.post"),
		(error: unknown) => {
			assert.ok(error instanceof CliError);
			assert.equal(error.code, "invalid_argument");
			return true;
		},
	);
});

test("a reply needs both a status and a reply id", () => {
	validateTarget("comment.reply", { status_id: "123", comment_id: "456" });
	assert.throws(
		() => validateTarget("comment.reply", { status_id: "123" }),
		(error: unknown) => {
			assert.ok(error instanceof CliError);
			assert.equal(error.code, "invalid_argument");
			return true;
		},
	);
});
