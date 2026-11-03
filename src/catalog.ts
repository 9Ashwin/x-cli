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
	notice: "Read who liked, replied to, or followed you",
	user: "Follow and unfollow an account",
	feed: "Read your own recommended timeline",
	trend: "Read what X is trending on, with nothing searched for",
	auto: "Rank posts worth replying to, with each section already read",
	search: "Search a keyword and read the matching posts",
	post: "Read one post, and like, bookmark or repost it",
	comment: "Read a conversation and post a reply",
	receipt: "Inspect a persisted write receipt",
	saved: "Read back what this account bookmarked or liked",
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
// A toggle's desired state. Defaults to on for every post action.
const toggle: Flag = {
	key: "value",
	name: "--value <boolean>",
	description: "Desired state: true to set, false to undo",
	type: "boolean-value",
	default: true,
};
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
		description: "Sign in through the same profile with the debugging port off",
		flags: [
			{
				key: "manual",
				name: "--manual <boolean>",
				description: "Default true; pass false to sign in inside the automation browser",
				type: "boolean-value",
			},
		],
		effect: "navigation",
		guidance:
			'The tool never types credentials. Complete the form in Chrome; the dedicated profile keeps the session for every later command. Run auth status afterwards.\n\nThis closes the automation browser, opens the same profile without a debugging port, waits until you close the window, then reads the session back. That indirection is the default because the direct route fails: Google refuses a browser started with a debugging port and shows "this browser or app may not be secure", which is the most common reason a sign-in appears to do nothing. Pass --manual false only for an account that does not use Google and wants the shorter route.',
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
		id: "feed.read",
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
			"Promoted posts are excluded from items and counted in limits. scope=loaded_dom and complete=false mean this is what the page rendered, not the whole timeline. The ids returned are accepted directly by comment post --status. This command never selects a target or writes anything: reading and acting are separate, and the decision between them is the caller's.",
		examples: ["xx feed read --limit 20 --scrolls 2"],
	},
	{
		id: "trend.read",
		description: "Read the Explore board: trending topics and today's stories",
		flags: [
			{
				key: "tab",
				name: "--tab <name>",
				description: "trending, news, sports or entertainment",
				type: "string",
				default: "trending",
			},
			{
				key: "limit",
				name: "--limit <count>",
				description: "Maximum entries to return (default 20)",
				type: "number",
			},
		],
		effect: "navigation",
		guidance:
			"An entry is a topic or a story, never a post. Trending returns ranked words with a category; news, sports and entertainment return one-line stories with an age and a post count. A row carries no id of its own — X opens the topic page from a click handler — so `trend posts --index <row_index> --tab <same tab>` reopens the tab, clicks that row and follows it to the posts, which is where the engagement is. `--topic <id>` works when you already have the numeric id. This needs no search term, which is what separates it from `search hot`. Promoted entries are excluded so the ranks stay as X numbered them.",
		examples: ["xx trend read --tab news", "xx trend read --tab trending --limit 30"],
	},
	{
		id: "trend.posts",
		description: "Read the posts under one Explore entry",
		flags: [
			{
				key: "topic",
				name: "--topic <id>",
				description: "Numeric topic_id, when you already have one",
				type: "string",
			},
			{
				key: "index",
				name: "--index <n>",
				description: "row_index from trend read; opens that row and follows it",
				type: "number",
			},
			{
				key: "tab",
				name: "--tab <name>",
				description: "Which board --index refers to",
				type: "string",
				default: "trending",
			},
			{ key: "limit", name: "--limit <count>", description: "Maximum posts returned (default 20)", type: "number" },
		],
		effect: "navigation",
		guidance:
			"The board row carries no id — X opens the topic page from a click handler, so the id only exists after the row is opened. Pass --index with a row_index from trend read and the command does the click and follows it, or --topic when you already have the id. The topic page is where the actual posts are, with full engagement from each card's summary label. Order is X's own ranking of the topic, which mixes recency and engagement. `items[].id` goes straight into comment list, comment section or comment post.",
		examples: ["xx trend posts --index 1 --tab news --limit 10", "xx trend posts --topic 2117540022039552439"],
	},
	{
		id: "auto.suggest",
		description: "Rank posts worth replying to, with the section already read",
		flags: [
			{
				key: "source",
				name: "--source <list>",
				description: "timeline, trend, search — comma separated",
				type: "string",
				default: "timeline,trend,search",
			},
			{
				key: "query",
				name: "--query <text>",
				description: "Topic for the search source",
				type: "string",
			},
			{
				key: "goal",
				name: "--goal <name>",
				description: "reply, reach or conversation",
				type: "string",
				default: "reply",
			},
			{
				key: "limit",
				name: "--limit <count>",
				description: "Posts to consider per source before ranking",
				type: "number",
			},
			{
				key: "scrolls",
				name: "--scrolls <count>",
				description: "Scrolls used to read each candidate's replies",
				type: "number",
				default: 2,
			},
			{
				key: "section_limit",
				name: "--section-limit <count>",
				description: "Replies read per candidate when measuring its section",
				type: "number",
				default: 40,
			},
			{
				key: "language",
				name: "--language <code>",
				description: "Language filter for the search and trend sources",
				type: "string",
			},
			{
				key: "seen_within",
				name: "--seen-within <days>",
				description: "Demote posts suggested in the last N days; 0 disables",
				type: "number",
				default: 7,
			},
		],
		effect: "navigation",
		guidance:
			"The one command that answers \"where should I reply\". It gathers posts from three sources — the home timeline, the Trending board used as search terms, and an optional keyword search — then opens each candidate's own conversation and measures it, so the ranking is not just engagement. `--goal reply` favours posts where each reply gets attention (views per reply); `--goal conversation` favours sections that have not already filled up with substance. Each candidate comes back with its section profile, the numbers the ranking used, a one-line `why`, and `angles` pointing at what is actually in the post. It never writes a reply, never picks what to say, and never sends anything — the writing is the caller's, and `comment check` measures the result against the same section. At most 8 candidates are opened because each costs a navigation; the rest are ranked but unmeasured. Every suggestion is recorded by post id, and a post already shown within `--seen-within` days is marked `seen.seen_recently` and ranked after the fresh ones — so a scheduled run does not propose the same post twice. Seen state lives in the state directory, never in the repository.",
		examples: [
			"xx auto suggest",
			'xx auto suggest --source search --query "AI agent" --goal reply',
			"xx auto suggest --goal conversation --section-limit 60",
		],
	},
	{
		id: "search.hot",
		description: "Read the posts a topic is being discussed under, ranked by X's Top tab",
		flags: [
			{
				key: "query",
				name: "--query <text>",
				description: "Topic; X's own search syntax is accepted",
				type: "string",
				required: true,
			},
			{
				key: "language",
				name: "--language <code>",
				description: "Search language filter, e.g. zh or en",
				type: "string",
			},
			{
				key: "min_likes",
				name: "--min-likes <count>",
				description: "Only posts with at least this many likes",
				type: "number",
			},
			{
				key: "min_replies",
				name: "--min-replies <count>",
				description: "Only posts with at least this many replies",
				type: "number",
			},
			{ key: "since", name: "--since <date>", description: "Only posts since YYYY-MM-DD", type: "string" },
			{ key: "limit", name: "--limit <count>", description: "Maximum posts returned (default 10)", type: "number" },
			{
				key: "scrolls",
				name: "--scrolls <count>",
				description: "Additional scrolls to load more results",
				type: "number",
				default: 0,
			},
		],
		effect: "navigation",
		guidance:
			"Composes X's own operators (lang:, min_faves:, min_replies:, since:) and reads the Top tab, so the ordering is the platform's rather than a re-ranking computed here. Each post carries replies / reposts / likes / bookmarks / views as the card states them; a count the page did not print is null, not zero. That engagement is what tells a busy conversation from an empty one — a well-liked post with no replies has nobody to answer. This command finds candidates and stops: choosing one and writing the reply stay with the caller.",
		examples: ['xx search hot --query "AI agent" --language zh --min-likes 500 --limit 10'],
	},
	{
		id: "notice.read",
		description: "Read the notifications page",
		flags: [
			{
				key: "tab",
				name: "--tab <name>",
				description: "all or mentions",
				type: "string",
				default: "all",
			},
			{ key: "limit", name: "--limit <count>", description: "Maximum entries returned (default 30)", type: "number" },
			{
				key: "scrolls",
				name: "--scrolls <count>",
				description: "Additional scrolls to load older entries",
				type: "number",
				default: 0,
			},
		],
		effect: "navigation",
		guidance:
			"Each entry carries the kind (like / reply / follow / repost / mention / recommended / other), the actors' handles, the row's text and its time. `recommended` marks a suggested post rather than someone acting: X fills this tab with suggestions when the account has no likes, replies or follows to report, and those rows would otherwise look like activity. Rows do not include the post id: the page links the actor, not the post, so which post a notification is about is only learnable by opening it. A row whose sentence matches no known kind is reported as other rather than guessed.",
		examples: ["xx notice read --limit 30 --scrolls 2"],
	},
	{
		id: "user.follow",
		description: "Follow, or unfollow, one account",
		flags: [
			{
				key: "handle",
				name: "--handle <name>",
				description: "Profile handle, with or without the @",
				type: "string",
				required: true,
			},
			{
				key: "value",
				name: "--value <boolean>",
				description: "true to follow, false to unfollow",
				type: "boolean-value",
				default: true,
			},
		],
		effect: "account_write",
		guidance:
			"The control is matched by the numeric id in its test id and by the handle in its aria-label, so a follow button for a suggested account in the sidebar cannot be pressed by mistake. A protected account answers with a confirmation dialog and the result reports pending rather than following. There is no batch follow: X's rules prohibit bulk or indiscriminate following.",
		examples: ["xx user follow --handle someone", "xx user follow --handle someone --value false"],
	},
	{
		id: "post.like",
		description: "Like or unlike one post",
		flags: [statusFlag, toggle],
		effect: "account_write",
		guidance:
			"The post must be the one the tab has open; the page's own test id is the state, and a press that does not change it is delivery_uncertain rather than a second press. Reusing a confirmed --request-id replays the receipt instead of toggling back.",
	},
	{
		id: "post.bookmark",
		description: "Bookmark or unbookmark one post",
		flags: [statusFlag, toggle],
		effect: "account_write",
		guidance: "Same contract as post like: state from the page, no automatic retry, confirmed request ids replay.",
	},
	{
		id: "post.repost",
		description: "Repost or undo a repost of one post",
		flags: [statusFlag, toggle],
		effect: "account_write",
		guidance:
			"A repost is a menu, and only the plain item is pressed; a menu offering only a quote is refused rather than opening a composer nobody wrote in.",
	},
	{
		id: "comment.delete",
		description: "Delete one of this account's own posts or replies",
		flags: [
			statusFlag,
			{
				key: "confirm",
				name: "--confirm",
				description: "Acknowledge that deleting cannot be undone",
				type: "boolean",
				default: false,
			},
		],
		effect: "account_write",
		guidance:
			"Deletes one post and cannot be undone: the page asks for no confirmation, so --confirm is the only check there is. Ownership is proven from the post's author link, not from the menu appearing — a post by someone else has a more-menu too. The menu must offer exactly one delete item, and the confirmation dialog names nothing, so it is trusted only because it followed this press. The result is confirmed by the post leaving the page. Requires --request-id.",
		examples: ["xx comment delete --status 1234567890 --confirm --request-id del-1234567890-01"],
	},
	{
		id: "comment.delete-many",
		description: "Delete several of this account's own posts by id",
		flags: [
			{
				key: "ids",
				name: "--ids <list>",
				description: "Comma-separated status ids, from saved or search output",
				type: "string",
				required: true,
			},
			{ key: "limit", name: "--limit <count>", description: "Maximum posts to delete (default 20)", type: "number" },
			{
				key: "confirm",
				name: "--confirm",
				description: "Acknowledge that deleting cannot be undone",
				type: "boolean",
				default: false,
			},
		],
		effect: "account_write",
		guidance:
			"Each id goes through the same proof as comment delete: the post must be on its page, its author link must be this account, the menu must offer one delete item, and the result is confirmed by the post leaving. A post owned by someone else is skipped and named, never deleted; any other failure stops the batch so the next press is not a guess. There is no undo, so a partial run is reported as partial. Requires --confirm and --request-id.",
		examples: ["xx comment delete-many --ids 123,456,789 --confirm --request-id del-batch-01"],
	},
	{
		id: "comment.section",
		description: "Measure how a conversation replies, and what drew a reaction",
		flags: [
			statusFlag,
			{
				key: "scrolls",
				name: "--scrolls <count>",
				description: "Conversation scrolls to load replies",
				type: "number",
				default: 2,
			},
			{ key: "limit", name: "--limit <count>", description: "Replies to read", type: "number", default: 60 },
		],
		effect: "navigation",
		guidance:
			"Returns the section's reply-length quartiles, how many ask questions, which replies lead on likes, and a shape count of how many carry a point versus generic praise. `led` is the most-liked replies in the loaded window, not a ranking of the section. `subject` labels each reply as `about_work`, `about_self`, `asking` or `spam` — what a reply points at, which is what makes quoting one safe or not — and reports the section's mix. This describes the window X chose to show; it is not a sample, and it says so.",
		examples: ["xx comment section --status 1234567890 --scrolls 3"],
	},
	{
		id: "comment.check",
		description: "Check a draft reply against the section it would join",
		flags: [
			statusFlag,
			{
				key: "draft",
				name: "--draft <text>",
				description: "The reply you are considering",
				type: "string",
				required: true,
			},
			{
				key: "scrolls",
				name: "--scrolls <count>",
				description: "Conversation scrolls used to measure the section",
				type: "number",
				default: 2,
			},
		],
		effect: "navigation",
		guidance:
			"Reads the section, then measures the draft against it: length band, whether it names anything specific, whether it speaks from the writer's own position, and how much of it is praise vocabulary that would fit any post. It also compares the draft with the confirmed replies in this machine's own log and reports `sameness` — whether openings, endings and lengths are converging on one shape. `template` means change the angle, not the words. It is a report, not a gate — it never rewrites the text and never blocks a send. Passing it does not mean the reply is good, and failing it does not mean it is bad; it means the draft has the shape of the thing it warns about.",
		examples: ['xx comment check --status 1234567890 --draft "…"'],
	},
	{
		id: "post.get",
		description: "Read one status by id or URL, without its replies",
		flags: [statusFlag],
		effect: "navigation",
		guidance:
			"Returns the post itself. Use comment list for the conversation under it. A deleted or protected post is not_found rather than an empty object.",
		examples: ["xx post get --status https://x.com/handle/status/1234567890"],
	},
	{
		id: "search.keyword",
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
			"Uses the Latest tab: results in the order X served them, not by engagement. No results is an answer, not a failure; a rate limit is reported as unsupported_page. Same item shape as feed read, and the same rule: this never chooses a target or posts.",
		examples: ['xx search keyword --query "AI agent" --limit 20'],
	},
	{
		id: "post.create",
		description: "Publish a new post",
		flags: [text, textFile, paceConfirm],
		effect: "account_write",
		guidance:
			"Requires --text or --text-file and --request-id. The composer must be a new-post composer: a quoted tweet in it would mean this lands as a reply, and that is refused. Same delivery contract as a reply — a receipt before the press, a guard at press time, and delivery_uncertain when the page gives no evidence. A dry run does not open Chrome.",
		examples: ['xx post create --text "…" --request-id post-01'],
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
		examples: ["xx comment list --status https://x.com/handle/status/1234567890 --limit 30 --scrolls 3"],
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
		examples: ['xx comment post --status 1234567890 --text "好问题" --request-id reply-1234567890-01 --dry-run'],
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
		id: "saved.bookmarks",
		description: "Read the posts this account has bookmarked",
		flags: [
			{ key: "limit", name: "--limit <count>", description: "Maximum posts returned (default 20)", type: "number" },
			{
				key: "scrolls",
				name: "--scrolls <count>",
				description: "Additional scrolls to load older entries",
				type: "number",
				default: 0,
			},
		],
		effect: "navigation",
		guidance:
			"Each item carries the card's current state (liked, bookmarked), so an entry can be one this account has since undone. Use the id with post bookmark --value false to remove it, or comment post to reply to it now. Reading this list is a bounded window: X loads older entries as it scrolls.",
		examples: ["xx saved bookmarks --limit 30 --scrolls 2"],
	},
	{
		id: "saved.likes",
		description: "Read the posts this account has liked",
		flags: [
			{ key: "limit", name: "--limit <count>", description: "Maximum posts returned (default 20)", type: "number" },
			{
				key: "scrolls",
				name: "--scrolls <count>",
				description: "Additional scrolls to load older entries",
				type: "number",
				default: 0,
			},
		],
		effect: "navigation",
		guidance:
			"Same shape as saved bookmarks. Use post like --value false with an item id to unlike it, or comment post to reply to something read before it was saved.",
		examples: ["xx saved likes --limit 30"],
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
	{ name: "--state-dir <path>", description: "Override local state directory (or XX_STATE_DIR)" },
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
