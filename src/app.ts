import { readFile } from "node:fs/promises";
import { ChromeManager, findChrome, openWithoutDebugging } from "./browser.ts";
import { COMMANDS } from "./catalog.ts";
import { CliError } from "./errors.ts";
import { authStatus, openLogin } from "./operations/auth.ts";
import { getComment, listComments, scrollConversation } from "./operations/comments.ts";
import { requireSignedIn } from "./operations/navigation.ts";
import { measurePace, pacePrompt } from "./operations/pace.ts";
import { readSearch, readTimeline } from "./operations/sources.ts";
import { getStatus } from "./operations/thread.ts";
import { authorOf, type Input, isWrite, statusID, validateTarget, validateText } from "./operations/validate.ts";
import { send } from "./operations/write.ts";
import type { Reproduce } from "./progress.ts";
import { type BrowserConfig, Store } from "./store.ts";

export interface AppOptions {
	chrome?: string;
	state_dir?: string;
	timeout?: number;
	progress?: Reproduce;
}

// The App owns the store and the browser and dispatches. Every operation body
// lives in src/operations/ so this class stays a dispatcher.
export class App {
	readonly store: Store;
	readonly chrome: ChromeManager;
	readonly timeout: number;
	readonly options: AppOptions;

	constructor(options: AppOptions = {}) {
		this.options = options;
		this.store = new Store(options.state_dir);
		this.chrome = new ChromeManager(this.store, options.chrome);
		this.timeout = options.timeout ?? 45_000;
	}

	async execute(operation: string, raw: Input = {}, signal = AbortSignal.timeout(this.timeout)): Promise<unknown> {
		const input = await this.readText(raw);
		const id = statusID(input.status_id ?? input.resource);
		if (operation === "comment.post" || operation === "comment.reply") {
			input.text = validateText(input.text ?? input.text_file, operation);
			validateTarget(operation, input);
		}
		if (["comment.list", "comment.get", "thread.get"].includes(operation)) validateTarget("comment.list", input);
		if (!COMMANDS.some((command) => command.id === operation))
			throw new CliError("invalid_argument", `Unknown command: ${operation}`);
		signal.throwIfAborted();

		// Local commands never open Chrome, so their dry run runs them.
		const local = await this.local(operation, input, signal);
		if (local !== undefined) return local;
		if (input.dry_run) return this.plan(operation, input, id);
		if (operation === "auth.login" && input.manual) return this.manualLogin(signal);

		// A run of replies stops here and asks. This is a prompt, not a gate: it
		// reads the local history, says how many were made and in what window, and
		// does nothing unless the caller repeats the command with --confirm.
		if (isWrite(operation) && !input.confirm) {
			const pace = measurePace(await this.store.events());
			if (pace.over) return pacePrompt(pace, operation === "comment.reply" ? "reply" : "post");
		}

		return this.store.withLease((leaseSignal) =>
			this.dispatch(operation, input, id ?? "", AbortSignal.any([signal, leaseSignal])),
		);
	}

	private async dispatch(operation: string, input: Input, id: string, signal: AbortSignal): Promise<unknown> {
		const session = await this.chrome.connect(signal, this.timeout);
		try {
			switch (operation) {
				case "auth.login":
					return await openLogin(session);
				case "auth.status":
				case "status":
					return await authStatus(session);
			}
			// Reads may run signed out so the caller learns what is wrong from the
			// page rather than from a failed navigation; writes require a session.
			if (isWrite(operation)) await requireSignedIn(session);
			switch (operation) {
				case "comment.list":
					return await listComments(session, input, id, signal);
				case "comment.get":
					return await getComment(session, input, id, statusID(input.comment_id) ?? "", signal);
				case "comment.post":
				case "comment.reply":
					return await send(operation, input, signal, {
						store: this.store,
						chrome: this.chrome,
						timeout: this.timeout,
						progress: this.options.progress,
					});
				case "comment.scroll":
					return await scrollConversation(session, input.pixels ?? 900);
				case "timeline.read":
					return await readTimeline(session, input, signal);
				case "thread.list":
					return await readSearch(session, input, signal);
				case "thread.get":
					return await getStatus(session, id, signal, authorOf(input));
				default:
					throw new CliError("invalid_argument", `Unknown command: ${operation}`);
			}
		} finally {
			await session.close();
		}
	}

	// A sign-in that must survive Google's refusal of automation.
	//
	// Google refuses its sign-in inside a browser started with a debugging port,
	// and every other command needs that port. The two cannot be the same
	// process, so this closes the CDP browser, opens the same profile without
	// CDP, and waits for the owner to finish and close it. The cookies it writes
	// are the profile's, so the next command connects to a signed-in profile.
	private async manualLogin(signal: AbortSignal): Promise<unknown> {
		const config = await this.store.config();
		const executable = await findChrome(this.options.chrome ?? config.chrome ?? process.env.X_CLI_CHROME_PATH);
		await this.chrome.stop(signal).catch((error: unknown) => {
			// No browser running is the normal case for a first sign-in.
			if (!(error instanceof CliError) || error.code !== "browser_not_running") throw error;
		});
		const profile = this.store.path("chrome");
		const result = await openWithoutDebugging(executable, profile, "https://x.com/i/flow/login", signal);
		// The session is read back through the normal path rather than trusted
		// from the window: a sign-in that was abandoned half way looks the same
		// from here as one that finished.
		//
		// `browser start`, not `connect`: stop() removed the session record when it
		// closed the automation browser, so there is nothing to connect to. This is
		// the same profile, so starting it again is the sign-in the owner just did.
		await this.chrome.start(signal, false);
		const session = await this.chrome.connect(signal, this.timeout);
		try {
			await session.tab.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
			const page = await session.status();
			return {
				status: page.login_required ? "still_signed_out" : "signed_in",
				closed: result.closed,
				account: page.account,
				next: page.login_required
					? "The sign-in did not complete. Run x-cli auth login --manual again."
					: "Signed in. Run x-cli auth status to confirm.",
			};
		} finally {
			await session.close();
		}
	}

