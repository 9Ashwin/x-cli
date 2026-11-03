import { clean, fail, findRendered, type Point, point } from "./dom.ts";

// Following and unfollowing an account.
//
// The button's test id carries the target's numeric id: `<id>-follow` when this
// account does not follow them, `<id>-unfollow` when it does. That id is the
// identity check — a profile page also renders follow buttons for accounts in its
// sidebar, so matching on the label alone would press whichever one came first.
// The aria-label says whom the button acts on, and it has to agree.

export interface FollowState {
	following: boolean;
	user_id: string | null;
	label: string | null;
}

const FOLLOW = '[data-testid$="-follow"]:not([data-testid$="-unfollow"])';
const UNFOLLOW = '[data-testid$="-unfollow"]';

// The profile header's own button, not a sidebar suggestion. It sits inside the
// header block, and it is the only follow control that also carries the handle
// the caller asked about.
export function followControl(handle: string): { state: FollowState; button: HTMLElement } {
	const buttons = [...document.querySelectorAll<HTMLElement>(`${UNFOLLOW},${FOLLOW}`)].filter((button) => {
		const label = button.getAttribute("aria-label") ?? "";
		// "Follow @someone" / "Following @someone" / "Unfollow @someone". The handle
		// in the label is what ties this button to the profile being read.
		return new RegExp(`@${handle}$`, "i").test(label);
	});
	if (buttons.length === 0)
		fail("selector_changed", `This profile has no follow control for @${handle}`, "It may be your own account.");
	if (buttons.length > 1) fail("identity_mismatch", "More than one follow control names that account");
	const button = buttons[0];
	const testId = button.getAttribute("data-testid") ?? "";
	const unfollow = testId.endsWith("-unfollow");
	return {
		state: {
			following: unfollow,
			user_id: testId.replace(/-(un)?follow$/, "") || null,
			label: button.getAttribute("aria-label"),
		},
		button,
	};
}

export function actionControl(handle: string, wanted: boolean, token: string): Point & { already: boolean } {
	const { state, button } = followControl(handle);
	if (state.following === wanted) return { already: true, x: 0, y: 0, selector: "" };
	return { ...point(button, token), already: false };
}

// A follow is confirmed by the button changing test id. A protected account
// answers with a confirmation dialog instead, which means the follow was
// requested rather than applied — that is reported as such, not as a failure.
export function actionResult(
	handle: string,
	wanted: boolean,
): { confirmed: boolean; pending: boolean; following: boolean } {
	const buttons = [...document.querySelectorAll<HTMLElement>(`${UNFOLLOW},${FOLLOW}`)].filter((button) =>
		new RegExp(`@${handle}$`, "i").test(button.getAttribute("aria-label") ?? ""),
	);
	if (buttons.length !== 1) return { confirmed: false, pending: false, following: false };
	const following = (buttons[0].getAttribute("data-testid") ?? "").endsWith("-unfollow");
	const pending = !!document.querySelector('[data-testid="confirmationSheetDialog"]');
	return { confirmed: following === wanted, pending, following };
}

export function pendingDialog(): { open: boolean; text: string } {
	const dialog = document.querySelector<HTMLElement>('[data-testid="confirmationSheetDialog"]');
	return { open: !!dialog, text: clean(dialog?.textContent).slice(0, 300) };
}

// The dialog's own verb depends on the direction: "Follow @x?" confirms a follow
// of a protected account, "Unfollow @x?" confirms an unfollow. Matching only
// "Follow" found nothing in the unfollow case and the command stopped on a
// dialog that was right there.
const PENDING_CONFIRM = /^(Follow|Unfollow|关注|取消关注)$/;

export function pendingConfirm(token: string): Point {
	const dialog = document.querySelector<HTMLElement>('[data-testid="confirmationSheetDialog"]');
	if (!dialog) fail("selector_changed", "No confirmation dialog is open");
	const buttons = findRendered<HTMLElement>(
		dialog,
		'[data-testid="confirmationSheetConfirm"],[role="button"],button',
	).filter((element) => PENDING_CONFIRM.test(clean(element.textContent)));
	if (buttons.length !== 1) fail("identity_mismatch", "The confirmation offers no single follow control");
	return point(buttons[0], token);
}
