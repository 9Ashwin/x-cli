import { clean, findRendered } from "./dom.ts";

// What page the owned tab is on, and who it is signed in as. Both are read from
// the page rather than from stored state: the owner can sign out or open another
// tab by hand, and a command must not act on what it merely believes.

export interface Snapshot {
	url: string | null;
	title: string | null;
	page_kind: "home" | "status" | "profile" | "search" | "login" | "verify" | "unknown";
	login_required: boolean;
	verification_required: boolean;
	account: { handle: string | null; name: string | null } | null;
	status: { id: string | null; author: string | null } | null;
	visible_text?: string;
}

const STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})(?:\/|$)/;

// Reserved first segments that are not accounts. A profile is one bare segment,
// and these share that shape; without them `/home` and `/explore` were read as
// profile pages.
const RESERVED = new Set([
	"home",
	"explore",
	"search",
	"i",
	"messages",
	"notifications",
	"settings",
	"compose",
	"login",
	"logout",
	"signup",
	"tos",
	"privacy",
	"about",
	"jobs",
	"help",
	"download",
	"account",
]);

// X has moved its sign-in between several routes, and an unrecognised one used
// to be reported as `unknown` with login_required false — which said the session
// was fine while the sign-in form was on screen. The form itself is the evidence,
// so the route is a hint and a visible credential field is the proof.
function signInForm(): boolean {
	return !!document.querySelector(
		'input[name="text"][autocomplete^="username"],input[autocomplete="username"],input[name="password"],input[type="password"]',
	);
}

export function pageKind(): Snapshot["page_kind"] {
	const path = location.pathname;
	if (document.querySelector('[data-testid="ocfEnterTextTextInput"]')) return "verify";
	if (/^\/(i\/)?flow\/login|\/i\/jf\/onboarding/.test(path)) return signInForm() || !signedInNav() ? "login" : "home";
	if (path === "/login") return "login";
	// A status opened by id alone lives at /i/web/status/<id> until X redirects
	// it. It is the same page, so it is the same kind; without this the wait for
	// "the status page" timed out on a conversation that had loaded.
	if (STATUS_PATH.test(path) || /^\/i\/web\/status\/\d{1,25}/.test(path)) return "status";
	if (/^\/(search|explore)/.test(path)) return "search";
	if (path === "/" || /^\/home/.test(path)) return "home";
	// A profile path is one bare segment; reserved words share that shape and are
	// not accounts, so they are excluded before the shape test.
	if (/^\/[A-Za-z0-9_]{1,15}\/?$/.test(path) && !RESERVED.has(path.split("/")[1] ?? "")) return "profile";
	return "unknown";
}

function signedInNav(): boolean {
	return !!document.querySelector(
		'[data-testid="SideNav_AccountSwitcher_Button"],[data-testid="AppTabBar_Profile_Link"]',
	);
}

export function loginRequired(kind: Snapshot["page_kind"]): boolean {
	if (kind === "login") return true;
	// X can render a signed-out shell without moving the route. The sign-in
	// control in the nav is what it shows while signed out; the account switcher
	// is what it shows while signed in.
	if (signedInNav()) return false;
	if (signInForm()) return true;
	return findRendered(document, '[data-testid="loginButton"],[data-testid="login"],a[href="/login"]').length > 0;
}

export function verificationRequired(): boolean {
	return !!(
		document.querySelector('[data-testid="ocfEnterTextTextInput"]') ||
		document.querySelector('[data-testid="arkose_iframe"],iframe[src*="arkoselabs"],iframe[src*="funcaptcha"]')
	);
}

// The signed-in account.
//
// The account switcher button carries no text at this width — its label is an
// avatar, so reading its textContent returned "" and every command reported an
// unknown account while the profile link sat in the same nav. The avatar's own
// test id names the handle (`UserAvatar-Container-<handle>`), and the profile
// tab's href is the same handle. Reported as null rather than guessed when
// neither is readable.
export function account(): { handle: string | null; name: string | null } | null {
	const avatar = document.querySelector<HTMLElement>('[data-testid^="UserAvatar-Container-"]');
	if (avatar)
		return { handle: avatar.getAttribute("data-testid")?.replace("UserAvatar-Container-", "") ?? null, name: null };
	const profile = document.querySelector<HTMLAnchorElement>('[data-testid="AppTabBar_Profile_Link"]');
	if (profile?.getAttribute("href"))
		return { handle: profile.getAttribute("href")?.replace("/", "") ?? null, name: null };
	const header = document.querySelector<HTMLElement>('[data-testid="UserName"]');
	if (!header) return null;
	const text = clean(header.textContent);
	return { handle: /@([A-Za-z0-9_]{1,15})/.exec(text)?.[1] ?? null, name: null };
}

// The status whose conversation is open, read from the URL. X accepts a status
// URL without the author segment, in which case the author is null.
export function statusFromPath(): { id: string | null; author: string | null } | null {
	const match = STATUS_PATH.exec(location.pathname);
	if (match) return { id: match[2], author: match[1] };
	const bare = /^\/i\/web\/status\/(\d{1,25})/.exec(location.pathname);
	return bare ? { id: bare[1], author: null } : null;
}

export function snapshot(includeText = false): Snapshot {
	const kind = pageKind();
	return {
		url: location.href.startsWith("http") ? location.href : null,
		title: document.title || null,
		page_kind: kind,
		login_required: loginRequired(kind),
		verification_required: verificationRequired(),
		account: account(),
		status: statusFromPath(),
		// The feed is enormous and changes while it loads, so the text is only
		// sent when a caller explicitly asks for a page dump, and never on the feed.
		...(includeText && kind !== "home" ? { visible_text: clean(document.body.innerText).slice(0, 20_000) } : {}),
	};
}
