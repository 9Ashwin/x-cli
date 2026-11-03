// Whether the replies this account writes are converging on one shape.
//
// A single draft can pass every check and still be the fifth time the same
// opening was used. That failure is invisible from one draft: `comment check`
// measures a draft against a section, and the section does not know what this
// account said yesterday. This measures the drafts against each other.
//
// The judgement is deliberately structural, not stylistic. It does not try to
// say the replies are too similar in meaning — that is not checkable. It says
// whether they start the same way, end the same way, and are the same length,
// which is what a template looks like from the outside.
//
// `template` is not an instruction to change a word. Replacing a synonym keeps
// the shape and loses the point; the answer is a different angle.

export type Sameness = "varied" | "narrowing" | "template" | "too-few";

export interface SamenessReport {
	verdict: Sameness;
	// How many confirmed replies were looked at.
	samples: number;
	// The repetition each part of the verdict came from.
	openings: { prefix: string; count: number }[];
	endings: { suffix: string; count: number }[];
	// Spread of reply lengths, in characters. Zero spread is a template.
	length: { min: number | null; max: number | null; median: number | null };
	note: string;
}

const PREFIX = 4;
const SUFFIX = 3;

function tail(text: string, size: number): string {
	const chars = Array.from(text.replace(/\s+/g, " ").trim());
	return chars.slice(Math.max(0, chars.length - size)).join("");
}

function head(text: string, size: number): string {
	return Array.from(text.replace(/\s+/g, " ").trim()).slice(0, size).join("");
}

function countTop(values: string[], size: number): { key: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const value of values) {
		if (Array.from(value).length < size) continue;
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((left, right) => right.count - left.count);
}

export function measureSameness(texts: string[], window = 20): SamenessReport {
	const recent = texts
		.map((text) => text.trim())
		.filter(Boolean)
		.slice(0, window);
	if (recent.length < 3)
		return {
			verdict: "too-few",
			samples: recent.length,
			openings: [],
			endings: [],
			length: { min: null, max: null, median: null },
			note: "Fewer than three confirmed replies so far; nothing to compare yet.",
		};

	const openings = countTop(
		recent.map((text) => head(text, PREFIX)),
		PREFIX,
	).map((entry) => ({ prefix: entry.key, count: entry.count }));
	const endings = countTop(
		recent.map((text) => tail(text, SUFFIX)),
		SUFFIX,
	).map((entry) => ({ suffix: entry.key, count: entry.count }));
	const lengths = recent.map((text) => Array.from(text).length).sort((left, right) => left - right);
	const median = lengths[Math.floor(lengths.length / 2)] ?? null;
	const min = lengths[0] ?? null;
	const max = lengths.at(-1) ?? null;

	const topOpening = openings[0]?.count ?? 0;
	const topEnding = endings[0]?.count ?? 0;
	// A third of the window starting the same way is not a coincidence in a run of
	// twenty; at three of twenty it still is. The share is what is used rather
	// than an absolute count, because a window of five and a window of twenty are
	// not the same evidence.
	const openingShare = topOpening / recent.length;
	const endingShare = topEnding / recent.length;
	// Length spread of under one character per reply means every reply is the same
	// length, which no person writing about different posts does by accident.
	const spread = min !== null && max !== null ? max - min : 0;
	const tightLength = recent.length >= 4 && spread <= 2;

	const template = tightLength || (openingShare >= 0.4 && endingShare >= 0.4) || openingShare >= 0.5;
	// Length alone only counts as evidence once there are enough replies for "all
	// similar lengths" to mean something. Three replies spread 17 characters apart
	// are three replies; calling that a narrowing was the first version's false
	// positive.
	const tightForWindow = recent.length >= 4 && spread <= Math.max(6, (median ?? 0) * 0.25);
	// The shared ending has to be words. Three replies ending in "。" share a
	// suffix and nothing else, and calling that a pattern would flag every section
	// written in full sentences.
	const narrowEnding = topEnding >= 2 && endingShare >= 0.3 && /[^\s\p{P}]/u.test(endings[0]?.suffix ?? "");
	// A share alone is not enough in a small window: one reply out of three is
	// already 33%, so a single occurrence was being called a pattern. Two is the
	// floor, because repetition is the whole claim.
	const narrowOpening = topOpening >= 2 && openingShare >= 0.3;
	const narrowing = narrowOpening || narrowEnding || tightForWindow;

	const verdict: Sameness = template ? "template" : narrowing ? "narrowing" : "varied";
	// Every verdict names the evidence it came from. A "template" that does not
	// say what repeated is an accusation with no charge in it — and in this log
	// the repetition was three replies ending "稍后删除。", not a writing habit.
	const reasons = [
		narrowOpening ? `${openings[0].count} of the last ${recent.length} replies open with "${openings[0].prefix}".` : "",
		narrowEnding ? `${endings[0].count} of ${recent.length} end with "${endings[0].suffix}".` : "",
		tightLength || tightForWindow ? `Lengths sit within ${spread} characters of each other.` : "",
		openingShare >= 0.4 && endingShare >= 0.4
			? `Both the opening and the ending repeat in ${Math.round(openingShare * 100)}% of replies.`
			: "",
	].filter(Boolean);
	const note =
		verdict === "varied"
			? "Openings, endings and lengths vary across the confirmed replies."
			: reasons.length
				? reasons.join(" ")
				: "The shapes are starting to repeat.";

	return {
		verdict,
		samples: recent.length,
		openings: openings.slice(0, 5),
		endings: endings.slice(0, 5),
		length: { min, max, median },
		note,
	};
}
