import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CliError } from "../src/errors.ts";
import { Store } from "../src/store.ts";

// The receipt contract is what makes a write auditable. These tests pin the two
// properties a caller relies on: a receipt survives a new process, and a corrupt
// file is reported rather than silently treated as empty.

test("a receipt round-trips through the state directory", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "x-cli-receipt-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const store = new Store(directory);
	const now = new Date().toISOString();
	await store.saveReceipt({
		request_id: "reply-1",
		fingerprint: "sha256:abc",
		operation: "comment.post",
		status: "prepared",
		created_at: now,
		updated_at: now,
		target: { tweet_id: "123" },
	});
	const reopened = await new Store(directory).receipt("reply-1");
	assert.equal(reopened.status, "prepared");
	assert.equal(reopened.target?.tweet_id, "123");
});

test("an unknown request id is reported as not found", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "x-cli-receipt-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await assert.rejects(new Store(directory).receipt("missing"), (error: unknown) => {
		assert.ok(error instanceof CliError);
		assert.equal(error.code, "not_found");
		return true;
	});
});

test("a corrupt receipts file is preserved and reported", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "x-cli-receipt-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await writeFile(join(directory, "receipts.json"), "{ not json", "utf8");
	await assert.rejects(new Store(directory).receipts(), (error: unknown) => {
		assert.ok(error instanceof CliError);
		assert.equal(error.code, "state_corrupt");
		return true;
	});
});

test("a receipt with an unknown status is refused", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "x-cli-receipt-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await writeFile(
		join(directory, "receipts.json"),
		JSON.stringify({ x: { request_id: "x", fingerprint: "f", status: "maybe" } }),
		"utf8",
	);
	await assert.rejects(new Store(directory).receipts(), (error: unknown) => {
		assert.ok(error instanceof CliError);
		assert.equal(error.code, "state_corrupt");
		return true;
	});
});
