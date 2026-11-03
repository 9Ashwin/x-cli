import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withLease } from "../src/lease.ts";

// Two commands must not drive the same tab at once, and the second one must wait
// rather than break in. The first version removed whatever lock it found, so a
// second command deleted the lock of a first one that was still working — the
// exact interleaving this file exists to prevent. These pin the three states:
// free, held-and-alive, held-and-abandoned.

async function scratch(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "x-cli-lease-"));
	return join(dir, "operation");
}

test("a second command waits for the first to finish", async () => {
	const path = await scratch();
	const order: string[] = [];
	const slow = withLease(path, async () => {
		order.push("slow-start");
		await new Promise((resolve) => setTimeout(resolve, 600));
		order.push("slow-end");
		return "slow";
	});
	await new Promise((resolve) => setTimeout(resolve, 50));
	const fast = await withLease(path, async () => {
		order.push("fast");
		return "fast";
	});
	assert.equal(fast, "fast");
	assert.equal(await slow, "slow");
	// The fast one ran only after the slow one released: no interleaving.
	assert.deepEqual(order, ["slow-start", "slow-end", "fast"]);
	await rm(dirname(path), { recursive: true, force: true });
});

test("the work runs and the lock is gone afterwards", async () => {
	const path = await scratch();
	assert.equal(await withLease(path, async () => 42), 42);
	// Nothing left behind, so the next command starts immediately.
	const started = Date.now();
	assert.equal(await withLease(path, async () => "next"), "next");
	assert.ok(Date.now() - started < 1000);
	await rm(dirname(path), { recursive: true, force: true });
});

test("an error inside the work still releases the lock", async () => {
	const path = await scratch();
	await assert.rejects(withLease(path, async () => Promise.reject(new Error("boom"))));
	assert.equal(await withLease(path, async () => "after"), "after");
	await rm(dirname(path), { recursive: true, force: true });
});

function dirname(path: string): string {
	return path.slice(0, path.lastIndexOf("/"));
}
