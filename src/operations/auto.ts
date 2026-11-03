import type { Session } from "../browser.ts";
import { CliError } from "../errors.ts";
import type { Store } from "../store.ts";
import type { TweetRow } from "./comments.ts";
import { type History, historyOf } from "./engaged.ts";
import { type Engagement, findHot, type HotPost } from "./hot.ts";
import { waitFor } from "./navigation.ts";
import { profileSection, type SectionProfile } from "./section.ts";
import { readSeen, remember, type SeenState, stateOf } from "./seen.ts";
import { readTimeline } from "./sources.ts";
import { waitForBoard } from "./trend.ts";
import type { Input } from "./validate.ts";

// One pass over what is being talked about, ending in a ranked shortlist.
//
// The shortlist is the whole point of this command, and it is ranked by one
// question: where could a reply still say something? That is not the same as
// "which post is biggest". A post with 90K likes and 4,000 replies already has
// its reply section full; a post with 3K likes and 20 replies is where a reply is
// read. So the ranking combines reach with how much of the section is *not*
// already occupied — and every number it uses is one the page printed.
//
// What this command deliberately does not do: it does not write a reply, choose
// what a reply should say, or send anything. It opens each candidate's section,
// measures it, and reports what is there. The writing is the caller's job, and
// `comment check` is there to measure the result against the same section.

export interface Candidate {
	id: string;
	handle: string | null;
	name: string | null;
	text: string;
	at: string | null;
	url: string;
	engagement: Engagement;
	// Where this candidate came from, so a thin result can be traced to a source.
	source: "timeline" | "trend" | "search";
	// The topic or query that produced it, when there was one.
	via: string | null;
	// The section as it actually reads. Null when this candidate was not
	// measured — the default, because measuring costs a navigation per post.
	section: SectionProfile | null;
	// Whether this candidate's section was read at all.
	measured: boolean;
	// Why the section could not be measured, when it could not.
	section_error: string | null;
	// Numbers the ranking used. Kept in the response so the order is inspectable
	// rather than something the caller has to trust.
	signals: {
		// Views per reply: how much attention each reply is competing for.
		attention_per_reply: number | null;
		// How much of the loaded section carries a real point. High means the
		// conversation is already saying specific things, and a new reply has to
		// meet that bar; low means there is room for one.
		section_substance: number | null;
		// Reach that is not already spent on an enormous thread.
		openness: number | null;
		// Which unit `attention_per_reply` was computed from, because a views-based
		// number and a likes-based number are not comparable across sources.
		attention_basis: "views" | "likes" | null;
	};
	// The one-line reason this candidate is where it is.
	why: string;
	// Whether this tool has already put the post in front of its caller.
	seen: SeenState;
	// What this account has already done to the post, when it has done anything.
	// A reply means it is not offered again; a like or a repost only demotes it.
	// Distinct from `engagement`, which is the post's own counts.
	history: History | null;
	// Questions worth answering, phrased as what the reader should look for.
	// These are pointers into the post, never drafted replies.
	angles: string[];
}

export interface SuggestResult {
	sources: ("timeline" | "trend" | "search")[];
	considered: number;
	measured: number;
	// Candidates skipped from the ranking because they were shown recently.
	// They are still in `items`, ranked after the fresh ones.
	seen_skipped: number;
	// Candidates left out entirely because this account has already replied to
	// them. They are not in `items`: a second reply to the same post is a
	// duplicate, not a choice.
	already_replied: string[];
	items: Candidate[];
	scope: "loaded_dom";
	complete: false;
	limits: string[];
}

const MAX_MEASURED = 8;

function goal(input: Input): "reach" | "reply" | "conversation" {
	const value = (input.goal ?? "reply").toLowerCase();
	if (value === "reach" || value === "reply" || value === "conversation") return value;
	throw new CliError("invalid_argument", "--goal must be reach, reply or conversation");
}

