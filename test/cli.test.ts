import assert from "node:assert/strict";
import test from "node:test";
import { run } from "../src/main.ts";

// The envelope is the public contract: one JSON object on the stream the caller
// reads, and an exit code that says what kind of failure happened.

function streams() {
	const out: string[] = [];
	const err: string[] = [];
	return {
		out,
		err,
		io: { stdout: { write: (text: string) => out.push(text) }, stderr: { write: (text: string) => err.push(text) } },
	};
}

test("schema lists commands and exit codes", async () => {
	const { io, out } = streams();
	assert.equal(await run(["schema"], io), 0);
	const payload = JSON.parse(out.join(""));
	assert.equal(payload.ok, true);
	assert.ok(payload.data.commands.some((command: { id: string }) => command.id === "comment.post"));
	assert.equal(payload.data.exit_codes["6"], "uncertain delivery or key conflict");
});

test("following a roster is a write, and a dry run plans it as one", async () => {
	const { io, out } = streams();
	const code = await run(["list", "follow", "2105917347391492419", "--request-id", "lf-1", "--dry-run"], io);
	assert.equal(code, 0);
	const payload = JSON.parse(out.join(""));
	assert.equal(payload.dry_run, true);
	assert.equal(payload.data.effect, "account_write");
	assert.equal(payload.data.executed, false);
});

test("following a roster does not need --confirm", async () => {
	// The run plans without the flag; what it does is bounded by --limit, not by a
	// second acknowledgement.
	const { io, out } = streams();
	const code = await run(["list", "follow", "2105917347391492419", "--request-id", "lf-2", "--dry-run"], io);
	assert.equal(code, 0);
	const payload = JSON.parse(out.join(""));
	assert.equal(payload.dry_run, true);
	assert.equal(payload.data.executed, false);
});

test("following a roster without a request id is refused", async () => {
	const { io, err } = streams();
	assert.equal(await run(["list", "follow", "2105917347391492419"], io), 2);
	const payload = JSON.parse(err.join(""));
	assert.equal(payload.error.code, "invalid_argument");
	assert.match(payload.error.message, /--request-id/);
});

test("a dry run plans a write without a browser", async () => {
	const { io, out } = streams();
	const code = await run(
		["comment", "post", "--status", "1234567890", "--text", "hi", "--request-id", "r-1", "--dry-run"],
		io,
	);
	assert.equal(code, 0);
	const payload = JSON.parse(out.join(""));
	assert.equal(payload.dry_run, true);
	assert.equal(payload.data.effect, "account_write");
	assert.equal(payload.data.executed, false);
});

test("a bad target is a validation failure with exit 2", async () => {
	const { io, err } = streams();
	assert.equal(await run(["comment", "list", "--status", "nope"], io), 2);
	const payload = JSON.parse(err.join(""));
	assert.equal(payload.ok, false);
	assert.equal(payload.error.type, "validation");
	assert.equal(payload.error.retryable, false);
});

test("a missing reply id is refused before any browser work", async () => {
	const { io, err } = streams();
	const code = await run(
		["comment", "reply", "--status", "123", "--text", "hi", "--request-id", "r-2", "--dry-run"],
		io,
	);
	assert.equal(code, 2);
	assert.equal(JSON.parse(err.join("")).error.code, "invalid_argument");
});

test("help is a presentation exception and exits zero", async () => {
	const { io, out } = streams();
	assert.equal(await run(["--help"], io), 0);
	assert.match(out.join(""), /operate X/);
});
