import { clean, findRendered } from "./dom.ts";

// Reading the notifications page.
//
// Each row is an `<article data-testid="notification">`. What the row says is in
// its text; what kind of notification it is comes from which icon precedes it,
// and the icons have no label of their own. So the kind is read from the sentence
// the row already carries — "liked your post", "replied to your post", "followed
// you" — which is localized, and an unknown sentence is reported as `other`
// rather than guessed at.
//
// Rows carry the actor's profile link but not the post's id. That is a limit of
// the page, not of this reader: opening a notification is the only way to learn
// which post it is about, so it is not attempted here.

export interface Notif {
	kind: "like" | "reply" | "follow" | "repost" | "mention" | "other";
	actors: string[];
	text: string;
	at: string | null;
	unread: boolean;
}

// The sentence the row uses. Ordered most specific first: "replied to your post"
// also contains "your post", and a bare "liked" check would claim it.
const KINDS: { kind: Notif["kind"]; test: RegExp }[] = [
	{ kind: "reply", test: /replied to your (post|reply)|回复了你的|回复了你/i },
	{ kind: "mention", test: /mentioned you|提到了你/i },
	{ kind: "repost", test: /reposted your|转推了你的|转发了你的/i },
	{ kind: "like", test: /liked your|赞了你的|喜欢了你的/i },
	{ kind: "follow", test: /followed you|关注了你/i },
];

export function readNotifications(): Notif[] {
	const rows = findRendered<HTMLElement>(document, '[data-testid="notification"]');
	const out: Notif[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		const text = clean(row.innerText);
		if (!text || seen.has(text)) continue;
		seen.add(text);
		// The actor is the profile link. A notification about several people has
		// several, and every one of them is kept rather than the first.
		const actors = [
			...new Set(
				[...row.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')]
					.map((anchor) => anchor.getAttribute("href") ?? "")
					.map((href) => /^\/([A-Za-z0-9_]{1,15})$/.exec(href)?.[1] ?? null)
					.filter((handle): handle is string => !!handle),
			),
		];
		const kind = KINDS.find((entry) => entry.test.test(text))?.kind ?? "other";
		const at = row.querySelector("time")?.getAttribute("datetime") ?? null;
		// X marks an unread row by dimming the others; the page states it on the
		// row's background, and an aria attribute is not always there. The textual
		// signal is the "unread" wording some locales use, which is not reliable, so
		// this reports false rather than guessing from styling.
		const unread = !!row.querySelector('[aria-label*="unread" i],[aria-label*="未读"]');
		out.push({ kind, actors, text: text.slice(0, 400), at, unread });
	}
	return out;
}
