import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, readFile, readlink, unlink } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { type Browser, chromium, type Page } from "playwright-core";
import { CliError, isMissing } from "./errors.ts";
import type { Store } from "./store.ts";

export interface BrowserState {
	pid: number;
	port: number;
	websocket: string;
	target_id?: string;
	headless: boolean;
	started_at: string;
}

interface Version {
	webSocketDebuggerUrl: string;
	"User-Agent"?: string;
}

export interface Snapshot {
	url: string | null;
	title: string | null;
	// What the tab is showing. `unknown` is a load that has not settled.
	page_kind: "home" | "status" | "profile" | "search" | "login" | "verify" | "unknown";
	login_required: boolean;
	verification_required: boolean;
	// The signed-in account as X states it in its own nav, when it is readable.
	account: { handle: string | null; name: string | null } | null;
	// The status (tweet) whose conversation is open, read from the URL.
	status: { id: string | null; author: string | null } | null;
	visible_text?: string;
}

export interface Point {
	x?: number;
	y?: number;
	selector?: string;
	already?: boolean;
}

// Signing in through Google refuses a browser started with a debugging port.
// The check is on the browser, not on the account: the same profile, opened
// without CDP, can sign in normally, and the cookies it writes are then usable
// by the CDP-controlled browser. This opens exactly that window and waits for
// the profile's lock to be released, which is how it knows the owner closed it.
export async function openWithoutDebugging(
	executable: string,
	profile: string,
	url: string,
	signal: AbortSignal,
): Promise<{ closed: boolean; started: boolean; notes?: string[] }> {
	const child = spawn(executable, [`--user-data-dir=${profile}`, "--no-first-run", url], {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
	// The launcher process exits as soon as the browser is up — on macOS Chrome
	// hands off to a running instance and the spawned pid is gone in under a
	// second. Watching that process therefore reported "closed" while the window
	// was still on screen. The profile lock is the real signal: Chrome holds it
	// for as long as any process is using the profile.
	let seenLock = false;
	const deadline = Date.now() + 30_000;
	// The lock appears a moment after launch, so a missing lock right after spawn
	// is not a closed window yet. Waiting for it to appear once keeps a slow
	// start from being read as "the owner closed it immediately".
	while (Date.now() < deadline) {
		signal.throwIfAborted();
		seenLock ||= await profileLocked(profile);
		if (seenLock) break;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	// No lock, no window: the launch failed rather than ended.
	if (!seenLock) return { closed: false, started: false };
	const pid = await lockPid(profile);
	let windowGoneFor = 0;
	while (await profileLocked(profile)) {
		signal.throwIfAborted();
		// On macOS closing the last window does not quit Chrome, so the lock is
		// held by a process with no window at all — the first version waited on the
		// lock alone and hung until the owner force-quit. A process that has been
		// windowless for a few seconds is done signing in; the browser is closed
		// here rather than leaving the caller to discover why nothing progressed.
		const windows = pid ? windowCount(pid) : null;
		if (windows === 0) {
			windowGoneFor += 1000;
			if (windowGoneFor >= 4000) {
				const released = await quitProfile(profile);
				return {
					closed: released,
					started: true,
					...(released ? { notes: ["the browser was quit after its last window closed"] } : {}),
				};
			}
		} else windowGoneFor = 0;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	return { closed: true, started: true };
}

// "<host>-<pid>": the pid of the process holding the lock, or null when the
// link is not in that shape.
async function lockPid(profile: string): Promise<number | null> {
	try {
		const target = await readlink(join(profile, "SingletonLock"));
		const pid = Number(/-(\d+)$/.exec(target)?.[1]);
		return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

// How many windows the Chrome process has, as the OS reports it. Null means the
// question could not be asked (no accessibility permission, or not on macOS);
// callers treat null as "unknown" rather than "zero", because guessing zero would
// close a window the owner is still using.
function windowCount(pid: number): number | null {
	if (process.platform !== "darwin") return null;
	const script = `tell application "System Events" to tell (first process whose unix id is ${pid}) to count windows`;
	const result = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 3000 });
	if (result.status !== 0) return null;
	const count = Number(result.stdout.trim());
	return Number.isFinite(count) ? count : null;
}

// Ask the process holding the profile to quit. It quit itself once its window
// closed as far as the owner is concerned; this finishes the job.
async function quitProfile(profile: string): Promise<boolean> {
	// "quit" reaches an app with a window and silently does nothing to one that has
	// already closed its last window — the state this function exists to leave.
	// Matching the profile's own argument is what keeps this from touching another
	// Chrome: each instance has its own --user-data-dir. The `--` matters: without
	// it pkill reads the pattern as an option, matches nothing, and exits 0, so the
	// browser was never closed and the caller waited on a profile forever.
	spawnSync("pkill", ["-f", "--", `--user-data-dir=${profile}`], { timeout: 3000 });
	if (!(await waitForUnlock(profile, 3000))) {
		spawnSync("pkill", ["-9", "-f", "--", `--user-data-dir=${profile}`], { timeout: 3000 });
		return waitForUnlock(profile, 3000);
	}
	return true;
}

async function waitForUnlock(profile: string, timeout: number): Promise<boolean> {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (!(await profileLocked(profile))) return true;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	return false;
}

// SingletonLock is a symlink to "<host>-<pid>" whose target never exists as a
// file, so `access` — which follows the link — always reports it missing. That
// made every profile look unlocked, and a window that was still on screen was
// read as already closed. lstat asks whether the link itself is there.
//
// But the link outlives the process that made it: Chrome does not remove it on
// every exit path, and a forced quit definitely leaves it behind. Trusting the
// link alone made the command wait on a profile no process was using. The pid in
// the target is the part that says whether anyone still holds it.
async function profileLocked(profile: string): Promise<boolean> {
	const path = join(profile, "SingletonLock");
	try {
		const info = await lstat(path);
		if (!info.isSymbolicLink() && !info.isFile()) return false;
	} catch {
		return false;
	}
	const pid = await lockPid(profile);
	// A link with no pid in it is not the modern shape; the link alone is then
	// all there is to go on.
	if (pid === null) return true;
	return processAlive(pid);
}

function processAlive(pid: number): boolean {
	try {
		// Signal 0 asks the kernel whether the pid exists without delivering
		// anything. EPERM means it exists and belongs to someone else, which is
		// still alive for this purpose.
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
	}
}

export async function findChrome(explicit?: string): Promise<string> {
	const candidates: string[] = [];
	if (explicit) candidates.push(explicit);
	else {
		if (process.platform === "darwin")
			candidates.push(
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
				"/Applications/Chromium.app/Contents/MacOS/Chromium",
			);
		if (process.platform === "win32")
			for (const base of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA])
				if (base) candidates.push(join(base, "Google", "Chrome", "Application", "chrome.exe"));
		candidates.push("google-chrome", "google-chrome-stable", "chromium", "chromium-browser");
	}
	for (const candidate of candidates) {
		const paths = isAbsolute(candidate)
			? [candidate]
			: (process.env.PATH ?? "").split(delimiter).map((directory) => join(directory, candidate));
		for (const path of paths) {
			try {
				await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
				return path;
			} catch {
				/* Try the next executable. */
			}
		}
	}
	throw new CliError("chrome_not_found", "Google Chrome or Chromium was not found", {
		hint: "Install Chrome or pass --chrome /absolute/path/to/chrome.",
	});
}

async function version(port: number, signal: AbortSignal): Promise<Version> {
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new CliError("state_corrupt", "Invalid Chrome debugging port");
	const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
		redirect: "error",
	});
	if (!response.ok) throw new CliError("browser_unavailable", `Chrome returned HTTP ${response.status}`);
	return (await response.json()) as Version;
}

export class ChromeManager {
	readonly store: Store;
	readonly chrome?: string;

	constructor(store: Store, chrome?: string) {
		this.store = store;
		this.chrome = chrome;
	}

	async load(signal: AbortSignal): Promise<BrowserState> {
		const state = await this.store.read<BrowserState | null>("browser.json", null);
		if (!state)
			throw new CliError("browser_not_running", "No dedicated Chrome session", {
				hint: "Run x-cli auth login, or x-cli browser start after login.",
			});
		if (!Number.isInteger(state.port) || typeof state.websocket !== "string" || typeof state.headless !== "boolean")
			throw new CliError("state_corrupt", "Invalid browser session record");
		try {
			const current = await version(state.port, signal);
			if (
				current.webSocketDebuggerUrl !== state.websocket ||
				!state.websocket.startsWith(`ws://127.0.0.1:${state.port}/devtools/browser/`)
			)
				throw new Error("CDP identity mismatch");
		} catch (cause) {
			signal.throwIfAborted();
			throw new CliError("browser_not_running", "Dedicated Chrome is no longer reachable", {
				hint: "Run browser start. The login profile will be reused.",
				cause,
			});
		}
		return state;
	}

	async start(signal: AbortSignal, headless?: boolean): Promise<BrowserState> {
		const config = await this.store.config();
		const desired = headless ?? config.headless ?? false;
		try {
			const state = await this.load(signal);
			if (state.headless !== desired)
				throw new CliError("invalid_argument", "Chrome is running in a different display mode", {
					hint: "Run browser stop before changing --headless.",
				});
			return state;
		} catch (error) {
			if (!(error instanceof CliError) || error.code !== "browser_not_running") throw error;
		}
		const executable = await findChrome(this.chrome ?? config.chrome ?? process.env.X_CLI_CHROME_PATH);
		const profile = this.store.path("chrome");
		await mkdir(profile, { recursive: true, mode: 0o700 });
		const portFile = join(profile, "DevToolsActivePort");
		try {
			const recovered = await this.fromPortFile(portFile, signal);
			if (recovered.headless !== desired)
				throw new CliError("invalid_argument", "Recovered Chrome is running in a different display mode");
			await this.store.write("browser.json", recovered);
			return recovered;
		} catch (error) {
			if (error instanceof CliError && error.code === "invalid_argument") throw error;
			signal.throwIfAborted();
		}
		try {
			await unlink(portFile);
		} catch (error) {
			if (!isMissing(error)) throw error;
		}
		const proxy = config.proxy ?? process.env.X_CLI_PROXY;
		const args = [
			`--user-data-dir=${profile}`,
			"--remote-debugging-address=127.0.0.1",
			"--remote-debugging-port=0",
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-background-timer-throttling",
			"--disable-renderer-backgrounding",
			"--window-size=1440,1000",
			// X refuses some requests without a normal-looking locale, and a fresh
			// profile starts with the system one.
			"--lang=en-US",
			...(proxy ? [`--proxy-server=${proxy}`] : []),
			...(desired ? ["--headless=new", "--mute-audio"] : []),
			"about:blank",
		];
		const log = await open(this.store.path("chrome.log"), "a", 0o600);
		const child = spawn(executable, args, { detached: true, windowsHide: desired, stdio: ["ignore", log.fd, log.fd] });
		try {
			await once(child, "spawn");
		} catch (cause) {
			throw new CliError("browser_unavailable", "Could not start Chrome", { cause });
		} finally {
			await log.close();
		}
		child.unref();
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			signal.throwIfAborted();
			try {
				const state = await this.fromPortFile(portFile, signal);
				state.pid = child.pid ?? 0;
				state.headless = desired;
				await this.store.write("browser.json", state);
				return state;
			} catch {
				signal.throwIfAborted();
			}
			if (child.exitCode !== null) break;
			await delay(150, undefined, { signal });
		}
		throw new CliError("browser_unavailable", "Chrome did not expose a debugging endpoint", {
			hint: `Inspect ${this.store.path("chrome.log")}. Do not delete an active Chrome profile lock.`,
		});
	}

	private async fromPortFile(path: string, signal: AbortSignal): Promise<BrowserState> {
		const [rawPort, endpoint] = (await readFile(path, "utf8")).trim().split(/\s+/);
		const port = Number(rawPort);
		const info = await version(port, signal);
		const websocket = `ws://127.0.0.1:${port}${endpoint}`;
		if (!endpoint?.startsWith("/devtools/browser/") || info.webSocketDebuggerUrl !== websocket)
			throw new CliError("browser_unavailable", "Chrome endpoint identity did not match the dedicated profile");
		return {
			pid: 0,
			port,
			websocket,
			headless: !!info["User-Agent"]?.includes("HeadlessChrome"),
			started_at: new Date().toISOString(),
		};
	}

	async connect(signal: AbortSignal, timeout = 30_000): Promise<Session> {
		const state = await this.load(signal);
		const browser = await chromium.connectOverCDP(state.websocket, { timeout });
		const session = new Session(browser, signal);
		try {
			const context = browser.contexts()[0];
			if (!context) throw new CliError("browser_unavailable", "Chrome has no default browser context");
			const identify = async (page: Page) => {
				const cdp = await context.newCDPSession(page);
				try {
					return (await cdp.send("Target.getTargetInfo")).targetInfo.targetId;
				} finally {
					await cdp.detach();
				}
			};
			// The tab this tool owns is remembered by target id, so a tab the owner
			// opened by hand is never driven instead.
			if (state.target_id)
				for (const page of context.pages())
					if ((await identify(page)) === state.target_id) {
						session.page = page;
						break;
					}
			if (!session.page) {
				const cdp = await browser.newBrowserCDPSession();
				const created = await cdp.send("Target.createTarget", { url: "about:blank" });
				await cdp.detach();
				const deadline = Date.now() + 3000;
				while (!session.page && Date.now() < deadline) {
					signal.throwIfAborted();
					for (const page of context.pages())
						if ((await identify(page)) === created.targetId) {
							session.page = page;
							break;
						}
					if (!session.page) await delay(50, undefined, { signal });
				}
				if (!session.page) throw new CliError("browser_unavailable", "Could not attach to the owned tab");
				state.target_id = created.targetId;
				await this.store.write("browser.json", state);
			}
			session.page.setDefaultTimeout(timeout);
			session.page.setDefaultNavigationTimeout(timeout);
			return session;
		} catch (error) {
			await session.close();
			throw error;
		}
	}

	async stop(signal: AbortSignal): Promise<void> {
		const state = await this.load(signal);
		const browser = await chromium.connectOverCDP(state.websocket, { timeout: 5000 });
		try {
			const cdp = await browser.newBrowserCDPSession();
			await cdp.send("Browser.close");
		} catch {
			/* Closing Chrome may disconnect before its response. */
		} finally {
			await browser.close().catch(() => undefined);
		}
		for (let attempt = 0; attempt < 20; attempt++) {
			try {
				await this.load(signal);
			} catch (error) {
				if (error instanceof CliError && error.code === "browser_not_running") {
					await unlink(this.store.path("browser.json")).catch(() => undefined);
					return;
				}
				throw error;
			}
			await delay(100, undefined, { signal });
		}
		throw new CliError("browser_unavailable", "Chrome is still running after the close request");
	}
}

