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
		const aimed = sized && !!hit && (hit === element || element.contains(hit));
		// Aiming at a control that is still moving is not aiming at it: the press
		// is issued later than this measurement. The position must hold for one
		// frame before the control counts as armed.
		const still = rect.top === previousTop;
		previousTop = rect.top;
		last = { width: Math.round(rect.width), height: Math.round(rect.height), covered: sized && !aimed };
		if (aimed && still && !disabled) {
			element.setAttribute("data-x-cli-control", token);
			return { x, y, selector: `[data-x-cli-control="${token}"]` };
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
