import { readFile } from "node:fs/promises";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { App, type AppOptions } from "./app.ts";
import { COMMANDS, type CommandSpec, GLOBAL_FLAGS, GROUPS, schema } from "./catalog.ts";
import { CliError, errorData, errorExit, normalizeError } from "./errors.ts";
import type { Input } from "./operations/validate.ts";
import { progressTo } from "./progress.ts";

export interface Streams {
	stdout: { write: (text: string) => unknown };
	stderr: { write: (text: string) => unknown };
}

interface Globals {
	stateDir?: string;
	chrome?: string;
	format: string;
	timeout: number;
	requestId?: string;
	dryRun?: boolean;
	progress?: boolean;
}

function number(value: string): number {
	if (!value.trim() || !Number.isFinite(Number(value))) throw new InvalidArgumentError("Expected a finite number");
	return Number(value);
}

function boolean(value: string): boolean {
	if (value !== "true" && value !== "false") throw new InvalidArgumentError("Expected true or false");
	return value === "true";
}

export function createProgram(io: Streams, parentSignal?: AbortSignal, version = ""): Command {
	const root = new Command("xx");
	root.description("x-cli — operate X from the command line: read a conversation, post a reply, keep a receipt");
	root.version(version, "-v, --version", "Print the version");
	root.exitOverride().showHelpAfterError(false);
	root.configureOutput({
		writeOut: (value) => io.stdout.write(value),
		writeErr: () => undefined,
		outputError: () => undefined,
	});
	for (const flag of GLOBAL_FLAGS) {
		const option = new Option(flag.name, flag.description);
		if ("default" in flag) option.default(flag.default);
		if (flag.name.startsWith("--timeout")) option.argParser(number);
		root.addOption(option);
	}
	const options = (command: Command): { app: AppOptions; globals: Globals } => {
		const globals = command.optsWithGlobals<Globals>();
		if (!["json", "pretty"].includes(globals.format))
			throw new CliError("invalid_argument", "--format must be json or pretty");
		if (!Number.isFinite(globals.timeout) || globals.timeout < 0.1 || globals.timeout > 3600)
			throw new CliError("invalid_argument", "--timeout must be 0.1..3600 seconds");
		return {
			globals,
			app: {
				state_dir: globals.stateDir,
				chrome: globals.chrome,
				timeout: globals.timeout * 1000,
			},
		};
	};
	const output = (data: unknown, globals: Globals) =>
		io.stdout.write(
			`${JSON.stringify({ ok: true, ...(globals.dryRun ? { dry_run: true } : {}), data }, null, globals.format === "pretty" ? 2 : undefined)}\n`,
		);
	const groups = new Map<string, Command>();
	for (const spec of COMMANDS) {
		const [group, leaf] = spec.id.split(".");
		let owner = root;
		if (leaf) {
			let command = groups.get(group);
			if (!command) {
				command = root.command(group).description(GROUPS[group] ?? `${group} operations`);
				// A bare group name asks what is in it. Without an action Commander
				// treats it as a usage error and exits through its own help path.
				command.action((_local: unknown, self: Command) => self.help());
				groups.set(group, command);
			}
			owner = command;
		}
		const command = owner.command(leaf ?? group).description(spec.description);
		if (spec.argument)
			command.argument(
				spec.argument.optional ? `[${spec.argument.name}]` : `<${spec.argument.name}>`,
				spec.argument.description,
			);
		for (const flag of spec.flags ?? []) {
			const option = new Option(flag.name, flag.description);
			if (flag.default !== undefined) option.default(flag.default);
			if (flag.required) option.makeOptionMandatory();
			if (flag.type === "number") option.argParser(number);
			if (flag.type === "boolean-value") option.argParser(boolean);
			command.addOption(option);
		}
		if (spec.guidance) command.addHelpText("after", `\n${spec.guidance}\n${(spec.examples ?? []).join("\n")}`);
		command.action(async (...values: unknown[]) => {
			const { app: appOptions, globals } = options(command);
			const input: Input = { dry_run: globals.dryRun, request_id: globals.requestId };
			const local = command.opts<Record<string, unknown>>();
			for (const flag of spec.flags ?? []) {
				const option = new Option(flag.name);
				const value = local[option.attributeName()];
				if (value === undefined) continue;
				Object.assign(input, { [flag.key]: value });
			}
			if (spec.argument) Object.assign(input, { [spec.argument.key]: values[0] });
			const signal = AbortSignal.any([
				...(parentSignal ? [parentSignal] : []),
				AbortSignal.timeout(appOptions.timeout ?? 45_000),
			]);
			// Progress goes to stderr so stdout keeps exactly one envelope.
			const app = new App(
				globals.progress ? { ...appOptions, progress: progressTo((line) => io.stderr.write(line)) } : appOptions,
			);
			try {
				output(await app.execute(spec.id, input, signal), globals);
			} catch (error) {
				if (signal.aborted && !(error instanceof CliError && error.code === "delivery_uncertain")) throw signal.reason;
				throw error;
			}
		});
	}
	root
		.command("schema")
		.description("Describe commands, flags, effects and output contracts as JSON")
		.argument("[command...]", "Command path, e.g. comment post")
		.action((path: string[], _local: unknown, command: Command) => {
			const { globals } = options(command);
			const result = schema(path.length ? path.join(".") : undefined);
			if (!result.commands.length) throw new CliError("invalid_argument", "Unknown schema command");
			output(result, globals);
		});
	root.action(() => root.help());
	return root;
}

export async function run(
	args: string[],
	io: Streams = { stdout: process.stdout, stderr: process.stderr },
	signal?: AbortSignal,
): Promise<number> {
	try {
		await createProgram(io, signal, await packageVersion()).parseAsync(args, { from: "user" });
		return 0;
	} catch (error) {
		if (error instanceof CommanderError && error.exitCode === 0) return 0;
		const problem =
			error instanceof CommanderError ? new CliError("invalid_argument", error.message) : normalizeError(error);
		io.stderr.write(`${JSON.stringify({ ok: false, error: errorData(problem) })}\n`);
		return errorExit(problem);
	}
}

// Kept separate from argument parsing so packaging tests can verify the published bin.
export async function packageVersion(): Promise<string> {
	const data: unknown = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	return typeof data === "object" && data !== null && "version" in data ? String(data.version) : "";
}

export function commandByID(id: string): CommandSpec | undefined {
	return COMMANDS.find((command) => command.id === id);
}
