import type { TweetRow } from "./comments.ts";
import { measureWit, type Wit } from "./wit.ts";

// What a reply would have to sound like to belong in this conversation.
//
// Measured from the replies already there, not prescribed. The useful part is
// the comparison: which replies got a reaction and which got none, and what the
// length and shape of the section are. A draft written to the median is still a
// draft, but at least it is not obviously out of place.
//
// What this cannot do, and says it cannot: X shows the replies it chose to show.
// Their likes are likes from the subset that loaded. A profile here describes a
// window, and the window is not a sample anyone controlled.

export interface SectionProfile {
	replies: number;
	length: { median: number; p25: number; p75: number; min: number; max: number };
	questions: number;
	exclamations: number;
	// The replies that led their section by likes, with the traits they share.
	led: { id: string; text: string; likes: number | null; wit: Wit }[];
	// What the section says most, by verdict. This is the observation a draft is
	// measured against.
	shape: { "has-a-point": number; flat: number; "generic-praise": number };
	// Reply length that drew at least one like, when any did.
	liked: { count: number; median_length: number | null };
}

function quantile(sorted: number[], q: number): number {
	if (!sorted.length) return 0;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
	return sorted[index];
}

export function profileSection(rows: TweetRow[]): SectionProfile {
	const texts = rows.map((row) => row.text).filter((text) => text.trim());
	const lengths = texts.map((text) => Array.from(text).length).sort((left, right) => left - right);
	const withWit = rows.filter((row) => row.text.trim()).map((row) => ({ row, wit: measureWit(row.text) }));
	const shape = { "has-a-point": 0, flat: 0, "generic-praise": 0 };
	for (const entry of withWit) shape[entry.wit.verdict]++;
	const likedRows = rows.filter((row) => (row.likes ?? 0) > 0 && row.text.trim());
	const likedLengths = likedRows.map((row) => Array.from(row.text).length).sort((left, right) => left - right);
	return {
		replies: rows.length,
		length: {
			median: quantile(lengths, 0.5),
			p25: quantile(lengths, 0.25),
			p75: quantile(lengths, 0.75),
			min: lengths[0] ?? 0,
			max: lengths.at(-1) ?? 0,
		},
		questions: texts.filter((text) => /[?？]/.test(text)).length,
		exclamations: texts.filter((text) => /[!！]/.test(text)).length,
		// "Led" is the most-liked replies in the loaded window, not a ranking of
		// the section: the page's own order is what the reader sees, and re-sorting
		// it would describe a different conversation.
		led: withWit
			.filter((entry) => (entry.row.likes ?? 0) > 0)
			.sort((left, right) => (right.row.likes ?? 0) - (left.row.likes ?? 0))
			.slice(0, 5)
			.map((entry) => ({
				id: entry.row.id,
				text: entry.row.text.slice(0, 240),
				likes: entry.row.likes,
				wit: entry.wit,
			})),
		shape,
		liked: { count: likedRows.length, median_length: likedLengths.length ? quantile(likedLengths, 0.5) : null },
	};
}

export interface DraftCheck {
	verdict: Wit["verdict"];
	wit: Wit;
	length: number;
	// How the draft sits against the section, in the section's own terms.
	against: {
		median_length: number;
		difference: number;
		band: "much-shorter" | "shorter" | "in-range" | "longer" | "much-longer";
	};
	// Things a reader of this section would notice. Each is stated as an
	// observation, never as a rule.
	notes: string[];
	advice: string[];
}

export function checkDraft(text: string, profile: SectionProfile): DraftCheck {
	const body = text.trim();
	const length = Array.from(body).length;
	const wit = measureWit(body);
	const median = profile.length.median;
	const difference = length - median;
	// A band, not a rule: the section's middle half is what a reply should look
	// like, and the two outer bands are where it starts reading as out of place.
	const band: DraftCheck["against"]["band"] =
		median === 0 || length === 0
			? "in-range"
			: length < Math.max(4, profile.length.p25 / 2)
				? "much-shorter"
				: length < profile.length.p25
					? "shorter"
					: length > Math.max(profile.length.p75 * 2, profile.length.p75 + 120)
						? "much-longer"
						: length > profile.length.p75
							? "longer"
							: "in-range";

	const notes: string[] = [];
	if (wit.verdict === "generic-praise") notes.push(wit.reason);
	if (wit.verdict === "flat") notes.push(wit.reason);
	if (band === "much-shorter") notes.push(`The section's median reply is ${median} characters; this is ${length}.`);
	if (band === "much-longer") notes.push(`The section's median reply is ${median} characters; this is ${length}.`);
	if (profile.questions === 0 && /[?？]/.test(body))
		notes.push("No loaded reply asks a question, so a question here would stand out.");
	if (profile.shape["generic-praise"] > profile.shape["has-a-point"] && wit.verdict === "has-a-point")
		notes.push(
			`Most of this section is generic praise (${profile.shape["generic-praise"]} of ${profile.replies}); a reply with a point will read differently from its neighbours.`,
		);

	const advice: string[] = [];
	if (wit.verdict === "generic-praise")
		advice.push("Name the part of the post you are reacting to, or drop the adjectives and keep the claim.");
	if (!wit.stance.length)
		advice.push(
			"Say where you are speaking from — what you tried, read, or expected — rather than describing the post.",
		);
	if (!wit.specific.length && !wit.turns.length)
		advice.push("Add one thing only someone who read this post could say, or one contrast that is yours.");

	return {
		verdict: wit.verdict,
		wit,
		length,
		against: { median_length: median, difference, band },
		notes,
		advice,
	};
}
