// A first look at anything that goes out in this account's name.
//
// The tool's split is that judgement stays with the caller. That split held for
// reading and broke for writing: a caller could compose a reply and send it in
// the same step, so the only record that anyone had looked at the text was the
// caller's own word. A skill can say "show the draft before sending", but a
// skill is text a model may skip — and one did, publishing a reply to a
// stranger with the draft and the send in the same turn.
//
// So the first send is refused. What comes back is the exact text, the exact
// target, and the one flag that resumes. Nothing has been written, no receipt
// exists, and a second run with `--confirm` is a new decision rather than a
// continuation of this one.
//
// This is deliberately not a prediction about whether the reply is good. It
// cannot be: the tool does not know what the caller meant. It only guarantees
// that a public sentence was shown once before it was published.

import type { TweetRow } from "./comments.ts";
import type { Input } from "./validate.ts";

export interface ApprovalRequest {
	sent: false;
	needs_approval: true;
	action: "post" | "reply";
	// The text exactly as it would be typed.
	text: string;
	text_length: number;
	// Who and where it lands. Read from the page, not from the input, so a
	// mistyped id shows up here as the post it actually points at.
	target: {
		status_id: string;
		// The tweet or the reply being answered, when one is known.
		answers: { id: string | null; handle: string | null; text: string | null } | null;
		// The account the reply reaches: the conversation's author for a root
		// reply, the replier's author for a reply-to-reply.
		reaches: string | null;
	};
	// Whether this account has sent the same text before, so a repeated reply is
	// visible before it is repeated.
	repeated_before: boolean;
	next: string;
	limits: string[];
}

const PREVIEW = 280;

export function approvalRequest(
	action: "post" | "reply",
	input: Input,
	text: string,
	root: { id: string; handle: string | null; text: string | null } | null,
	target: TweetRow | null,
	key: string,
	repeatedBefore: boolean,
): ApprovalRequest {
	return {
		sent: false,
		needs_approval: true,
		action,
		text,
		text_length: Array.from(text).length,
		target: {
			status_id: root?.id ?? input.status_id ?? "",
			answers:
				action === "reply" && target
					? {
							id: target.id,
							handle: target.handle,
							text: target.text ? target.text.slice(0, PREVIEW) : null,
						}
					: root
						? { id: root.id, handle: root.handle, text: root.text ? root.text.slice(0, PREVIEW) : null }
						: null,
			reaches: target?.handle ?? root?.handle ?? null,
		},
		repeated_before: repeatedBefore,
		next: `Read the text above. If it is what you meant to publish, run the same command again with --request-id ${key} --confirm. Nothing has been sent.`,
		limits: [
			"Nothing was typed, no receipt was written, and the request id is unused — the confirmed run starts from the beginning.",
			"This is a first look, not a check on the text. Whether the reply is worth sending is not something this tool can answer.",
			...(repeatedBefore
				? ["This account has published this exact text before. A repeat is visible here on purpose."]
				: []),
		],
	};
}

export function approvalRequired(operation: string): boolean {
	return operation === "comment.post" || operation === "comment.reply" || operation === "post.create";
}