function numeric(value: number | null | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Reach as the page stated it. A timeline card prints likes but not views, and a
// search card prints both; those are different units, so which one was used is
// carried alongside the number instead of being flattened into one anonymous
// score. It matters: 900 likes is a bigger post than 1,800 views, and a ranking
// that treated them as the same number would bury the former.
function reachOf(post: HotPost): { value: number | null; basis: "views" | "likes" | null } {
	const views = numeric(post.engagement.views);
	if (views !== null) return { value: views, basis: "views" };
	const likes = numeric(post.engagement.likes);
	if (likes !== null) return { value: likes, basis: "likes" };
	return { value: null, basis: null };
}

// The opening score. Nulls are not zero: a card that printed neither number is
// not a card with no reach, so it drops out of the product rather than dragging
// the score down.
function openness(post: HotPost): number | null {
	const reach = reachOf(post).value;
	const replies = numeric(post.engagement.replies);
	if (reach === null) return null;
	if (replies === null) return reach;
	// A thread with as many replies as a fifth of its viewers is saturated: each
	// reply sees about five readers. Below that, a reply still gets read.
	return reach / (replies + 1);
}

function substance(section: SectionProfile | null): number | null {
	if (!section || section.replies === 0) return null;
	return section.shape["has-a-point"] / section.replies;
}

function anglesFor(post: HotPost, section: SectionProfile | null): string[] {
	const angles: string[] = [];
	const text = post.text;
	if (/[?？]/.test(text)) angles.push("The post asks a question — answer it with a position, not with agreement.");
	if (section && section.replies === 0)
		angles.push("No replies have loaded: a reply here is the first one, so it sets the tone more than it joins it.");
	if (section && section.shape["generic-praise"] > section.shape["has-a-point"])
		angles.push(
			`${section.shape["generic-praise"]} of ${section.replies} loaded replies are generic praise, so a reply that names something specific will not read like the rest.`,
		);
	if (section && section.questions === 0)
		angles.push("Nobody in the loaded section asks anything; a question would stand out.");
	if (section?.liked.median_length !== null && section?.liked.median_length !== undefined)
		angles.push(
			`Replies that drew a like run about ${section.liked.median_length} characters — that is the length being read here.`,
		);
	if (numeric(post.engagement.replies) && numeric(post.engagement.likes)) {
		const replies = post.engagement.replies as number;
		const likes = post.engagement.likes as number;
		if (replies > 0 && likes / replies > 50)
			angles.push(
				"Much more liked than answered: the thread is agreeing, not arguing. A counterpoint would be visible.",
			);
		if (replies > 0 && likes / replies < 3)
			angles.push("Replies outnumber likes heavily: people are arguing. Read a few before adding one.");
	}
	if (angles.length === 0) angles.push("Nothing stands out yet — read the post itself before choosing an angle.");
	return angles.slice(0, 4);
}

function whyFor(goalValue: ReturnType<typeof goal>, signals: Candidate["signals"], post: HotPost): string {
	const views = numeric(post.engagement.views);
	const replies = numeric(post.engagement.replies);
	const likes = numeric(post.engagement.likes);
	const parts: string[] = [];
	// A timeline card carries no views; saying nothing about reach there would make
	// the "why" look the same for every candidate that source produced.
	if (views !== null) parts.push(`${views.toLocaleString("en-US")} views`);
	else if (likes !== null) parts.push(`${likes.toLocaleString("en-US")} likes`);
	if (replies !== null) parts.push(`${replies.toLocaleString("en-US")} replies`);
	if (goalValue === "reach") parts.push("reach is weighted highest");
	if (goalValue === "reply" && signals.attention_per_reply !== null)
		parts.push(
			signals.attention_basis === "views"
				? `${signals.attention_per_reply.toLocaleString("en-US")} viewers per reply`
				: `${signals.attention_per_reply.toLocaleString("en-US")} likes per reply`,
		);
	if (goalValue === "conversation" && signals.section_substance !== null)
		parts.push(`${Math.round(signals.section_substance * 100)}% of loaded replies carry a point`);
	// A card that printed no counts at all still became a candidate, and an empty
	// `why` reads as a bug rather than as "the page did not say".
	if (!parts.length) parts.push("no engagement counts on the card — ranked by what its section showed");
	return parts.join(" · ");
}

async function measureSection(
	session: Session,
	post: HotPost,
	signal: AbortSignal,
	scrolls: number,
	limit: number,
): Promise<{ section: SectionProfile | null; error: string | null }> {
	await session.tab.goto(`https://x.com/${post.handle ?? "i"}/status/${post.id}`, { waitUntil: "domcontentloaded" });
	await waitFor(
		() => session.call<TweetRow[]>("tweet.list"),
		(rows) => rows.some((row) => row.id === post.id) || rows.length > 1,
		signal,
		15_000,
		"the post's replies",
	).catch(() => []);

	const collected = new Map<string, TweetRow>();
	const read = async () => {
		for (const row of await session.call<TweetRow[]>("tweet.list")) {
			// Promoted replies ride in the same list and are not part of the
			// conversation: one ad card here drew 5,393 likes and would have led the
			// section's "what gets a reaction" reading on its own.
			if (row.id === post.id || row.promoted) continue;
			collected.set(row.id, row);
		}
	};
	// A read that lands while the page is navigating is a wait. Retrying it is
	// what turns that race into a measurement instead of an internal error.
	const guarded = async () => {
		try {
			await read();
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "";
			if (/Execution context|context was destroyed|Target closed|navigat/i.test(message)) return;
			throw error;
		}
	};
	await guarded();
	for (let done = 0; done < scrolls && collected.size < limit; done++) {
		signal.throwIfAborted();
		const before = collected.size;
		await session.call("conversation.scroll", { pixels: 900 });
		let grew = false;
		for (let attempt = 0; attempt < 8; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 300));
			await guarded();
			if (collected.size > before) {
				grew = true;
				break;
			}
		}
		if (!grew) break;
	}
	const rows = [...collected.values()].slice(0, limit);
	return { section: profileSection(rows), error: null };
}

