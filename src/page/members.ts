import { clean, findRendered } from "./dom.ts";

// Reading a list's members.
//
// A list is a roster of accounts, and X renders it as `UserCell` rows: the
// display name, the handle, a Follow button whose label says whether this
// account already follows them, and sometimes a bio. The cell carries no id, so
// the handle is the identity — and the handle is a link here, so it is read from
// the href rather than from the text, where it runs straight into whatever
// follows it.
//
// What this does not do is follow anybody. A roster is a reading; following is a
// separate decision per account, and the tool has one command for one account.

export interface ListMember {
	handle: string;
	name: string | null;
	bio: string | null;
	// Whether this account already follows them, as the cell's own button says.
	// Null when the cell has not drawn its button yet.
	following: boolean | null;
	// Whether their account is protected, which changes what following them does
	// — a request rather than a follow.
	protected: boolean;
}

// The button's two spellings. `Following` means the action available is to stop,
// so this account already follows them; `Follow` means it does not. Localized
// labels are matched too, because the page carries the UI language, not English.
const FOLLOWING = /^(Following|Unfollow|正在关注|取消关注|回关)$/i;
const FOLLOW = /^(Follow|关注|回关)$/i;

export function listTitle(): { title: string | null } {
	const heading = document.querySelector<HTMLElement>('[data-testid="primaryColumn"] h2');
	return { title: clean(heading?.textContent) || null };
}

export function listMembers(): ListMember[] {
	const cells = findRendered<HTMLElement>(document, '[data-testid="UserCell"]');
	const out: ListMember[] = [];
	const seen = new Set<string>();
	for (const cell of cells) {
		// The profile link is the handle. Several links per cell point at it; the
		// first bare path is the one.
		const handle =
			[...cell.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')]
				.map((anchor) => /^\/([A-Za-z0-9_]{1,15})\/?$/.exec(anchor.getAttribute("href") ?? "")?.[1] ?? null)
				.find((value): value is string => !!value) ?? null;
		if (!handle || seen.has(handle)) continue;
		seen.add(handle);

		const leaves = [...cell.querySelectorAll("span")].map((span) => clean(span.textContent)).filter(Boolean);
		// The display name is the first leaf; the handle leaf starts with "@".
		const name = leaves.find((leaf) => !leaf.startsWith("@") && leaf !== "·") ?? null;
		// The bio is the last leaf that is not the name, the handle, a separator or
		// a button label. A cell without one simply has none.
		const bio =
			[...leaves]
				.reverse()
				.find(
					(leaf) =>
						leaf !== name &&
						!leaf.startsWith("@") &&
						leaf !== "·" &&
						!FOLLOW.test(leaf) &&
						!FOLLOWING.test(leaf) &&
						leaf.length > 0,
				) ?? null;

		const button = cell.querySelector<HTMLElement>('[data-testid$="-follow"],[data-testid$="-unfollow"],button');
		const label = clean(button?.textContent);
		const following = FOLLOWING.test(label) ? true : FOLLOW.test(label) ? false : null;

		// A protected account's cell says so with a lock icon and no way to tell
		// from text alone; the bio row carries the wording in some locales, so the
		// icon is the reliable signal.
		const locked = !!cell.querySelector('[data-testid="icon-lock"], svg[aria-label*="rotected" i]');

		out.push({
			handle,
			name: name === handle ? null : name,
			bio: bio && bio !== name ? bio.slice(0, 240) : null,
			following,
			protected: locked,
		});
	}
	return out;
}
