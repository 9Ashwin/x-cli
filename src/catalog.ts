import type { Input } from "./operations/validate.ts";

export interface Flag {
	key: keyof Input;
	name: string;
	description: string;
	type: "string" | "number" | "boolean" | "boolean-value";
	default?: string | number | boolean;
	required?: boolean;
}

export interface CommandSpec {
	id: string;
	description: string;
	argument?: { key: keyof Input; name: string; description: string; optional?: boolean };
	flags?: Flag[];
	effect: "read" | "navigation" | "local" | "account_write";
	guidance?: string;
	examples?: string[];
}

// What a group command is for, in the words someone scanning the top-level help
// needs. Without this every group said "<name> operations", which tells a caller
// nothing about where to look.
export const GROUPS: Record<string, string> = {
	browser: "Start, stop and configure the dedicated Chrome",
	auth: "Show the sign-in state and open the login window",
	status: "Read the page and the signed-in account",
	timeline: "Read the posts the home timeline has rendered",
	thread: "Read one status by id, or a search's results",
	comment: "Read a conversation and post a reply",
	receipt: "Inspect a persisted write receipt",
	history: "Read local operation facts",
};

const statusFlag: Flag = {
	key: "status_id",
	name: "--status <url-or-id>",
	description: "Status URL or numeric status ID",
	type: "string",
	required: true,
};
const text: Flag = { key: "text", name: "--text <text>", description: "Exact text to post", type: "string" };
// Answering the pace prompt. Not a permission: the prompt is a pause to look at
// a count, and this says the caller looked.
const paceConfirm: Flag = {
	key: "confirm",
	name: "--confirm",
	description: "Send despite the posting-pace prompt",
	type: "boolean",
};
const textFile: Flag = {
	key: "text_file",
	name: "--text-file <path>",
	description: "Read UTF-8 text from a file, or - for stdin",
	type: "string",
};