	private async local(operation: string, input: Input, signal: AbortSignal): Promise<unknown> {
		switch (operation) {
			case "browser.configure": {
				const config: BrowserConfig = {
					...(await this.store.config()),
					...(input.chrome === undefined ? {} : { chrome: input.chrome }),
					...(input.headless === undefined ? {} : { headless: input.headless }),
					...(input.proxy === undefined ? {} : { proxy: input.proxy }),
				};
				await this.store.write("config.json", config);
				return config;
			}
			case "browser.config":
				return this.store.config();
			case "browser.start":
				return publicBrowser(await this.chrome.start(signal, input.headless));
			case "browser.status":
				try {
					return publicBrowser(await this.chrome.load(signal));
				} catch (error) {
					if (error instanceof CliError && error.code === "browser_not_running") return { running: false };
					throw error;
				}
			case "browser.stop":
				await this.chrome.stop(signal);
				return { stopped: true };
			case "receipt.get": {
				if (!input.request_id) throw new CliError("invalid_argument", "A request ID is required");
				return this.store.receipt(input.request_id);
			}
			case "history.list": {
				const events = await this.store.events();
				const limit = Math.min(Math.max(input.limit ?? 50, 1), 1000);
				return { items: events.slice(-limit).reverse(), count: events.length };
			}
			case "clean":
				return cleanProfile(this.store);
			default:
				return undefined;
		}
	}

	private plan(operation: string, input: Input, id: string | null) {
		return {
			operation,
			input: { ...input, status_id: id ?? input.status_id },
			effect: isWrite(operation)
				? "account_write"
				: operation.startsWith("browser.") || operation === "auth.login"
					? "browser_lifecycle"
					: COMMANDS.find((command) => command.id === operation)?.effect === "local"
						? "local"
						: "read_or_navigation",
			executed: false,
		};
	}

	// Text from a file or stdin is read here rather than in every handler, and a
	// file is refused when it is not UTF-8 text: a binary picked by mistake would
	// otherwise be typed into a public composer.
	private async readText(raw: Input): Promise<Input> {
		if (raw.text_file === undefined) return { ...raw };
		let text: string;
		if (raw.text_file === "-") {
			const chunks: Buffer[] = [];
			for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
			text = Buffer.concat(chunks).toString("utf8");
		} else text = await readFile(raw.text_file, "utf8");
		const resolved: Input = { ...raw, text };
		delete resolved.text_file;
		return resolved;
	}
}

function publicBrowser(state: { pid: number; port: number; headless: boolean; started_at: string }) {
	return { running: true, pid: state.pid, port: state.port, headless: state.headless, started_at: state.started_at };
}

// The profile is a real Chrome profile, and X's caches grow without bound: a few
// weeks of browsing reached several gigabytes of images and code. Only cache and
// shader directories are removed, because deleting the rest would also delete
// the sign-in.
async function cleanProfile(store: Store): Promise<unknown> {
	const state = await store.read<{ pid?: number } | null>("browser.json", null);
	if (state?.pid) {
		try {
			process.kill(state.pid, 0);
			throw new CliError("state", "Chrome is running, so its caches cannot be removed", {
				hint: "Run browser stop first. The profile and sign-in are kept either way.",
			});
		} catch (error) {
			if (error instanceof CliError) throw error;
			// ESRCH: the process is gone and its files are ours to remove.
		}
	}
	const { rm, readdir, stat } = await import("node:fs/promises");
	const { join } = await import("node:path");
	const profile = store.path("chrome");
	const names = [
		"Cache",
		"Code Cache",
		"GPUCache",
		"DawnCache",
		"ShaderCache",
		"GrShaderCache",
		"Service Worker/CacheStorage",
	];
	let freed = 0;
	const removed: string[] = [];
	for (const name of names) {
		const path = join(profile, name);
		try {
			freed += await size(path);
			await rm(path, { recursive: true, force: true });
			removed.push(name);
		} catch {
			// A cache directory that is not there needs no removing.
		}
	}
	async function size(path: string): Promise<number> {
		const info = await stat(path).catch(() => null);
		if (!info) return 0;
		if (info.isFile()) return info.size;
		if (!info.isDirectory()) return 0;
		let total = 0;
		for (const entry of await readdir(path).catch(() => [])) total += await size(join(path, entry));
		return total;
	}
	return {
		removed,
		freed_mb: Math.round(freed / 1024 / 1024),
		kept: ["Cookies", "Local Storage", "Network", "Preferences"],
	};
}
