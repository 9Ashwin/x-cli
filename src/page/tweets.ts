import { clean, fail, findRendered } from "./dom.ts";

// Reading X's conversation without its internal API.
//
// Every field here is read from the rendered page. X's GraphQL data lives in
// React props whose shape changes between builds; the test ids below are the
// part X keeps stable because its own tests depend on them. Where a value cannot
// be read, it is reported as null rather than inferred.

export interface ReplyRef {
	handle: string;
	id: string | null;
}

export interface TweetRow {
	// The status id. It is the stable identity: a handle can be renamed and a
	// display name is never an identity.
	id: string;
	handle: string | null;
	name: string | null;
	text: string;
	at: string | null;
	likes: number | null;
	replies: number | null;
	retweets: number | null;
	// Whom this tweet says it replies to, as the page shows it.
	reply_to: ReplyRef | null;
	// True for the tweet whose conversation the URL names.
	root: boolean;
	mine: boolean;
	// Nesting depth on the page. 0 is a top-level tweet, 1 a reply drawn under
	// another. X's own layout is the only relation available without its API.
	depth: number;
	// True for a promoted tweet. The timeline interleaves ads with ordinary posts
	// and they carry no marker on the article itself: the wrapper is
	// `placementTracking` and the label is "Ad"/"广告" somewhere inside. Reading
	// only the article missed both, so an ad looked like something worth replying
	// to and `comment post` would have addressed it.
	promoted: boolean;
	// The one label X puts on a post's action row, e.g. "174 replies, 541 reposts,
	// 2741 likes, 3949 bookmarks, 234215 views". Reading the buttons individually
	// misses bookmarks and views, whose own labels carry no count.
	engagement_label?: string | null;
	// What this account has already done to the post, as the card states it. The
	// test ids are `unlike` when liked and `removeBookmark` when bookmarked — the
	// id names the action available, not the state, so the "remove" spelling is
	// the positive reading.
	// Null means the card's action row had not rendered when it was read — the
	// page shows `unlike` when liked and `like` when not, and neither is there
	// yet. Reporting false in that gap said "you have not bookmarked this" about
	// a post pulled from the bookmarks list.
	liked: boolean | null;
	bookmarked: boolean | null;
	// What the card says it is: a repost of someone else's post, a reply, or
	// pinned. Deleting has to distinguish these — a repost is removed without
	// touching the original, and a pinned reply is still a reply.
	kind: "post" | "repost" | "reply";
	pinned: boolean;
	// The author handle as a stable link target, separate from the display text.
	author_link: string | null;
}

const TWEET = 'article[data-testid="tweet"]';
const TEXT = '[data-testid="tweetText"]';
const USER_NAME = '[data-testid="User-Name"]';

export function tweets(): HTMLElement[] {
	return findRendered<HTMLElement>(document, TWEET);
}

export function handleOf(anchor: HTMLAnchorElement): string | null {
	try {
		const url = new URL(anchor.href);
		if (url.origin !== location.origin) return null;
		const match = /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(url.pathname);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

// The status id of one tweet. The first permalink carrying a timestamp is the
// tweet's own; a quoted tweet nests its own status link inside, so links inside
// a quoteTweet container are excluded.
export function statusIDOf(article: Element): string | null {
	const links = [...article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')].filter(
		(link) => link.closest('[data-testid="quoteTweet"]') === null,
	);
	const timed = links.find((link) => link.querySelector("time"));
	for (const link of timed ? [timed] : links) {
		const match = /^\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,25})(?:\/|$)/.exec(new URL(link.href).pathname);
		if (match) return match[1];
	}
	return null;
}

function timeOf(article: Element): string | null {
	return article.querySelector("time")?.getAttribute("datetime") ?? null;
}

function identity(article: Element): { handle: string | null; name: string | null } {
	const block = article.querySelector(USER_NAME);
	if (!block) return { handle: null, name: null };
	const handles = new Set<string>();
	for (const anchor of block.querySelectorAll<HTMLAnchorElement>('a[role="link"]')) {
		const handle = handleOf(anchor);
		if (handle) handles.add(handle);
	}
	// The href is preferred because the displayed string is localized decoration
	// around the handle; the visible @name is the fallback when both anchors
	// point at the same profile and collapse to one.
	const shown = /@([A-Za-z0-9_]{1,15})/.exec(clean(block.textContent))?.[1];
	const name = clean(block.querySelector("span")?.textContent) || null;
	return { handle: handles.size === 1 ? [...handles][0] : (shown ?? null), name };
}

