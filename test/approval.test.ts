import assert from "node:assert/strict";
import test from "node:test";
import { approvalRequest, approvalRequired } from "../src/operations/approval.ts";

// The first look before anything is published. A skill can say "show the draft
// first"; a skill is text a model may skip, and one did — publishing a reply to
// a stranger with the draft and the send in the same turn. This is the same rule
// as a refusal the tool makes, so skipping it is not possible.

const root = { id: "123", handle: "author", text: "the post being answered" };

test("a first post returns the text and sends nothing", () => {
	const request = approvalRequest("post", { text: "hello" }, "hello", null, null, "key-1", false);
	assert.equal(request.sent, false);
	assert.equal(request.needs_approval, true);
	assert.equal(request.text, "hello");
	assert.equal(request.text_length, 5);
	assert.match(request.next, /--confirm/);
	assert.match(request.next, /Nothing has been sent/);
});

test("the target names who the reply reaches, read from the page", () => {
	const request = approvalRequest("post", { status_id: "999" }, "hi", root, null, "key-2", false);
	// The id reported is the post the page actually showed, not the one typed.
	assert.equal(request.target.status_id, "123");
	assert.equal(request.target.reaches, "author");
});

test("a reply to a reply names the reply being answered", () => {
	const reply = { id: "456", handle: "someone", text: "their reply" } as never;
	const request = approvalRequest("reply", { status_id: "123", comment_id: "456" }, "hi", root, reply, "key-3", false);
	assert.equal(request.action, "reply");
	assert.equal(request.target.answers?.id, "456");
	assert.equal(request.target.reaches, "someone");
});

test("a repeated text is called out before it is repeated", () => {
	const request = approvalRequest("post", { text: "same" }, "same", null, null, "key-4", true);
	assert.equal(request.repeated_before, true);
	assert.ok(request.limits.some((line) => /published this exact text before/.test(line)));
});

test("the request says no receipt was written", () => {
	// This is what makes the confirmed run a new decision: there is nothing to
	// replay, so `--confirm` starts over rather than finishing a half-done send.
	const request = approvalRequest("post", { text: "x" }, "x", null, null, "key-5", false);
	assert.ok(request.limits.some((line) => /no receipt was written/.test(line)));
});

test("it is honest that this is not a check on the writing", () => {
	const request = approvalRequest("post", { text: "x" }, "x", null, null, "key-6", false);
	assert.ok(request.limits.some((line) => /not a check on the text/.test(line)));
});

test("only publishing from this account is gated", () => {
	// Liking and following are not sentences. Gating them would train a caller to
	// pass --confirm without reading anything.
	assert.equal(approvalRequired("comment.post"), true);
	assert.equal(approvalRequired("comment.reply"), true);
	assert.equal(approvalRequired("post.create"), true);
	assert.equal(approvalRequired("post.like"), false);
	assert.equal(approvalRequired("user.follow"), false);
	assert.equal(approvalRequired("comment.delete"), false);
});
