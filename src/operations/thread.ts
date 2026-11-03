import type { Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import type { TweetRow } from "./comments.ts";
import { openStatus } from "./navigation.ts";

// One status, on its own.
//
// `comment list` answers "what are people saying under this"; this answers
// "what does this one say". Keeping them apart matters: a caller that wants to
// read a post before deciding to answer it should not have to sort through a
// conversation to find it, and a caller reading a conversation should not get
// the root twice.

export interface ThreadResult {
	status_id: string;
	item: TweetRow | null;
	scope: "loaded_dom";
	complete: false;
	limits: string[];
}

export async function getStatus(
	session: Session,
	statusID: string,
	signal: AbortSignal,
	handle: string | null,
): Promise<ThreadResult> {
	await openStatus(session, statusID, signal, handle);
	const rows = await session.call<TweetRow[]>("tweet.list");
	const item = rows.find((row) => row.root) ?? rows.find((row) => row.id === statusID) ?? null;
	if (!item)
		throw new CliError("not_found", "That status is not on the page", {
			hint: "It may be deleted, protected, or the account is not visible to this session.",
			details: { status_id: statusID, loaded: rows.length },
		});
	return {
		status_id: statusID,
		item,
		scope: "loaded_dom",
		complete: false,
		limits: [
			"This returns the status itself, not its replies. Use `comment list` for the conversation.",
			"Fields are read from the rendered post; a value the page did not show is null rather than inferred.",
			"`item.id` is accepted directly by `comment post --status`.",
		],
	};
}