function count(label: string | null): number | null {
	if (!label) return null;
	// The label is localized, e.g. "12 replies, 12 Replies. Reply".
	const match = /(\d[\d,.]*)\s*([KkMm])?/.exec(label);
	if (!match) return null;
	const raw = Number.parseInt(match[1].replace(/[,.]/g, ""), 10);
	if (!Number.isFinite(raw)) return null;
	const scale = match[2]?.toUpperCase() === "K" ? 1_000 : match[2]?.toUpperCase() === "M" ? 1_000_000 : 1;
	return raw * scale;
}

// The summary label. It is the only element whose aria-label contains commas and
// more than one count; the per-button labels each name one action.
function engagementLabel(article: Element): string | null {
	for (const element of article.querySelectorAll("[aria-label]")) {
		const label = element.getAttribute("aria-label") ?? "";
		if (/views|Views|查看/.test(label) && label.includes(",")) return label;
	}
	return null;
}

function aria(article: Element, selector: string): string | null {
	return article.querySelector(selector)?.getAttribute("aria-label") ?? null;
}

// The "Replying to @x" line names a handle. The link beside it points at the
// profile, not at the replied-to tweet, so the id is not available here and is
// reported as null rather than taken from the reply's own permalink.
function replyTo(article: Element): ReplyRef | null {
	const line = [...article.querySelectorAll<HTMLElement>("div,span")].find((element) =>
		/^Replying to\s*@[A-Za-z0-9_]{1,15}$/.test(clean(element.textContent)),
	);
	if (!line) return null;
	const handle = /@([A-Za-z0-9_]{1,15})/.exec(clean(line.textContent))?.[1];
	return handle ? { handle, id: null } : null;
}

// A card states "reposted" or "replying to" in its social context line. Both
// matter for deletion: deleting a repost removes the repost, not the original,
// and the menu on a repost says so.
function kindOf(article: Element): "post" | "repost" | "reply" {
	const context = clean(article.querySelector('[data-testid="socialContext"]')?.textContent);
	if (/reposted|转推了|已转推/i.test(context)) return "repost";
	if (/replying|回复了|回复给/i.test(context)) return "reply";
	return "post";
}

// An Article card has no `tweetText`. X renders its headline and standfirst as
// plain spans in the card body, so a reader that only looks for `tweetText`
// returns an empty string for every long-form post — four of five bookmarks in
// one account, which then look like blank entries rather than like articles.
//
// The body is read from the card's own text, minus the parts that are not the
// body: the name block, the social context line, the "Article" word, the action
// counts. That is a fallback, not a replacement: `tweetText` is exact when it is
// there, and the fallback only runs when it is not.
function textOf(article: Element): string {
	const exact = clean(article.querySelector(TEXT)?.textContent);
	if (exact) return exact;
	return articleBody(article);
}

const INTERACTION = /^[\d.,]+\s*[KkMm]?$/;

function articleBody(article: Element): string {
	const name = clean(article.querySelector(USER_NAME)?.textContent);
	const context = clean(article.querySelector('[data-testid="socialContext"]')?.textContent);
	// Every leaf span outside the name block. The body is what is left after the
	// label, the byline and the counters are removed; the card's own `innerText`
	// cannot be used because it interleaves those with the body.
	const leaves = [...article.querySelectorAll("span")]
		.filter((span) => span.children.length === 0)
		.filter((span) => !span.closest(USER_NAME))
		.map((span) => clean(span.textContent))
		.filter(Boolean);
	const kept = leaves.filter((leaf) => {
		if (leaf === "Article" || leaf === "长文" || leaf === "文") return false;
		if (INTERACTION.test(leaf)) return false;
		if (context && leaf === context) return false;
		if (name && leaf === name) return false;
		if (leaf === "·") return false;
		return true;
	});
	// Consecutive identical leaves are the same text rendered twice for layout
	// (X does this for the headline), so they are collapsed.
	return clean(kept.filter((leaf, index) => leaf !== kept[index - 1]).join(" "));
}

// A promoted tweet. Two independent signals, because either can be missing:
// the `placementTracking` wrapper, and the "Ad" / "广告" label. A tweet that
// merely talks about advertising has the word in its body, so the label is only
// trusted when it is a short leaf element of its own.
const AD_LABEL = /^(Ad|Promoted|广告|推广|Anzeige|Gesponsert|Publicité)$/;
export function promoted(article: Element): boolean {
	if (article.closest('[data-testid="placementTracking"]')) return true;
	return [...article.querySelectorAll("span,div")].some((element) => {
		if (element.children.length) return false;
		return AD_LABEL.test(clean(element.textContent));
	});
}

