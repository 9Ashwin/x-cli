import { CliError } from "../errors.ts";

// Every command's accepted input. Handlers stay thin; rules live here.

export interface Input {
	resource?: string;
	status_id?: string;
	tweet_id?: string;
	comment_id?: string;
	text?: string;
	text_file?: string;
	request_id?: string;
	dry_run?: boolean;
	headless?: boolean;
	chrome?: string;
	proxy?: string;
	limit?: number;
	scrolls?: number;
	include_text?: boolean;
	pixels?: number;
	manual?: boolean;
	// Search text for thread.list.
	query?: string;
	// Comma-separated status ids for a batch delete.
	ids?: string;
	// Profile handle for follow/unfollow.
	handle?: string;
	language?: string;
	min_likes?: number;
	min_replies?: number;
	since?: string;
	draft?: string;
	// Answer to the posting-pace prompt. It does not grant anything by itself; it
	// records that the caller was shown the count and chose to continue.
	confirm?: boolean;
	// Desired state for a toggle, defaulting to on.
	value?: boolean;
}

export function isWrite(operation: string): boolean {
	return [
		"comment.post",
		"comment.reply",
		"comment.delete",
		"comment.delete-many",
		"post.like",
		"post.bookmark",
		"post.repost",
	].includes(operation);
}

// A status is addressed either by its URL or by its numeric id. Both resolve to
// the same permalink, and a handle in the URL is decoration on that path — it is
// not identity, so the id decides.
export function statusID(value: string | undefined): string | null {
	if (!value) return null;
	const text = value.trim();
	if (/^\d{1,25}$/.test(text)) return text;
	try {
		const url = new URL(text, "https://x.com");
		if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(url.hostname))
			return null;
		const match = /\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/(\d{1,25})/.exec(url.pathname);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

// The author segment of a status URL, when the caller supplied one. It is not
// identity — the numeric id is — but the page resolves a canonical permalink
// faster than an /i/web/status/ one, so it is carried when it is there.
export function authorOf(input: Partial<Input>): string | null {
	const match = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\//.exec(input.status_id ?? input.resource ?? "");
	return match ? match[1] : null;
}

// The shortest text the platform accepts is one character. A length cap is not
// checked here: X allows long posts per account tier, and refusing a length this
// tool cannot know would block a legitimate post. The page's own counter and
// its refusal are the authority.
export function validateText(text: string | undefined, operation: string): string {
	const value = (text ?? "").trim();
	if (!value) throw new CliError("invalid_argument", `--text or --text-file is required for ${operation}`);
	if (value.length > 50_000)
		throw new CliError("invalid_argument", "Text is longer than the platform accepts", {
			details: { length: value.length },
		});
	return value;
}

export function validateTarget(operation: string, input: Input): void {
	const id = statusID(input.status_id ?? input.resource);
	if (!id)
		throw new CliError("invalid_argument", "A status URL or numeric status ID is required", {
			hint: "Pass --status https://x.com/handle/status/1234, or --status 1234.",
		});
	if (operation === "comment.reply") {
		const comment = statusID(input.comment_id);
		if (!comment)
			throw new CliError("invalid_argument", "A reply ID is required for comment reply", {
				hint: "Pass --comment-id with an id from comment list.",
			});
	}
}
