import { mkdir, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import { CliError } from "./errors.ts";

// A lease so two commands never drive the same Chrome tab at once. The library's
// rmdir-based release leaves a directory behind when a process is killed, and a
// leftover lock makes every later command answer busy, so a stale one is removed
// before acquiring rather than only being noticed.

const STALE_MS = 120_000;
const MAX_RECOVERIES = 2;
// How long a second command waits for the one driving the tab. A read is a few
// seconds; a write that navigates and confirms is closer to a minute. Waiting is
// the right default because the alternative — removing a live lock — interleaves
// two commands on one tab, which is what the lease exists to prevent.
const WAIT_MS = 180_000;
const RETRY_MS = 500;

async function forceRemove(lockPath: string): Promise<void> {
	await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
}

// Whether the lock directory has not been touched for longer than the stale
// window. proper-lockfile refreshes the lock's mtime while it is held, so an
// old mtime means the holder died rather than that it is busy.
async function abandoned(lockPath: string): Promise<boolean> {
	try {
		const info = await stat(lockPath);
		return Date.now() - info.mtimeMs > STALE_MS;
	} catch {
		return true;
	}
}

export async function withLease<T>(path: string, run: (signal: AbortSignal) => Promise<T>, recoveries = 0): Promise<T> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const ownership = new AbortController();
	let release: () => Promise<void>;
	try {
		release = await lockfile.lock(path, {
			realpath: false,
			stale: STALE_MS,
			update: 10_000,
			retries: 0,
			onCompromised: (cause) => ownership.abort(new CliError("busy", "Workspace lock ownership was lost", { cause })),
		});
	} catch (error) {
		const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
		if (code === "ELOCKED" || code === "ENOTEMPTY") {
			// A live lock is waited on. An abandoned one is removed — but only after
			// its mtime says the holder stopped refreshing it. The first version
			// removed whatever it found, so a second command deleted the lock of a
			// first one that was still driving the tab, which is the one thing this
			// file exists to stop.
			const deadline = Date.now() + WAIT_MS;
			while (Date.now() < deadline) {
				if (await abandoned(`${path}.lock`)) {
					if (recoveries >= MAX_RECOVERIES)
						throw new CliError("busy", "The workspace lock could not be cleared", {
							hint: `Remove ${path}.lock by hand. Nothing else is holding it.`,
							details: { path: `${path}.lock` },
						});
					await forceRemove(`${path}.lock`);
					return withLease(path, run, recoveries + 1);
				}
				await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
			}
			throw new CliError("busy", "Another x-cli command is using the browser", {
				hint: "Wait for it to finish, then run this again. Only one command drives the tab at a time.",
				details: { path: `${path}.lock`, waited_seconds: Math.round(WAIT_MS / 1000) },
			});
		}
		throw error;
	}
	let outcome: { ok: true; value: T } | { ok: false; error: unknown } | undefined;
	try {
		const result = await run(ownership.signal);
		ownership.signal.throwIfAborted();
		outcome = { ok: true, value: result };
	} catch (error) {
		outcome = { ok: false, error };
	} finally {
		// A failed release is a warning, not a failure: a command that did its work
		// and then could not clean up still did its work.
		try {
			await release();
		} catch {
			/* The directory state is checked and reported below. */
		}
		await forceRemove(`${path}.lock`);
	}
	if (!outcome) throw new CliError("internal", "The lease produced no result");
	if (!outcome.ok) throw outcome.error;
	return outcome.value;
}