// Whether this tweet is drawn under another one. Walking up until an ancestor
// holds a different tweet is what the layout itself says.
export function nestedUnder(article: HTMLElement): HTMLElement | null {
	let node = article.parentElement;
	while (node && node !== document.body) {
		const other = [...node.querySelectorAll<HTMLElement>(TWEET)].find(
			(element) => element !== article && !element.contains(article) && !article.contains(element),
		);
		if (other) return other;
		node = node.parentElement;
	}
	return null;
}

// The account whose conversation is open, from the URL's author path. A missing
// path is not an error: a status page may be opened by id alone.
export function rootHandle(): string | null {
	return /^\/([A-Za-z0-9_]{1,15})\/status\/\d{1,25}/.exec(location.pathname)?.[1] ?? null;
}

export function rootStatusID(): string | null {
	return /\/status\/(\d{1,25})/.exec(location.pathname)?.[1] ?? null;
}

export function readTweets(selfHandle: string | null): TweetRow[] {
	const rootID = rootStatusID();
	const rows: TweetRow[] = [];
	const seen = new Set<string>();
	for (const article of tweets()) {
		const id = statusIDOf(article);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const { handle, name } = identity(article);
		rows.push({
			id,
			handle,
			name,
			text: textOf(article),
			at: timeOf(article),
			likes: count(aria(article, '[data-testid="like"],[data-testid="unlike"]')),
			replies: count(aria(article, '[data-testid="reply"]')),
			retweets: count(aria(article, '[data-testid="retweet"],[data-testid="unretweet"]')),
			reply_to: replyTo(article),
			root: id === rootID,
			mine: !!handle && !!selfHandle && handle.toLowerCase() === selfHandle.toLowerCase(),
			depth: nestedUnder(article) ? 1 : 0,
			promoted: promoted(article),
			engagement_label: engagementLabel(article),
			liked: toggleState(article, "unlike", "like"),
			bookmarked: toggleState(article, "removeBookmark", "bookmark"),
			kind: kindOf(article),
			pinned: /pinned|已置顶|置顶/i.test(clean(article.querySelector('[data-testid="socialContext"]')?.textContent)),
			author_link: identity(article).handle ? `/${identity(article).handle}` : null,
		});
	}
	return rows;
}

// A toggle's state from its two test ids. The positive spelling (`unlike`,
// `removeBookmark`) means the action is available, so it is on. Neither id means
// the action row is not rendered yet, which is unknown rather than off.
function toggleState(article: Element, on: string, off: string): boolean | null {
	if (article.querySelector(`[data-testid="${on}"]`)) return true;
	if (article.querySelector(`[data-testid="${off}"]`)) return false;
	return null;
}

export function findTweet(id: string): HTMLElement {
	const match = tweets().filter((article) => statusIDOf(article) === id);
	if (match.length) return match[0];
	return fail(
		"not_found",
		"The tweet with that ID is not loaded on this page",
		"Scroll the conversation, then read it again.",
	);
}

// The reply control of one tweet, inside that article rather than anywhere else
// on the page. The page-level composer's reply button is outside the article.
export function replyControl(article: HTMLElement): HTMLElement {
	const controls = findRendered(article, '[data-testid="reply"]').filter(
		(element) => element.closest(TWEET) === article,
	);
	return controls[0] ?? fail("selector_changed", "This tweet has no reply control");
}

// A page that renders by virtualization keeps only the rows near the viewport in
// the DOM, so a small scroll can load one new row and recycle an old one. The
// roster reader therefore jumps to the bottom and watches the document height
// rather than counting pixels moved: what matters is whether the page found more
// rows, not how far it went.
export function scrollToEnd(): { moved: boolean; height: number; y: number } {
	const before = window.scrollY;
	window.scrollTo(0, document.documentElement.scrollHeight);
	return { moved: window.scrollY !== before, height: document.documentElement.scrollHeight, y: window.scrollY };
}

export function scrollConversation(pixels: number): { moved: boolean; height: number } {
	const before = window.scrollY;
	window.scrollBy(0, pixels);
	return { moved: window.scrollY !== before, height: document.documentElement.scrollHeight };
}
