import { clean, fail, findRendered, type Point, point, visible } from "./dom.ts";
import { statusIDOf, tweets } from "./tweets.ts";

// Deleting one of this account's own posts.
//
// The dangerous part is not the menu, it is which post the menu belongs to. A
// reply control sits inside the article it acts on, so pressing the wrong one
// acts on the wrong article; a caret menu is anchored to whatever row opened it,
// and the confirm dialog names nothing at all.
//
// That combination is how one of this tool's own test runs deleted a post it did
// not mean to: the caret belonged to the first article on the page, not to the
// one being cleaned up. So every step here re-derives the target from the article
// it came from, and the confirm step refuses unless the dialog is the one that
// followed this exact press.

const ARTICLE = 'article[data-testid="tweet"]';

export function articleFor(statusID: string): HTMLElement {
	const match = tweets().filter((article) => statusIDOf(article) === statusID);
	if (!match.length) fail("not_found", "That post is not on the page", "Open it with post get first.");
	if (match.length > 1)
		fail("identity_mismatch", "More than one article on the page has that id", "Refusing rather than picking one.");
	return match[0];
}

// Whether this article is the account's own. The menu only offers 删除 on your
// own posts, so the presence of the caret is not the test — a post by someone
// else has a caret too, with different items.
export function ownPost(article: HTMLElement): boolean {
	const own = article.querySelector('[data-testid="unlike"],[data-testid="like"]');
	// The strongest signal is the menu itself, which is only rendered with 删除 on
	// an own post; the caller opens it and checks. This is the cheap pre-check.
	return !!own;
}

export function caret(statusID: string, token: string): Point {
	const article = articleFor(statusID);
	const control = findRendered<HTMLElement>(article, '[data-testid="caret"]').filter(
		(element) => element.closest(ARTICLE) === article,
	)[0];
	if (!control) fail("selector_changed", "This post has no more-menu", "The post may not be yours.");
	return point(control, token);
}

// The delete item, and only on a post that offers it. The label is localized, so
// both spellings are accepted; an unknown label is a refusal rather than a guess
// at which item means delete.
const DELETE_LABEL = /^(Delete|删除)$/;

export function deleteItem(token: string): Point {
	// The menu is a portal anchored to the caret. Its items are laid out inside the
	// popover, and a visibility filter on the item alone can miss one whose own box
	// is inside a parent that has not painted yet, so the whole popover is checked
	// first and the items are taken from it.
	const menus = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].filter(visible);
	const items = menus.length
		? menus.flatMap((menu) => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')])
		: findRendered<HTMLElement>(document, '[role="menuitem"]');
	const matches = items.filter((item) => DELETE_LABEL.test(clean(item.textContent)));
	if (matches.length !== 1)
		fail(
			"identity_mismatch",
			matches.length ? "The menu offers more than one delete item" : "The menu offers no delete item",
			matches.length ? "" : "This is not this account's own post. Nothing was deleted.",
		);
	return point(matches[0], token);
}

// The confirmation dialog. It names nothing — no text, no author — so the only
// thing that ties it to the post is that it appeared after this press. The
// adapter reports what it says so a caller can see the dialog was real.
// The confirmation is a `confirmationSheetDialog`, not a role=dialog. Reading the
// role attribute alone found nothing while the sheet was plainly on screen.
const CONFIRM_DIALOG = '[data-testid="confirmationSheetDialog"]';

export function confirmDialog(): { open: boolean; text: string } {
	const dialogs = findRendered<HTMLElement>(document, `${CONFIRM_DIALOG},[role="dialog"]`);
	// The dialog is not titled by the action; its body says "This can't be undone
	// and will be removed from your profile..." in one language and something
	// equivalent in the other. Matching on the button rather than the heading is
	// what keeps this from depending on which locale the session uses.
	const dialog = dialogs.find((element) =>
		[...element.querySelectorAll('[data-testid="confirmationSheetConfirm"],[role="button"],button')].some((button) =>
			DELETE_LABEL.test(clean(button.textContent)),
		),
	);
	if (!dialog) return { open: false, text: "" };
	return { open: true, text: clean(dialog.textContent).slice(0, 300) };
}

export function confirmButton(token: string): Point {
	const dialog = findRendered<HTMLElement>(document, `${CONFIRM_DIALOG},[role="dialog"]`).find((element) =>
		[...element.querySelectorAll('[data-testid="confirmationSheetConfirm"],[role="button"],button')].some((button) =>
			DELETE_LABEL.test(clean(button.textContent)),
		),
	);
	if (!dialog) fail("selector_changed", "The delete confirmation is not open");
	// The confirm button has its own test id; matching by label alone also works
	// but would collide with the cancel button in a locale where both read the
	// same short word.
	const buttons = findRendered<HTMLElement>(
		dialog,
		'[data-testid="confirmationSheetConfirm"],[role="button"],button',
	).filter((element) => DELETE_LABEL.test(clean(element.textContent)));
	if (buttons.length !== 1) fail("identity_mismatch", "The confirmation offers more than one delete control");
	return point(buttons[0], token);
}

// Whether the post is gone. Two ways to be gone and both count: the article left
// the page, or navigating to it now says the page does not exist.
export function gone(statusID: string): { gone: boolean; still_listed: boolean } {
	const listed = tweets().some((article) => statusIDOf(article) === statusID);
	return { gone: !listed, still_listed: listed };
}
