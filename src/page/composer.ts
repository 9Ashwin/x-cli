import { clean, editorText, fail, findRendered, one, type Point, point } from "./dom.ts";

// Writing a reply.
//
// X renders the composer as a Draft.js contenteditable. Two things about it are
// easy to get wrong and both are checked here:
//
// 1. `[data-testid^="tweetTextarea_"]` matches three elements — a label div, a
//    container div and the actual editor. Only the editor has
//    `contenteditable="true"`, so a prefix match alone measures the label and
//    types into nothing.
// 2. A reply modal and a plain "new post" modal are the same component. What
//    separates them is the quoted tweet rendered as an article inside the
//    dialog. Without that article the composer posts to the timeline, so a
//    press that missed the reply control must be refused rather than posted.

const EDITOR = '[data-testid^="tweetTextarea_"][contenteditable="true"]';
const DIALOG = '[role="dialog"]';
const ARTICLE = 'article[data-testid="tweet"]';
const POST = '[data-testid="tweetButton"]';

export interface Composer {
	editor: HTMLElement;
	dialog: HTMLElement | null;
	// The tweet the dialog says it is answering. Null means the open composer is
	// a plain post, which is never what a reply command may press.
	quoted: { text: string; handle: string | null } | null;
}

// A dialog that is on screen. X keeps a second dialog mounted with its contents
// laid out but the dialog itself collapsed to height 0 — its editor still has a
// size, so measuring the editor proves nothing. The dialog's own box does: a
// visible modal occupies height. Picking the collapsed one typed the reply into a
// box the owner could not see, and the post button never left its disabled state.
function onScreen(dialog: HTMLElement): boolean {
	const rect = dialog.getBoundingClientRect();
	const style = getComputedStyle(dialog);
	return rect.height > 40 && rect.width > 40 && style.display !== "none" && style.visibility !== "hidden";
}

export function visibleDialog(): HTMLElement | null {
	const dialogs = [...document.querySelectorAll<HTMLElement>(DIALOG)].filter(onScreen);
	// A reply dialog is the one that shows the tweet being answered. The new-post
	// dialog has no quoted tweet, so it is never the reply composer even when it is
	// the only one on screen.
	return dialogs.find((dialog) => quotedIn(dialog) !== null) ?? dialogs[0] ?? null;
}

function editorIn(scope: ParentNode): HTMLElement | null {
	const dialog = visibleDialog();
	if (dialog) {
		const inDialog = findRendered<HTMLElement>(dialog, EDITOR);
		if (inDialog.length) return inDialog[0];
	}
	// The status page also carries its own inline composer under the root tweet.
	// It is a real composer, but it posts to the timeline, and callers reach it
	// only when no dialog is open — which the reply path refuses.
	const editors = findRendered<HTMLElement>(scope, EDITOR);
	return editors.sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)[0] ?? null;
}

