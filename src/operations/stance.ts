// What a reply in a section is actually talking about.
//
// The useful distinction when reading a conversation under a post is not
// "good comment / bad comment" — it is what the reply points at. Under a post
// about a tool, the replies split into:
//
//   about_work  — the thing the post is about
//   about_self  — the writer's own situation
//   asking      — a question
//   spam        — nothing about anything, usually selling
//   unknown     — no signal
//
// This matters because a reply written about the work lands differently from one
// written about the writer. Quoting "hearing you" under a reply that is actually
// talking about having tried the same thing is a mismatch that reads as nobody
// read the section. The section's own distribution is also a useful fact: a
// section that is 70% about_self is not a discussion of the post at all.
//
// What this cannot do: it reads wording, not meaning. A reply can name the
// subject and still be about itself, and one that says "I" can be entirely about
// the work. So the labels are reported with the phrases that produced them, and
// `spam` is deliberately narrow — it needs a selling signal, not just a link.

import { measureWit } from "./wit.ts";

export type Stance = "about_work" | "about_self" | "asking" | "spam" | "unknown";

export interface StanceReading {
	stance: Stance;
	// Why, in the same terms the text used. Empty for `unknown`.
	signals: string[];
}

// Selling, not linking. A reply that shares a link to the thing being discussed
// is about the work; one that offers a service is not.
const SPAM = [
	/(免费领取|私信我|加我|加微信|加V|vx|v信|代理|返利|优惠码|折扣码|开户|带单|跟单|稳赚|拉群|进群|商务合作)/i,
	/(dm me|check my (bio|profile)|link in bio|contact me|free (trial|credit)|sign up (now|today)|limited offer|join (my|our) (group|channel))/i,
	/(https?:\/\/)?(t\.me|wa\.me)\//i,
];
// A question has to be the move the reply is making, not a rhetorical tail. The
// first version matched any question mark in the last stretch, and a long reply
// that ends "...你们觉得呢?" was labelled a question even though everything before
// it was a position. Only a reply that ends on the question, or opens with one,
// is asking.
const ASKING =
	/(^\s*(?:how|why|what|where|which|who|anyone|does anyone|has anyone|can someone|should i)\b|^\s*(?:怎么|如何|为什么|有没有|谁能|请问|求问|想问|有人知道)|[?？]["'）)\]]?\s*$)/i;
// The writer's own life, work, or history — not the post's subject.
const SELF = [
	/(我用过|我试过|我做过|我写过|我之前|我最近|我在用|我的|我这边|我们|我遇到的|我踩过|我踩的|我习惯|我一般)/,
	/(^\s*我(?![们的]))/,
	/(\bi (used|tried|built|wrote|made|had|have|was|am|get|got|work|worked|use|used to)\b|\bmy (team|company|setup|experience|workflow|first)|we (use|used|built|run|tried))/i,
];
// The post's subject, addressed directly rather than through the writer.
const WORK = [
	/(这个|这款|这套|这条|这篇|这玩意|这工具|这个项目|这个东西|这种|你这个|你这套|楼主|作者|视频里|帖子里|文章里)/,
	/(\bthis (one|tool|library|project|post|thread|video|article|approach|idea|repo|course|class|talk)\b|\bthe (tool|project|post|thread|video|article|repo|course)s?\b|\byour (post|thread|video|article|tool|project)\b|\bthe author\b)/i,
	// "不对" is deliberately absent: "不对我们开放" is a statement about access, not
	// disagreement, and it read as one. Only phrasing that can't mean anything
	// else belongs in this list.
	/(确实|同意|有道理|说得好|说反了|不成立|站不住|补一个|补充一点|还有一点)/,
];

function hits(text: string, patterns: RegExp | RegExp[]): string[] {
	const out: string[] = [];
	for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
		const match = pattern.exec(text);
		if (match?.[0]) out.push(match[0].trim());
	}
	return out;
}

export function readStance(text: string): StanceReading {
	const body = text.replace(/\s+/g, " ").trim();
	if (!body) return { stance: "unknown", signals: [] };

	// Spam first: a reply that is selling is not also "about the work", even if it
	// names it. This is the one label where the presence of a phrase decides.
	const spam = hits(body, SPAM);
	if (spam.length) return { stance: "spam", signals: spam };

	// A question is asking regardless of subject — it is the reader's move, not a
	// statement about the post or about themselves.
	const asking = hits(body, [ASKING]);
	if (asking.length) return { stance: "asking", signals: asking };

	// The marker lists only catch a reply that names its subject explicitly, and
	// most replies here do not — they describe the thing. So the fallback is the
	// same signal `comment check` uses for "names something only a reader could
	// know": a title, a product name, a number with a unit. A reply that says
	// "the part about tool calling is the useful one" is about the work without
	// ever writing "this".
	const work = hits(body, WORK);
	const self = hits(body, SELF);
	const specific = measureWit(body).specific;
	if (work.length > self.length) return { stance: "about_work", signals: work };
	if (self.length > work.length) return { stance: "about_self", signals: self };
	if (self.length) return { stance: "about_work", signals: [...work, ...self] };
	if (specific.length) return { stance: "about_work", signals: specific.slice(0, 3) };
	return { stance: "unknown", signals: [] };
}

export interface StanceMix {
	counts: Record<Stance, number>;
	// What most of the loaded section is doing. Null when nothing was readable.
	dominant: Stance | null;
	// The section's own summary, in its terms.
	note: string;
}

export function mixOf(items: StanceReading[]): StanceMix {
	const counts: Record<Stance, number> = {
		about_work: 0,
		about_self: 0,
		asking: 0,
		spam: 0,
		unknown: 0,
	};
	for (const item of items) counts[item.stance]++;
	const total = items.length;
	const ranked = (Object.entries(counts) as [Stance, number][])
		.filter(([stance]) => stance !== "unknown")
		.sort((left, right) => right[1] - left[1]);
	const dominant = ranked[0] && ranked[0][1] > 0 ? ranked[0][0] : null;
	if (!total || !dominant)
		return { counts, dominant: null, note: "No reply in the window carried a readable subject." };
	const share = Math.round((counts[dominant] / total) * 100);
	const notes: Record<Stance, string> = {
		about_work: `Most of the section (${share}%) is about the post itself — quoting the author here is on target.`,
		about_self: `Most of the section (${share}%) is people talking about their own situation, not the post. A reply about the work will stand out; one that only agrees with the crowd will not.`,
		asking: `Most of the section (${share}%) is questions. Answering one directly is the move here.`,
		spam: `Most of the section (${share}%) looks like selling. There is little conversation to join.`,
		unknown: "Most replies carry no readable subject.",
	};
	return { counts, dominant, note: notes[dominant] };
}