let adapter: string | undefined;

export class Session {
	readonly browser: Browser;
	readonly signal: AbortSignal;
	page?: Page;
	private readonly aborted: () => void;

	constructor(browser: Browser, signal: AbortSignal) {
		this.browser = browser;
		this.signal = signal;
		this.aborted = () => {
			void browser.close().catch(() => undefined);
		};
		signal.addEventListener("abort", this.aborted, { once: true });
	}

	get tab(): Page {
		this.signal.throwIfAborted();
		if (!this.page) throw new CliError("browser_unavailable", "No owned tab is attached");
		return this.page;
	}

	async call<T = unknown>(operation: string, args: object = {}): Promise<T> {
		this.signal.throwIfAborted();
		adapter ??= await readFile(new URL("../dist/page-adapter.js", import.meta.url), "utf8");
		const wire = await this.tab.evaluate<{ data?: T; error?: { code: string; message: string; hint?: string } }>(
			`(() => {\n//# sourceURL=x-cli-page-adapter.js\n${adapter}\nreturn XPage.call(${JSON.stringify(operation)}, ${JSON.stringify(args)});\n})()`,
		);
		if (wire.error) throw new CliError(wire.error.code, wire.error.message, { hint: wire.error.hint });
		return wire.data as T;
	}

	async status(): Promise<Snapshot> {
		return this.call<Snapshot>("status");
	}

	async click(point: Point): Promise<void> {
		if (point.already) return;
		// The page measured the control and marked it, so the press is aimed at the
		// element rather than at a coordinate from an earlier frame. A locator click
		// re-checks the position at press time.
		if (point.selector) {
			await this.tab
				.locator(point.selector)
				.click({ timeout: 5000 })
				.catch((error: unknown) => {
					throw new CliError("selector_changed", "The marked control could not be clicked", { cause: error });
				});
			return;
		}
		if (point.x === undefined || point.y === undefined)
			throw new CliError("selector_changed", "No verified click point");
		await this.tab.mouse.click(point.x, point.y);
	}

	async close(): Promise<void> {
		this.signal.removeEventListener("abort", this.aborted);
		await this.browser.close().catch(() => undefined);
	}
}
