export interface PageError {
	code: string;
	message: string;
	hint?: string;
}

export function fail(code: string, message: string, hint = ""): never {
	throw { code, message, hint } satisfies PageError;
}

export function one<T>(items: T[], label: string): T {
	if (items.length !== 1) {
		fail(
			"selector_changed",
			`Expected one ${label}, found ${items.length}`,
			"Read status and take a screenshot; the page may have changed.",
		);
	}
	return items[0];
}

export function clean(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

export function rendered(element: Element | null): element is HTMLElement {
	if (!element) return false;
	const rect = element.getBoundingClientRect();
	const style = getComputedStyle(element);
	return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

export function findRendered<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T[] {
	return [...root.querySelectorAll<T>(selector)].filter(rendered);
}

export function visible(element: Element | null): element is HTMLElement {
	if (!element) return false;
	const rect = element.getBoundingClientRect();
	const style = getComputedStyle(element);
	return (
		rect.width > 0 &&
		rect.height > 0 &&
		rect.bottom > 0 &&
		rect.right > 0 &&
		rect.top < innerHeight &&
		rect.left < innerWidth &&
		style.display !== "none" &&
		style.visibility !== "hidden" &&
		style.opacity !== "0"
	);
}

export interface Point {
	x: number;
	y: number;
	selector: string;
	// The attribute value this point actually marked the element with. It is
	// unique per call, and a guard that re-checks the control at press time must
	// compare against this rather than against the token its caller passed in.
	mark?: string;
}

// A control is armed only when a press at its centre would land on it, and the
// point it returns is measured after any scroll.
//
// The previous version scrolled the control to the middle of the viewport and
// then returned the centre measured *before* that scroll. On a status page the
// reply control moved 37px, every press landed on the tweet above it, and the
// reply dialog never opened — while the measurement itself reported success,
// because the pre-scroll coordinates did aim at the control.
export function point(element: HTMLElement, token: string): Point {
	const box = element.getBoundingClientRect();
	const inView = box.top >= 0 && box.bottom <= innerHeight && box.width > 0 && box.height > 0;
	// `instant` rather than the default: X sets smooth scrolling, and a smooth
	// scrollIntoView is still animating when the next frame is measured. The point
	// then described the page mid-scroll, the press landed elsewhere, and the
	// control was reported armed anyway.
	if (!inView) element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
	const disabled = !!element.closest(':disabled,[aria-disabled="true"]');
	let last = { width: 0, height: 0, covered: false };
	let previousTop = Number.NaN;
	for (let attempt = 0; attempt < 25; attempt++) {
		// Measured fresh on every attempt, so a layout that settled after the first
		// frame is what the returned point describes.
		const rect = element.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		const hit = document.elementFromPoint(x, y);
		const sized = rect.width > 0 && rect.height > 0;
		// The thing at that point may be any descendant of the control — an icon
		// path, a span inside a button — and it may also be an ancestor that wraps
		// it. Both mean the press lands on the control; requiring the control to
		// contain the hit alone refused a like button whose visible content is a
		// span the button is drawn around, not inside.
		const aimed = sized && !!hit && (hit === element || element.contains(hit) || hit.contains(element));
		// Aiming at a control that is still moving is not aiming at it: the press
		// is issued later than this measurement. The position must hold for one
		// frame before the control counts as armed.
		const still = rect.top === previousTop;
		previousTop = rect.top;
		last = { width: Math.round(rect.width), height: Math.round(rect.height), covered: sized && !aimed };
		if (aimed && still && !disabled) {
			// A unique value per call. Sharing one token across two controls made
			// `[data-x-cli-control="..."]` match both once the second was marked, and
			// Playwright refused the press as ambiguous. That happened three times —
			// reply control and post button, caret and menu item, and a toggle and its
			// own successor — so uniqueness is generated here rather than asked of
			// every caller.
			//
			// The counter alone was not enough: the adapter is re-injected for every
			// call, so a module-level counter restarted at 1 each time and the same
			// mark landed twice across two calls in one command. The random tail is
			// what survives that.
			const mark = `${token}-${Math.random().toString(36).slice(2, 10)}`;
			element.setAttribute("data-x-cli-control", mark);
			return { x, y, selector: `[data-x-cli-control="${mark}"]`, mark };
		}
		sleepSync(80);
	}
	const why = disabled
		? "it is disabled"
		: last.width === 0 || last.height === 0
			? `it has no size (${last.width}x${last.height}); the page had two seconds to paint it`
			: "something is covering it";
	fail("selector_changed", `Target control is not clickable because ${why}`);
}

function sleepSync(ms: number): void {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		/* let the layout settle between two measurements */
	}
}

// An empty Draft.js editor still holds one block, so its innerText is "\n". An
// emptiness check on the raw value therefore called every fresh composer a draft
// and the send path refused before typing anything.
export function editorText(editor: HTMLElement): string {
	return editor.innerText.replace(/\r\n/g, "\n").replace(/[​﻿]/g, "").replace(/\n+$/, "").trim();
}
