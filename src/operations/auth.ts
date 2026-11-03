import type { Session } from "../browser.ts";
import { CliError } from "../errors.ts";

// Reading the sign-in state. Nothing here signs anyone in: the owner signs in
// once, in the dedicated profile, and every later command reuses it.

// The owned tab starts on about:blank, where every field is honestly null; that
// said nothing about the sign-in. Reading X's own home page makes the answer
// about the session rather than about the tab.
export async function authStatus(session: Session) {
	if (!session.tab.url().startsWith("http")) {
		await session.tab.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
		await new Promise((resolve) => setTimeout(resolve, 1200));
	}
	const state = await session.status();
	return {
		signed_in: !state.login_required && !state.verification_required,
		login_required: state.login_required,
		verification_required: state.verification_required,
		account: state.account,
		page_kind: state.page_kind,
		url: state.url,
	};
}

// The login window is shown, not filled. Typing a password into a page from a
// CLI would put credentials in this process's memory and in the history file;
// the owner completing the form in Chrome keeps them where the browser puts them.
export async function openLogin(session: Session): Promise<unknown> {
	await session.tab.goto("https://x.com/i/flow/login", { waitUntil: "domcontentloaded" });
	await new Promise((resolve) => setTimeout(resolve, 1500));
	const state = await session.status();
	if (!state.login_required && state.account?.handle) return { status: "already_signed_in", account: state.account };
	return {
		status: "login_window_open",
		next: "Complete sign-in in Chrome, then run x-cli auth status.",
		limits: ["The tool never types credentials. The owner signs in, in the dedicated profile."],
		// The one case this window cannot serve. Google's sign-in refuses a browser
		// started with a debugging port, which is exactly how this one is started,
		// so the page says "this browser may not be secure" and there is nothing to
		// fill in. Saying so here turns a dead end into the one command that works.
		alternative:
			"Signing in with Google is refused in a browser started for automation. Run `x-cli auth login --manual` instead: it opens the same profile without the debugging port.",
	};
}

export async function requireSignedIn(session: Session): Promise<void> {
	const state = await session.status();
	if (state.verification_required)
		throw new CliError("verification_required", "X is asking for human verification", {
			hint: "Complete it in headed Chrome, then run x-cli auth status.",
		});
	if (state.login_required)
		throw new CliError("login_required", "X requires a signed-in session", { hint: "Run x-cli auth login." });
}
