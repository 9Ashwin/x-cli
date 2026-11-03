import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CliError, isMissing } from "./errors.ts";
import { withLease } from "./lease.ts";

export interface BrowserConfig {
	chrome?: string;
	headless?: boolean;
	// Whether a write may publish without being shown first. Off by default: the
	// first send of anything that goes out in this account's name is refused and
	// returned with its text, and only a run that has seen that text sends.
	//
	// This lives here rather than in a file the agent keeps, because it is a
	// decision about who may speak for this account, and it belongs to whoever
	// runs the machine. It is one flag rather than a per-target grant: a switch
	// that says "this account may publish without a look" is honest about how
	// much it gives away, and easy to turn back off.
	review?: boolean;
	// X is unreachable without a proxy from some networks. Chrome can use the
	// system proxy, but the state of a machine the tool runs on is not something
	// a command should have to guess about, so it can be stated once here.
	proxy?: string;
}

export interface Event {
	id: string;
	at: string;
	operation: string;
	data: unknown;
}

export type ReceiptStatus = "prepared" | "dispatching" | "confirmed" | "not_sent";

export interface Receipt {
	request_id: string;
	fingerprint: string;
	operation: string;
	status: ReceiptStatus;
	created_at: string;
	updated_at: string;
	result?: unknown;
	uncertainty_reason?: string;
	observation?: {
		candidate_id: string | null;
		kind: "matching_loaded_row" | "toast_only";
		loaded_matching_rows: number;
		delivery_verified: boolean;
	};
	target?: { tweet_id?: string; comment_id?: string };
}

// The environment variable is read first, then the new directory, then the name
// the tool used before it was renamed. Keeping the old one working means an
// installed sign-in and history survive the rename instead of silently starting
// empty — a tool that loses its receipt log on upgrade loses the thing it is for.
export function stateDirectory(): string {
	if (process.env.XX_STATE_DIR) return resolve(process.env.XX_STATE_DIR);
	if (process.env.X_CLI_STATE_DIR) return resolve(process.env.X_CLI_STATE_DIR);
	const legacy = join(homedir(), ".x-cli");
	const current = join(homedir(), ".xx");
	return existsSync(legacy) && !existsSync(current) ? legacy : current;
}

export async function atomicWrite(path: string, data: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		const file = await open(temporary, "wx", 0o600);
		try {
			await file.writeFile(data);
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(temporary, path);
		await chmod(path, 0o600);
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
}

export class Store {
	readonly base: string;

	constructor(base = stateDirectory()) {
		this.base = resolve(base);
	}

	path(name: string): string {
		return join(this.base, name);
	}

	async read<T>(name: string, fallback: T): Promise<T> {
		try {
			return JSON.parse(await readFile(this.path(name), "utf8")) as T;
		} catch (error) {
			if (isMissing(error)) return fallback;
			if (error instanceof SyntaxError)
				throw new CliError("state_corrupt", `Invalid JSON in ${name}`, {
					hint: "The file has been preserved. Back it up before repairing it.",
					cause: error,
				});
			throw error;
		}
	}

	async write(name: string, value: unknown): Promise<void> {
		await atomicWrite(this.path(name), `${JSON.stringify(value, null, 2)}\n`);
	}

	async config(): Promise<BrowserConfig> {
		const value = await this.read<BrowserConfig>("config.json", {});
		if (
			!value ||
			typeof value !== "object" ||
			(value.chrome !== undefined && typeof value.chrome !== "string") ||
			(value.headless !== undefined && typeof value.headless !== "boolean") ||
			(value.proxy !== undefined && typeof value.proxy !== "string") ||
			(value.review !== undefined && typeof value.review !== "boolean")
		)
			throw new CliError("state_corrupt", "Invalid browser config");
		return value;
	}

	// One command drives the owned tab at a time. A second command waits for the
	// lease rather than interleaving keystrokes with the first one's composer.
	async withLease<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
		return withLease(this.path("operation"), run);
	}

	async events(): Promise<Event[]> {
		let text: string;
		try {
			text = await readFile(this.path("history.jsonl"), "utf8");
		} catch (error) {
			if (isMissing(error)) return [];
			throw error;
		}
		return text
			.split("\n")
			.filter(Boolean)
			.map((line, index) => {
				try {
					const event = JSON.parse(line) as Event;
					if (!event.id || !event.at || !event.operation || Number.isNaN(Date.parse(event.at)))
						throw new Error("Invalid event");
					return event;
				} catch (cause) {
					throw new CliError("state_corrupt", `Invalid history record at line ${index + 1}`, { cause });
				}
			});
	}

	async append(operation: string, data: unknown): Promise<Event> {
		const event = { id: randomUUID(), at: new Date().toISOString(), operation, data };
		await appendFile(this.path("history.jsonl"), `${JSON.stringify(event)}\n`, { mode: 0o600, flush: true });
		return event;
	}

	async receipts(): Promise<Record<string, Receipt>> {
		const receipts = await this.read<Record<string, Receipt>>("receipts.json", {});
		if (!receipts || typeof receipts !== "object" || Array.isArray(receipts))
			throw new CliError("state_corrupt", "Invalid receipts file");
		for (const receipt of Object.values(receipts)) {
			if (
				!receipt ||
				!receipt.request_id ||
				!receipt.fingerprint ||
				!["prepared", "dispatching", "confirmed", "not_sent"].includes(receipt.status)
			)
				throw new CliError("state_corrupt", "Invalid receipt record");
		}
		return receipts;
	}

	async saveReceipt(receipt: Receipt): Promise<void> {
		const receipts = await this.receipts();
		Object.defineProperty(receipts, receipt.request_id, {
			value: receipt,
			enumerable: true,
			configurable: true,
			writable: true,
		});
		await this.write("receipts.json", receipts);
	}

	async receipt(requestID: string): Promise<Receipt> {
		const receipts = await this.receipts();
		const receipt = Object.hasOwn(receipts, requestID) ? receipts[requestID] : undefined;
		if (!receipt) throw new CliError("not_found", "Receipt not found for this request ID");
		return receipt;
	}
}
