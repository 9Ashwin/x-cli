import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { App } from "../src/app.ts";
import type { Session } from "../src/browser.ts";
import { fixture } from "./fixture.ts";

// An isolated Chrome with an intercepted page. No credentials and no network:
// what this proves is that the adapter's reading rules and the receipt contract
// behave, not that X still renders them — that is reported separately from a
// real-page run.

test("isolated Chrome: conversation reads, the reply guard and receipts", {
	skip: process.env.X_CLI_TEST_BROWSER !== "1",
	timeout: 180_000,
}, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "x-cli-browser-"));
	const app = new App({ state_dir: directory, timeout: 20_000 });
	const signal = AbortSignal.timeout(170_000);
	let witness: Session | undefined;
	t.after(async () => {
		await app.chrome.stop(AbortSignal.timeout(5000)).catch(() => undefined);
		await witness?.close();
		await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined);
	});
	await app.execute("browser.start", { headless: true }, signal);
	witness = await app.chrome.connect(signal);
	assert.ok(witness);

	// Every X route serves the fixture, so navigation behaves the way the real
	// site's client-side routing does and each command gets a page to read.
	await witness.tab.route("**/*", async (route) => {
		const url = route.request().url();
		if (new URL(url).hostname.endsWith("x.com")) await route.fulfill({ contentType: "text/html", body: fixture });
		else await route.abort();
	});

	const open = async (path: string) => {
		await witness?.tab.goto(`https://x.com${path}`, { waitUntil: "domcontentloaded" });
		// The fixture's own script runs on parse, so a short settle is enough;
		// a timer here is not standing in for a page that loads later.
		await witness?.tab.waitForTimeout(120);
	};

	await t.test("the account comes from the nav's avatar marker", async () => {
		await open("/home");
		const state = await witness?.call<{ account: { handle: string | null } | null }>("status");
		assert.equal(state?.account?.handle, "fixture_user");
	});

	await t.test("a conversation reads the root, the reply and the quote without mixing ids", async () => {
		await open("/fixture_user/status/1001");
		const rows = await witness?.call<{ id: string; handle: string | null; root: boolean }[]>("tweet.list");
		assert.ok(rows);
		const byId = new Map(rows.map((row) => [row.id, row]));
		// The quoted tweet's status link must not become the outer tweet's id.
		assert.ok(byId.has("1003"), "the quoting tweet keeps its own id");
		assert.ok(!byId.has("9999"), "the quoted tweet is not listed as its own row");
		assert.equal(byId.get("1001")?.handle, "fixture_user");
		assert.equal(byId.get("1002")?.handle, "other_user");
	});

	await t.test("a promoted post is marked, and a post that mentions ads is not", async () => {
		await open("/home");
		const rows = await witness?.call<{ id: string; promoted: boolean }[]>("tweet.list");
		assert.ok(rows);
		const byID = new Map(rows.map((row) => [row.id, row]));
		assert.equal(byID.get("1004")?.promoted, true, "the wrapped Ad is promoted");
		assert.equal(byID.get("1005")?.promoted, false, "a body mentioning Ad is not an ad");
	});

	await t.test("the timeline excludes promoted posts and says how many", async () => {
		const result = (await app.execute("feed.read", { limit: 10 }, signal)) as {
			source: string;
			items: { id: string }[];
			complete: boolean;
			limits: string[];
		};
		assert.equal(result.source, "timeline");
		assert.equal(result.complete, false);
		assert.ok(!result.items.some((item) => item.id === "1004"), "the ad is not in items");
		assert.ok(
			result.items.some((item) => item.id === "1001"),
			"an ordinary post is",
		);
		assert.ok(
			result.limits.some((line) => line.includes("1 promoted post")),
			"the excluded count is reported rather than hidden",
		);
	});

	await t.test("a keyword search reads the latest tab and returns the same shape", async () => {
		const result = (await app.execute("search.keyword", { query: "AI agent", limit: 10 }, signal)) as {
			source: string;
			query: string;
			items: { id: string }[];
			scope: string;
		};
		assert.equal(result.query, "AI agent");
		assert.equal(result.scope, "loaded_dom");
		assert.ok(result.items.some((item) => item.id === "1005"));
		assert.equal(new URL(String(witness?.tab.url())).searchParams.get("f"), "live", "the live tab is what was opened");
	});

	await t.test("post get returns the status itself, not its replies", async () => {
		const result = (await app.execute("post.get", { status_id: "1001" }, signal)) as {
			item: { id: string; text: string } | null;
			limits: string[];
		};
		assert.equal(result.item?.id, "1001");
		assert.ok(result.limits.some((line) => line.includes("comment list")));
	});

	await t.test("a reply is refused when the composer is not in reply mode", async () => {
		await open("/home");
		// No dialog is present, so the adapter must report no quoted tweet rather
		// than picking the inline composer and posting publicly.
		const state = await witness?.call<{ quoted: unknown }>("reply.composer");
		assert.equal(state?.quoted, null);
	});

	await t.test("the reply guard refuses a changed draft", async () => {
		await open("/fixture_user/status/1001");
		const control = await witness?.call<{ selector: string }>("reply.control", {
			tweet_id: "1001",
			token: "open-1",
		});
		assert.ok(control);
		await witness?.click(control);
		await witness?.tab.waitForTimeout(200);

		const state = await witness?.call<{ quoted: { handle: string | null } | null }>("reply.composer");
		assert.equal(state?.quoted?.handle, "fixture_user");

		const token = "send-1";
		const prepared = await witness?.call<{ selector: string }>("reply.prepare", {
			token,
			text: "hello",
			tweet_id: "1001",
			target_handle: "fixture_user",
			target_text: "a root tweet",
		});
		assert.ok(prepared);
		await witness?.tab.locator(prepared.selector).fill("something else");
		await assert.rejects(
			async () =>
				witness?.call("reply.arm-write", {
					token,
					text: "hello",
					tweet_id: "1001",
					target_handle: "fixture_user",
					target_text: "a root tweet",
				}),
			(error: unknown) => {
				assert.ok(error instanceof Error);
				assert.match(String((error as { code?: string }).code), /draft_conflict/);
				return true;
			},
		);
	});

	await t.test("a send leaves a receipt and is never repeated for the same id", async () => {
		await open("/fixture_user/status/1001");
		const control = await witness?.call<{ selector: string }>("reply.control", {
			tweet_id: "1001",
			token: "open-2",
		});
		assert.ok(control);
		await witness?.click(control);
		await witness?.tab.waitForTimeout(200);

		const result = (await app.execute(
			"comment.post",
			{ status_id: "1001", text: "a real reply from the fixture", request_id: "fixed-1" },
			signal,
		)) as { confirmed: boolean; request_id: string };
		assert.equal(result.confirmed, true);
		assert.equal(result.request_id, "fixed-1");

		const receipt = (await app.execute("receipt.get", { request_id: "fixed-1" }, signal)) as {
			status: string;
		};
		assert.equal(receipt.status, "confirmed");

		// The same request id replays the receipt instead of sending again.
		const replay = (await app.execute(
			"comment.post",
			{ status_id: "1001", text: "a real reply from the fixture", request_id: "fixed-1" },
			signal,
		)) as { replayed?: boolean };
		assert.equal(replay.replayed, true);

		// A different body under the same id is a conflict, not a second reply.
		await assert.rejects(
			async () =>
				app.execute("comment.post", { status_id: "1001", text: "different text", request_id: "fixed-1" }, signal),
			(error: unknown) => {
				assert.equal((error as { code?: string }).code, "idempotency_conflict");
				return true;
			},
		);
	});
});
