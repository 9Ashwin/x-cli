import { type ArmArgs, armWrite, cleanup, composerState, prepareWrite, writeResult } from "./composer.ts";
import { fail, type Point, point } from "./dom.ts";
import { account, snapshot } from "./page.ts";
import { findTweet, readTweets, replyControl, scrollConversation } from "./tweets.ts";

// The page adapter. It is bundled on its own and injected into the owned tab;
// every operation answers `{data}` or `{error}`, and nothing here decides what a
// command may do — it only reads and measures the page.

interface Args extends Partial<ArmArgs> {
	tweet_id?: string;
	limit?: number;
	pixels?: number;
	include_text?: boolean;
	token?: string;
}

export interface PageError {
	code: string;
	message: string;
	hint?: string;
}

function selfHandle(): string | null {
	return account()?.handle ?? null;
}

function execute(operation: string, args: Args): unknown {
	switch (operation) {
		case "status":
			return snapshot(args.include_text === true);
		case "account":
			return account();
		case "tweet.list": {
			const rows = readTweets(selfHandle());
			return args.limit ? rows.slice(0, args.limit) : rows;
		}
		case "reply.control": {
			if (!args.tweet_id) fail("invalid_argument", "tweet_id is required");
			// The reply control and the post button carry different marks. Sharing one
			// token meant `[data-x-cli-control="…"]` matched both once the composer
			// opened, and the press was refused as ambiguous — the same selector was
			// used to open the composer and to send from it.
			return point(replyControl(findTweet(args.tweet_id)), `${args.token ?? "reply"}-open`) satisfies Point;
		}
		case "reply.composer":
			// Called before the control is pressed, so a composer that is already
			// open is a wait rather than an error.
			return composerState();
		case "reply.prepare":
			return prepareWrite(args as ArmArgs);
		case "reply.arm-write":
			return armWrite(args as ArmArgs);
		case "reply.result":
			return writeResult(args as { token: string; text: string });
		case "reply.blocked":
			return window.__xCLI?.blocked_reason ?? null;
		case "conversation.scroll":
			return scrollConversation(args.pixels ?? 900);
		case "cleanup":
			return cleanup();
		default:
			fail("invalid_argument", `Unknown browser operation: ${operation}`);
	}
}

export async function call(operation: string, args: Args & { seconds?: number }) {
	try {
		return { data: await execute(operation, args) };
	} catch (error: unknown) {
		const value = error as Partial<PageError>;
		return {
			error: {
				code: typeof value?.code === "string" ? value.code : "selector_changed",
				message: typeof value?.message === "string" ? value.message : "Browser operation failed",
				hint: value?.hint ?? "",
			},
		};
	}
}
