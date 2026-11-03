import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Whether the profile has finished signing in.
//
// The previous answer was "wait until the owner closes the window", which asks a
// person to do something they have no reason to know about: by the time X sets
// `auth_token`, the sign-in is already done and the window is just sitting
// there. Every waiting message told the owner to close it, and a sign-in that
// had succeeded looked stuck.
//
// Chrome writes the session as cookies in the profile's SQLite store. Their
// presence — not their value — is the signal. Only names, hosts and a hash of the
// encrypted blob are read; the values themselves never leave the database.

export interface AuthCookies {
	// A stable fingerprint per cookie, so "changed since I looked" is answerable
	// without holding the value.
	auth_token: string | null;
	ct0: string | null;
}

const EMPTY: AuthCookies = { auth_token: null, ct0: null };

// The two cookies X's session needs. `auth_token` is the session; `ct0` is the
// CSRF token the web client sends with every request, and X sets both together.
const WANTED = ["auth_token", "ct0"] as const;

let sqlite: typeof import("node:sqlite") | null | undefined;

async function loadSqlite(): Promise<typeof import("node:sqlite") | null> {
	if (sqlite !== undefined) return sqlite;
	try {
		// `node:sqlite` prints an experimental warning the first time it is loaded,
		// which would land in the same stream as the progress lines. It is a fact
		// about the runtime, not about this command, so it is suppressed once.
		process.removeAllListeners("warning");
		sqlite = await import("node:sqlite");
	} catch {
		sqlite = null;
	}
	return sqlite;
}

async function copyStore(profile: string): Promise<string | null> {
	const source = join(profile, "Default", "Cookies");
	if (!existsSync(source)) return null;
	// Chrome holds the database open. Copying it and its write-ahead log is how a
	// reader sees a consistent snapshot without taking the lock away from Chrome.
	const dir = await mkdtemp(join(tmpdir(), "xx-cookies-"));
	const target = join(dir, "Cookies");
	for (const suffix of ["", "-wal", "-shm"]) {
		if (existsSync(`${source}${suffix}`)) await copyFile(`${source}${suffix}`, `${target}${suffix}`);
	}
	return target;
}

export async function readAuthCookies(profile: string): Promise<AuthCookies> {
	const module = await loadSqlite();
	if (!module) return EMPTY;
	const store = await copyStore(profile);
	if (!store) return EMPTY;
	try {
		const db = new module.DatabaseSync(store, { readOnly: true });
		try {
			const rows = db
				.prepare("SELECT name, host_key, encrypted_value FROM cookies WHERE name IN ('auth_token','ct0')")
				.all() as { name: string; host_key: string; encrypted_value: Uint8Array }[];
			const found: AuthCookies = { auth_token: null, ct0: null };
			for (const name of WANTED) {
				// `.x.com` is the session's own host. A cookie of the same name on
				// another host is not this account's session.
				const row = rows.find((entry) => entry.name === name && entry.host_key.endsWith("x.com"));
				if (!row || !row.encrypted_value?.length) continue;
				// Hashed, not kept: the caller only needs to know whether this differs
				// from what it saw before.
				found[name] = createHash("sha256").update(Buffer.from(row.encrypted_value)).digest("hex").slice(0, 16);
			}
			return found;
		} finally {
			db.close();
		}
	} catch {
		// A locked, corrupt or half-written store answers "not yet", which is what
		// the caller's poll already means. It must not fail the sign-in.
		return EMPTY;
	} finally {
		await rm(store.replace(/Cookies$/, ""), { recursive: true, force: true }).catch(() => undefined);
	}
}

// Both cookies present, and different from what was there before the window
// opened. The second half matters: a profile that was signed in already still
// has an `auth_token`, and counting that as this sign-in would report success
// for a window the owner never touched.
export function signedIn(cookies: AuthCookies, baseline: AuthCookies): boolean {
	if (!cookies.auth_token || !cookies.ct0) return false;
	return cookies.auth_token !== baseline.auth_token || cookies.ct0 !== baseline.ct0;
}