export const COMMANDS: CommandSpec[] = [
	{
		id: "browser.start",
		description: "Start the dedicated Chrome, or report the one that is running",
		flags: [
			{
				key: "headless",
				name: "--headless <boolean>",
				description: "Run without a window: true or false",
				type: "boolean-value",
			},
		],
		effect: "local",
		guidance:
			"The profile lives in the state directory, so a sign-in done once survives restarts. X refuses headless sessions more often than a visible window, so a headless browser that reports login_required may simply need --headless false.",
	},
	{
		id: "browser.stop",
		description: "Close the dedicated Chrome",
		effect: "local",
	},
	{
		id: "browser.status",
		description: "Report the dedicated Chrome session, if one is running",
		effect: "local",
	},
	{
		id: "browser.configure",
		description: "Set the Chrome executable, display mode or proxy",
		flags: [
			{ key: "chrome", name: "--chrome <path>", description: "Chrome executable path", type: "string" },
			{
				key: "headless",
				name: "--headless <boolean>",
				description: "Default display mode: true or false",
				type: "boolean-value",
			},
			{
				key: "proxy",
				name: "--proxy <url>",
				description: "Proxy server for the browser, e.g. http://127.0.0.1:7890",
				type: "string",
			},
		],
		effect: "local",
		guidance: "X is unreachable on some networks without a proxy. Set it once; browser start passes it to Chrome.",
	},
	{
		id: "browser.config",
		description: "Show the stored browser configuration",
		effect: "local",
	},
	{
		id: "auth.login",
		description: "Open X's login page in headed Chrome and wait for the owner to sign in",
		flags: [
			{
				key: "manual",
				name: "--manual",
				description: "Sign in through the same profile with the debugging port off",
				type: "boolean",
			},
		],
		effect: "navigation",
		guidance:
			'The tool never types credentials. Complete the form in Chrome; the dedicated profile keeps the session for every later command. Run auth status afterwards.\n\nSigning in with Google is refused in a browser started for automation and shows "this browser or app may not be secure". Use --manual for that: it closes the automation browser, opens the same profile without a debugging port, waits until you close it, and then reads the session back.',
	},
	{
		id: "auth.status",
		description: "Report whether the owned tab is signed in, and as whom",
		effect: "read",
		flags: [
			{ key: "include_text", name: "--include-text", description: "Include the visible page text", type: "boolean" },
		],
	},
	{
		id: "status",
		description: "Read the owned tab: page kind, URL, account and open status",
		flags: [
			{ key: "include_text", name: "--include-text", description: "Include the visible page text", type: "boolean" },
		],
		effect: "read",
	},
	{
		id: "timeline.read",
		description: "Read the posts the home timeline has rendered",
		flags: [
			{ key: "limit", name: "--limit <count>", description: "Maximum posts returned (default 20)", type: "number" },
			{
				key: "scrolls",
				name: "--scrolls <count>",
				description: "Additional timeline scrolls to load more",
				type: "number",
				default: 0,
			},
		],
		effect: "navigation",
		guidance:
			"Promoted posts are excluded from items and counted in limits. scope=loaded_dom and complete=false mean this is what the page rendered, not the whole timeline. The ids returned are accepted directly by comment post --status. This command never selects a target or writes anything: reading and replying are separate, and the decision between them is the caller's.",
		examples: ["x-cli timeline read --limit 20 --scrolls 2"],
	},
	{
		id: "thread.get",
		description: "Read one status by id or URL, without its replies",
		flags: [statusFlag],
		effect: "navigation",
		guidance:
			"Returns the status itself. Use comment list for the conversation under it. A deleted or protected status is not_found rather than an empty object.",
		examples: ["x-cli thread get --status https://x.com/handle/status/1234567890"],
	},
	{
		id: "thread.list",
		description: "Read the posts a search has rendered",
		flags: [
			{
				key: "query",
				name: "--query <text>",
				description: "Search text; X's own query syntax is accepted",
				type: "string",
				required: true,
			},
			{ key: "limit", name: "--limit <count>", description: "Maximum posts returned (default 20)", type: "number" },
			{
				key: "scrolls",
				name: "--scrolls <count>",
				description: "Additional scrolls to load more",
				type: "number",
				default: 0,
			},
		],
		effect: "navigation",
		guidance:
			"Uses the Latest tab: results in the order X served them, not by engagement. No results is an answer, not a failure; a rate limit is reported as unsupported_page. Same item shape as timeline read, and the same rule: this never chooses a target or posts.",
		examples: ['x-cli thread list --query "AI agent" --limit 20'],
	},
	{
		id: "comment.list",
		description: "Read the replies loaded under a status",
		flags: [
			statusFlag,
			{ key: "limit", name: "--limit <count>", description: "Maximum replies returned (default 20)", type: "number" },
			{
				key: "scrolls",
				name: "--scrolls <count>",
				description: "Additional conversation scrolls to load replies",
				type: "number",
				default: 0,
			},
		],
		effect: "navigation",
		guidance:
			"scope=loaded_dom and complete=false mean this is a bounded view of what the page rendered, not the whole thread. An empty list means nothing loaded, not that nobody replied.",
		examples: ["x-cli comment list --status https://x.com/handle/status/1234567890 --limit 30 --scrolls 3"],
	},
	{
		id: "comment.get",
		description: "Read one reply plus the status it answers",
		flags: [
			statusFlag,
			{
				key: "comment_id",
				name: "--comment-id <id>",
				description: "Reply status ID from comment list",
				type: "string",
				required: true,
			},
			{
				key: "scrolls",
				name: "--scrolls <count>",
				description: "Conversation scrolls allowed while looking for it",
				type: "number",
				default: 2,
			},
		],
		effect: "navigation",
	},
	{
		id: "comment.post",
		description: "Reply to a status",
		flags: [statusFlag, text, textFile, paceConfirm],
		effect: "account_write",
		guidance:
			"Requires --text or --text-file and --request-id. The reply target is proved from the composer's own reply state before the post button is pressed; a composer that is not in reply mode is refused rather than posted publicly. Delivery is reported only from a success toast or a new row, and a press with neither returns delivery_uncertain: inspect the conversation and the receipt, never resend automatically. A dry run does not open Chrome.",
		examples: ['x-cli comment post --status 1234567890 --text "好问题" --request-id reply-1234567890-01 --dry-run'],
	},
	{
		id: "comment.reply",
		description: "Reply to one reply in a conversation",
		flags: [
			statusFlag,
			{
				key: "comment_id",
				name: "--comment-id <id>",
				description: "Reply status ID from comment list",
				type: "string",
				required: true,
			},
			{ ...text, required: true },
			textFile,
			paceConfirm,
		],
		effect: "account_write",
		guidance:
			"Addressed to the reply's author, not the work's. Requires --request-id. Same delivery contract as comment post: delivery_uncertain is never retried automatically.",
	},
	{
		id: "comment.scroll",
		description: "Scroll the open conversation without reading it",
		flags: [
			{ key: "pixels", name: "--pixels <pixels>", description: "Signed scroll distance", type: "number", default: 900 },
		],
		effect: "navigation",
	},
	{
		id: "receipt.get",
		description: "Inspect a persisted write receipt",
		argument: { key: "request_id", name: "request-id", description: "The request ID used by the write" },
		effect: "read",
		guidance:
			"Reads one persisted receipt by its request ID. An uncertain receipt is evidence the write may have happened, not that it did.",
	},
	{
		id: "history.list",
		description: "Read local operation facts for export or agent summaries",
		flags: [
			{
				key: "limit",
				name: "--limit <count>",
				description: "Maximum records, newest selected",
				type: "number",
				default: 50,
			},
		],
		effect: "read",
	},
	{
		id: "clean",
		description: "Remove the browser caches the profile accumulates, keeping the sign-in",
		effect: "local",
		guidance:
			"Deletes only cache and shader directories in the Chrome profile. Cookies and local storage are kept, so the sign-in survives. Run it while Chrome is stopped.",
	},
];

export const GLOBAL_FLAGS = [
	{ name: "--state-dir <path>", description: "Override local state directory (or X_CLI_STATE_DIR)" },
	{ name: "--chrome <path>", description: "Override Chrome executable (or X_CLI_CHROME_PATH)" },
	{ name: "--format <format>", description: "json or pretty", default: "json" },
	{ name: "--timeout <seconds>", description: "Per-command timeout in seconds", default: 45 },
	{ name: "--request-id <id>", description: "Idempotency key for replies" },
	{ name: "--dry-run", description: "Validate input and show the plan without side effects" },
	{
		name: "--progress",
		description: "Emit one JSON progress line per step to stderr while a write runs",
	},
];

export function schema(id?: string) {
	const selected = id ? COMMANDS.filter((command) => command.id === id.trim().replaceAll(" ", ".")) : COMMANDS;
	return {
		schema_version: 1,
		commands: selected,
		global_flags: GLOBAL_FLAGS,
		output: {
			success: { stream: "stdout", shape: '{"ok":true,"data":...}' },
			failure: {
				stream: "stderr",
				shape: '{"ok":false,"error":{"type":...,"code":...,"message":...,"retryable":false}}',
			},
		},
		exit_codes: {
			0: "success",
			1: "internal",
			2: "validation",
			3: "authentication or verification",
			4: "browser or timeout",
			5: "state or selector",
			6: "uncertain delivery or key conflict",
			130: "cancelled",
		},
	};
}
