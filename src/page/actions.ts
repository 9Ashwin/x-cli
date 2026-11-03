import { fail, findRendered, type Point, point } from "./dom.ts";
import { statusIDOf, tweets } from "./tweets.ts";

// Liking, bookmarking and reposting one post.
//
// Each of these is a toggle whose state the page states twice: the test id
// changes (`like` -> `unlike`) and the label changes ("2558 Likes. Like" ->
// "2559 Likes. Liked"). The test id is what decides the state, because the count
// in the label is the post's total and moves for reasons this account did not
// cause.
//
// A repost is two actions in one dialog: the plain repost, and a quote. The
// plain one is behind a menu item, so it is never a single press.

export type Action = "like" | "bookmark" | "repost";

const TESTID: Record<Action, { on: string; off: string }> = {
	like: { on: "unlike", off: "like" },
	bookmark: { on: "removeBookmark", off: "bookmark" },
	repost: { on: "unretweet", off: "retweet" },
};

export function articleFor(statusID: string): HTMLElement {
	const match = tweets().filter((article) => statusIDOf(article) === statusID);
	return match[0] ?? fail("not_found", "That post is not on the page", "Open it with post get first.");
}

export function toggleState(action: Action, statusID: string): { on: boolean } {
	const article = articleFor(statusID);
	const { on, off } = TESTID[action];
	if (article.querySelector(`[data-testid="${on}"]`)) return { on: true };
	if (article.querySelector(`[data-testid="${off}"]`)) return { on: false };
	fail("selector_changed", `This post has no ${action} control`);
}

// The control for the state the caller wants. When the post is already in that
// state there is nothing to press, and saying so is the answer.
export function actionControl(
	action: Action,
	statusID: string,
	wanted: boolean,
	token: string,
): Point & { already: boolean } {
	const article = articleFor(statusID);
	const current = toggleState(action, statusID).on === wanted;
	if (current) return { already: true, selector: "", x: 0, y: 0 };
	// The test id names the CURRENT state: pressing "like" turns it on, pressing
	// "unlike" turns it off. Using the wanted state's id here pressed "unlike" to
	// like, which found no control on a post that was not yet liked.
	const selector = `[data-testid="${wanted ? TESTID[action].off : TESTID[action].on}"]`;
	const button = findRendered<HTMLElement>(article, selector).filter(
		(element) => element.closest('article[data-testid="tweet"]') === article,
	)[0];
	if (!button) fail("selector_changed", `The ${action} control is not clickable`);
	return { ...point(button, token), already: false };
}

// What the page says after the press. The test id is the state; the count is
// reported beside it so a caller can see the post's total move or not.
export function actionResult(
	action: Action,
	statusID: string,
	wanted: boolean,
): { confirmed: boolean; on: boolean; label: string | null } {
	const article = articleFor(statusID);
	const { on, off } = TESTID[action];
	const element = article.querySelector<HTMLElement>(`[data-testid="${wanted ? on : off}"]`);
	// `on` is the test id that means "this action is applied", so it is the state
	// to look for after pressing toward `wanted`.
	return {
		confirmed: wanted
			? !!article.querySelector(`[data-testid="${on}"]`)
			: !!article.querySelector(`[data-testid="${off}"]`),
		on: !!article.querySelector(`[data-testid="${on}"]`),
		label: element?.getAttribute("aria-label") ?? null,
	};
}

// A repost opens a menu instead of toggling. Its items are labelled text, and
// the plain repost is the one that does not offer to add a comment.
export function repostMenu(): { repost: Point | null; quote: Point | null } {
	const items = findRendered<HTMLElement>(document, '[role="menuitem"]');
	const pick = (test: (label: string) => boolean) => {
		const item = items.find((candidate) => test((candidate.textContent ?? "").trim()));
		return item
			? point(item, `repost-${item.getAttribute("role") ?? "item"}-${Math.random().toString(36).slice(2, 8)}`)
			: null;
	};
	// The labels are localized; the plain repost reads "Repost" and the quote
	// reads "Quote". Matching both keeps the wrong one from being pressed: a
	// quote opens a composer and would publish text that was never written.
	return {
		repost: pick((label) => /^(Repost|转发|转推)$/i.test(label)),
		quote: pick((label) => /^(Quote|引用)/i.test(label)),
	};
}