function quotedIn(dialog: HTMLElement): Composer["quoted"] {
	const article = dialog.querySelector<HTMLElement>(ARTICLE);
	if (!article) return null;
	// Read the handle from the profile link, not from the text. The block's text
	// runs the handle straight into whatever follows it, so `@name` plus a body
	// starting with a letter read as `namea` — a handle that does not exist, and a
	// real send was refused as "replies to a different account".
	const handle =
		[...article.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')]
			.map((anchor) => {
				const path = anchor.getAttribute("href") ?? "";
				return /^\/([A-Za-z0-9_]{1,15})$/.exec(path)?.[1] ?? null;
			})
			.find((value): value is string => !!value) ??
		/@([A-Za-z0-9_]{1,15})(?:[^A-Za-z0-9_]|$)/.exec(clean(article.textContent))?.[1] ??
		null;
	const text = clean(article.querySelector('[data-testid="tweetText"]')?.textContent);
	return { text, handle };
}

export function composer(): Composer {
	const editor = editorIn(document);
	if (!editor) fail("editor_not_ready", "The reply composer is not open", "Press a reply control first.");
	const dialog = editor.closest<HTMLElement>(DIALOG);
	return { editor, dialog, quoted: dialog ? quotedIn(dialog) : null };
}

export function composerState(): {
	open: boolean;
	text: string;
	modal: boolean;
	quoted: { text: string; handle: string | null } | null;
} {
	const editor = editorIn(document);
	if (!editor) return { open: false, text: "", modal: false, quoted: null };
	const dialog = editor.closest<HTMLElement>(DIALOG);
	return { open: true, text: editorText(editor), modal: !!dialog, quoted: dialog ? quotedIn(dialog) : null };
}

export interface ArmArgs {
	token: string;
	text: string;
	tweet_id: string;
	// The text of the tweet being answered, so the quoted article can prove the
	// dialog is answering that tweet and not a neighbour.
	target_text: string | null;
	target_handle: string | null;
}

// Reads the composer before typing, so a draft left by the owner is preserved
// rather than overwritten.
export function prepareWrite(args: ArmArgs): { selector: string; already: false } {
	const { editor, quoted } = composer();
	if (!quoted) fail("identity_mismatch", "The composer is not in reply mode", "It would post to the timeline.");
	if (editorText(editor)) fail("draft_conflict", "The composer already contains a draft", "The draft is preserved.");
	editor.setAttribute("data-x-cli-editor", args.token);
	window.__xCLI = {
		token: args.token,
		editor,
		started_at: new Date().toISOString(),
		dispatched: false,
		blocked: false,
	};
	return { selector: `[data-x-cli-editor="${args.token}"]`, already: false };
}

export interface Prepared {
	token: string;
	editor: HTMLElement;
	started_at: string;
	dispatched: boolean;
	blocked: boolean;
	blocked_reason?: string;
}

export interface Guard {
	cleanup: () => void;
	state: Prepared;
	token: string;
}

declare global {
	interface Window {
		__xCLI?: Prepared;
		__xCLIGuard?: Guard;
	}
}

function matches(editor: HTMLElement, wanted: string): boolean {
	return editorText(editor) === wanted;
}

// The quoted tweet must still be the one this command meant to answer. Comparing
// text rather than only the handle matters in a thread, where several replies are
// written by the same person: the handle would agree while the target is wrong.
function quotedMatches(quoted: Composer["quoted"], args: ArmArgs): boolean {
	if (!quoted) return false;
	if (args.target_handle && quoted.handle && quoted.handle.toLowerCase() !== args.target_handle.toLowerCase())
		return false;
	if (args.target_text) {
		const wanted = clean(args.target_text).slice(0, 80);
		const shown = clean(quoted.text).slice(0, 80);
		if (wanted && shown && wanted !== shown) return false;
	}
	return true;
}

// Arms the post button. The guard runs at press time and refuses on its own, so a
// composer that changed after the text was typed cannot be posted by this command.
export function armWrite(args: ArmArgs): Point {
	const state = window.__xCLI;
	if (!state || state.token !== args.token) fail("identity_mismatch", "The composer this command filled is gone");
	if (!state.editor.isConnected || !matches(state.editor, args.text))
		fail("draft_conflict", "The composer no longer holds the requested text");
	const check = () => {
		if (!state.editor.isConnected || !matches(state.editor, args.text))
			fail("draft_conflict", "The composer changed before posting");
		// The quoted tweet is what makes this a reply. Losing it between typing and
		// pressing turns a reply into a public post.
		const { quoted } = composer();
		if (!quoted) fail("identity_mismatch", "The composer is no longer in reply mode");
		if (!quotedMatches(quoted, args)) fail("identity_mismatch", "The composer answers a different tweet");
	};
	check();
	const dialog = state.editor.closest<HTMLElement>(DIALOG) ?? visibleDialog();
	const buttons = findRendered<HTMLElement>(document, POST).filter((element) => !dialog || dialog.contains(element));
	const button = one(
		buttons.filter((element) => !buttons.some((other) => other !== element && element.contains(other))),
		"post control",
	);
	installGuard(button, args.token, check, state);
	return point(button, args.token);
}

// The press is intercepted in the capture phase. If any of the command's checks
// no longer hold at that instant, the event never reaches the page, and the
// reason is recorded so the caller is told which check refused.
export function installGuard(button: HTMLElement, token: string, check: () => void, state: Prepared): void {
	window.__xCLIGuard?.cleanup();
	const listener = (event: Event) => {
		if (
			!event.isTrusted ||
			!(event.target instanceof Node) ||
			!(event.target === button || button.contains(event.target))
		)
			return;
		try {
			if (!button.isConnected || button.getAttribute("data-x-cli-control") !== token)
				fail("identity_mismatch", "Post control changed");
			check();
			if (event.type === "click") state.dispatched = true;
		} catch (error) {
			const value = error as { message?: unknown };
			state.blocked = true;
			state.blocked_reason = typeof value?.message === "string" ? value.message : "The post was blocked";
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	};
	const types = ["mousedown", "mouseup", "click"];
	for (const type of types) document.addEventListener(type, listener, true);
	window.__xCLIGuard = {
		state,
		token,
		cleanup: () => {
			for (const type of types) document.removeEventListener(type, listener, true);
		},
	};
}

export interface WriteResult {
	confirmed: boolean;
	blocked: boolean;
	dispatched: boolean;
	uncertain_reason?: string;
	evidence?: "toast" | "new_row" | "modal_closed";
	record?: { id: string | null; text: string; handle: string | null } | null;
}

// What the page says happened after the press. A success toast, a new row or the
// dialog closing with an empty editor is evidence; anything else is reported as
// uncertain rather than as success, because a click that produced no evidence may
// not have sent anything and must never be repeated automatically.
export function writeResult(args: { token: string; text: string }): WriteResult {
	const state = window.__xCLI;
	if (!state || state.token !== args.token) fail("identity_mismatch", "The composer this command filled is gone");
	if (state.blocked) return { confirmed: false, blocked: true, dispatched: state.dispatched };

	const toast = findRendered<HTMLElement>(document, '[data-testid="toast"]').map((element) =>
		clean(element.textContent),
	);
	if (toast.some((text) => /(reply|post|tweet)\s+(was|has been)\s+sent|已发送|已发布|发送成功/i.test(text)))
		return { confirmed: true, blocked: false, dispatched: true, evidence: "toast", record: null };

	const rows = findRendered<HTMLElement>(document, ARTICLE);
	const match = rows.find(
		(article) => clean(article.querySelector('[data-testid="tweetText"]')?.textContent) === args.text,
	);
	if (match) {
		const link = [...match.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')].find((anchor) =>
			anchor.querySelector("time"),
		);
		const id = link ? /\/(\d{1,25})$/.exec(new URL(link.href).pathname)?.[1] : null;
		const handle = /@([A-Za-z0-9_]{1,15})/.exec(clean(match.textContent))?.[1] ?? null;
		return {
			confirmed: true,
			blocked: false,
			dispatched: true,
			evidence: "new_row",
			record: { id: id ?? null, text: args.text, handle },
		};
	}

	// The dialog is gone and the editor it held went with it. X does this after a
	// successful reply; it also does it when the owner closes the dialog by hand,
	// so this is the weakest of the three signals and is reported as such.
	const dialog = state.editor.closest<HTMLElement>(DIALOG);
	const stillOpen = state.editor.isConnected && !!dialog?.isConnected;
	if (!stillOpen)
		return {
			confirmed: true,
			blocked: false,
			dispatched: true,
			evidence: "modal_closed",
			record: null,
		};
	return { confirmed: false, blocked: false, dispatched: true, uncertain_reason: "composer_still_open" };
}

export function cleanup(): void {
	window.__xCLIGuard?.cleanup();
	document.querySelectorAll("[data-x-cli-control],[data-x-cli-editor]").forEach((element) => {
		element.removeAttribute("data-x-cli-control");
		element.removeAttribute("data-x-cli-editor");
	});
	delete window.__xCLIGuard;
	delete window.__xCLI;
}