export async function suggest(
	session: Session,
	input: Input,
	signal: AbortSignal,
	deps: { store: Store },
): Promise<SuggestResult> {
	const goalValue = goal(input);
	const withinDays = Math.max(input.seen_within ?? 7, 0);
	const seen = await readSeen(deps.store);
	// The operation log is this machine's own record: replies, likes, reposts and
	// bookmarks made here. A post answered from another machine is not in it, so
	// the answer says what it knows rather than what it assumes.
	const engaged = historyOf(await deps.store.events());
	const sources = (input.source ?? "timeline,trend,search")
		.split(",")
		.map((value) => value.trim())
		.filter(
			(value): value is SuggestResult["sources"][number] =>
				value === "timeline" || value === "trend" || value === "search",
		);
	if (!sources.length) throw new CliError("invalid_argument", "--source must name timeline, trend or search");
	const pool = new Map<string, HotPost & { source: Candidate["source"]; via: string | null }>();
	const failures: string[] = [];

	const replied: string[] = [];
	const add = (post: HotPost, source: Candidate["source"], via: string | null) => {
		if (!post.id || post.promoted || post.mine) return;
		// Already answered: offering it again would be offering a duplicate.
		if (engaged.get(post.id)?.post === "replied") {
			if (!replied.includes(post.id)) replied.push(post.id);
			return;
		}
		const existing = pool.get(post.id);
		// A post found by two sources is kept once, with whichever reading has the
		// more complete engagement.
		if (existing && (existing.engagement.views ?? 0) >= (post.engagement.views ?? 0)) return;
		pool.set(post.id, { ...post, source, via });
	};

	// A topic turns the timeline into a filter rather than a source. The home
	// timeline is what X chose to show, so when the caller names a subject, a post
	// from it that has nothing to do with that subject is noise — one run with
	// `--query "AI agent"` returned an Elon Musk post among the results. The
	// timeline still contributes; it just has to be about the topic.
	//
	// The match is any word of the query rather than the whole phrase, because a
	// phrase is what the search box understands, not what a post says: a Chinese
	// post about the topic writes "AI 智能体" and would never contain "ai agent".
	//
	// Latin words are matched on word boundaries, not as substrings: "ai" is two
	// letters and appears inside `AlchainHust` and `BirdAlbum`, which is how an
	// account with no relation to the topic survives a filter that claims to keep
	// only the topic. A CJK word has no word boundaries to use, so it is matched
	// as written.
	const words = (input.query ?? "")
		.toLowerCase()
		.split(/[\s,，]+/)
		.map((word) => word.trim())
		.filter((word) => word.length >= 2);
	const patterns = words.map((word) =>
		/[\u3400-\u9fff]/.test(word)
			? null
			: new RegExp(`(^|[^a-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_]|$)`, "i"),
	);
	const aboutTopic = (text: string) =>
		!words.length ||
		words.some((word, index) => {
			const pattern = patterns[index];
			return pattern ? pattern.test(text) : text.toLowerCase().includes(word);
		});
	let droppedByTopic = 0;

	if (sources.includes("timeline")) {
		const timeline = await readTimeline(session, { ...input, limit: input.limit ?? 20 }, signal).catch(
			(error: unknown) => {
				failures.push(`timeline: ${error instanceof Error ? error.message : String(error)}`);
				return null;
			},
		);
		for (const row of timeline?.items ?? []) {
			if (!aboutTopic(`${row.text} ${row.handle ?? ""}`)) {
				droppedByTopic++;
				continue;
			}
			add({ ...row, engagement: parseTimelineEngagement(row), rank: 0 }, "timeline", null);
		}
	}

	if (sources.includes("trend")) {
		// A trending word is a query, not a post. Using it as a search term is the
		// cheap way to turn "what is the board saying" into "which posts carry it".
		const board = await waitForBoard(session, "trending", signal).catch((error: unknown) => {
			failures.push(`trend board: ${error instanceof Error ? error.message : String(error)}`);
			return [] as { topic: string }[];
		});
		const terms = board
			.slice(0, 3)
			.map((entry) => entry.topic)
			.filter(Boolean);
		for (const term of terms) {
			signal.throwIfAborted();
			const hot = await findHot(session, { ...input, query: term, limit: 5 }, signal).catch((error: unknown) => {
				failures.push(`trend "${term}": ${error instanceof Error ? error.message : String(error)}`);
				return null;
			});
			for (const post of hot?.items ?? []) add(post, "trend", term);
		}
	}

	// The default source list includes search, and a bare `auto suggest` has no
	// query. Dropping it silently is right there — the other two sources already
	// answered — but a caller who asked for search alone gets told why it is empty.
	if (sources.includes("search") && !(input.query ?? "").trim()) {
		if (sources.length === 1)
			throw new CliError("invalid_argument", "--source search needs --query", {
				hint: "Pass --query 'AI agent', or drop search from --source.",
			});
		failures.push("search: skipped, no --query given");
	} else if (sources.includes("search")) {
		const hot = await findHot(session, input, signal);
		for (const post of hot.items) add(post, "search", input.query ?? null);
	}

	if (!pool.size)
		throw new CliError("not_found", "No candidate posts were loaded", {
			hint: "Every source came back empty. Try --source search --query <topic>, or a larger --limit.",
			details: { sources, failures },
		});

	// Rank first, then measure only what the caller asked to measure.
	//
	// The first version always opened the top eight conversations to profile
	// their sections. That is eight navigations on top of the three sources, and
	// the command took ~40 seconds against a 45-second default timeout — it
	// worked until the page was a little slow and then failed outright, losing
	// every source's work. Ranking needs only what the cards already print; the
	// section is a second, optional step, and the caller who wants it should pay
	// for it on the posts they actually care about.
	const ranked = [...pool.values()]
		.map((post) => ({ post, score: openness(post) ?? 0 }))
		.sort((left, right) => right.score - left.score);
	const measureLimit = Math.min(Math.max(input.section_limit ?? 0, 0), MAX_MEASURED);
	const measured = ranked.slice(0, measureLimit);

	const scrolls = Math.min(Math.max(input.scrolls ?? 2, 0), 10);
	const sectionLimit = Math.min(Math.max(input.replies ?? 40, 1), 200);
	const profiles = new Map<string, SectionProfile | null>();
	const sectionErrors = new Map<string, string | null>();
	for (const { post } of measured) {
		signal.throwIfAborted();
		try {
			profiles.set(post.id, (await measureSection(session, post, signal, scrolls, sectionLimit)).section);
		} catch (error: unknown) {
			// A section that could not be read is still a candidate: the post exists,
			// and the caller can open it by hand. Losing the whole list because one
			// reply page was slow would be the wrong failure.
			sectionErrors.set(post.id, error instanceof Error ? error.message : String(error));
		}
	}

	const items: Candidate[] = ranked.map(({ post }) => {
		const section = profiles.get(post.id) ?? null;
		const reach = reachOf(post);
		const replies = numeric(post.engagement.replies);
		const signals: Candidate["signals"] = {
			attention_per_reply:
				reach.value !== null && replies !== null && replies > 0 ? Math.round(reach.value / replies) : null,
			section_substance: substance(section),
			openness: openness(post),
			attention_basis: reach.basis,
		};
		return {
			id: post.id,
			handle: post.handle,
			name: post.name,
			text: post.text,
			at: post.at,
			url: `https://x.com/${post.handle ?? "i"}/status/${post.id}`,
			engagement: post.engagement,
			source: post.source,
			via: post.via,
			// Null when this candidate was not measured. That is not the same as a
			// section that failed to load, which carries `section_error`.
			section,
			section_error: sectionErrors.get(post.id) ?? null,
			measured: profiles.has(post.id) || sectionErrors.has(post.id),
			signals,
			why: whyFor(goalValue, signals, post),
			seen: stateOf(seen, post.id, withinDays),
			history: engaged.get(post.id) ?? null,
			angles: anglesFor(post, section),
		};
	});

	// The final order follows the goal. This is the one place the command ranks,
	// and it says which numbers it used. `attention_per_reply` is the default
	// because it is the only one that is meaningful for every source: it survives
	// a timeline card having no views, and it is the question a reply actually
	// faces — how many readers does each reply get?
	const score = (candidate: Candidate): number => {
		const attention = candidate.signals.attention_per_reply ?? candidate.signals.openness ?? 0;
		if (goalValue === "conversation") return attention * (1 - (candidate.signals.section_substance ?? 0));
		if (goalValue === "reach") return candidate.signals.openness ?? 0;
		return attention;
	};
	// A post shown inside the window keeps its place in the list but loses its
	// place in the order. Dropping it would hide a post that is still being
	// discussed; ranking it first would make a scheduled run say the same thing
	// twice. This is the compromise, and `seen_skipped` counts it instead of
	// leaving the caller to infer it from the order.
	// A post this account already touched ranks with the seen ones: it is not
	// new information, whether the reason is "we suggested it" or "you liked it".
	const fresh = (candidate: Candidate) => (candidate.seen.seen_recently || candidate.history ? 1 : 0);
	items.sort((left, right) => fresh(left) - fresh(right) || score(right) - score(left));
	const seenSkipped = items.filter((candidate) => candidate.seen.seen_recently).length;
	await remember(
		deps.store,
		items.map((candidate) => candidate.id),
	);

	return {
		sources,
		considered: pool.size,
		measured: items.filter((candidate) => candidate.measured).length,
		seen_skipped: seenSkipped,
		already_replied: replied,
		items,
		scope: "loaded_dom",
		complete: false,
		limits: [
			"This ranks candidates; it does not write or send anything. What the reply says is the caller's work.",
			"`angles` point at what is in the post and section. They are not drafted replies and should not be pasted as one.",
			"Each candidate's section was read as a window, like `comment section`: the replies X chose to render, not all of them.",
			"A candidate whose section could not be read keeps its engagement numbers and reports `section_error`.",
			`Sections are not read unless \`--section-limit\` is given: each costs a navigation, and doing eight of them made this command take forty seconds against a forty-five second timeout. Rank first, then run \`comment section\` on the candidates you care about. At most ${MAX_MEASURED} can be measured in one call.`,
			`A post already shown in the last ${withinDays} day(s) is ranked after the fresh ones and marked \`seen.seen_recently\`; it is not dropped. This is what keeps a scheduled run from proposing the same post twice. \`--seen-within 0\` turns the check off.`,
			`${replied.length} candidate(s) were left out because this account has already replied to them. That list is this machine's own operation log; replies made elsewhere are not in it.`,
			...(words.length
				? [
						`--query \`${input.query}\` filtered the timeline: ${droppedByTopic} post(s) that mentioned none of its words were dropped. The search and trend sources already apply it as a query.`,
					]
				: []),
		],
	};
}

// The timeline reader returns likes/replies/retweets but not views or bookmarks;
// there is no engagement label on the home timeline cards. Mapping what is there
// into the same shape keeps the ranking from special-casing a source.
function parseTimelineEngagement(row: TweetRow): Engagement {
	return {
		likes: row.likes,
		replies: row.replies,
		reposts: row.retweets,
		bookmarks: null,
		views: null,
	};
}
