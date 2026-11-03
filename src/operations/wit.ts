// What makes a reply worth reading, measured rather than asserted.
//
// "Write like a person" is not something a regex can check, and a tool that
// claimed to would be lying. What can be checked is the failure mode that makes
// a reply worthless: generic praise, which is a sentence that fits any post in
// the category and therefore says nothing about this one.
//
// So the judgement here is narrow and honest. It answers: does this draft name
// something concrete, does it take a position, does it avoid the adjectives that
// apply to everything. It does not decide whether the draft is good, and it does
// not claim to know whether a person wrote it.

export interface Wit {
	// Phrases that carry a referent: a title, a name, a number, a place.
	specific: string[];
	// A reversal or a revision — where an opinion usually shows up.
	turns: string[];
	// First person, which is what makes a reply an opinion rather than a caption.
	stance: string[];
	// Adjectives that fit any post in this category. The strongest negative
	// signal, because a reply made only of these could be moved to any other post
	// and lose nothing.
	generic_praise: string[];
	verdict: "has-a-point" | "flat" | "generic-praise";
	// Why the verdict was reached, so a caller can disagree with it.
	reason: string;
}

// A title, a product, a proper noun, a version, a number with a unit. Something
// the reply could not have produced without reading the post.
const SPECIFIC =
	/(《[^》]{1,40}》|「[^」]{1,40}」|"[^"]{2,40}"|[A-Za-z][A-Za-z0-9.+#-]{2,}|\d+(?:\.\d+)?\s*(?:%|万|亿|k|K|M|元|美元|倍|小时|分钟|年|月|天|条|个|次))/;
// Reversal, correction, contrast — the shape an opinion takes.
const TURN =
	/(但|不过|其实|反而|恰恰|问题是|真正|更|倒不如|与其|并不是|而不是|反过来|结果|没想到|意外|麻烦的是|代价|前提是)/;
// First person: a reply that says "I" is answering; one that doesn't is captioning.
const STANCE = /(我觉得|我认为|我看|我用过|试过|我读|我的经验|在我看来|对我而言|我反而|我更|我不这么)/;
// Praise vocabulary with no referent. Each of these can be attached to any post
// in the category, which is exactly the problem.
const GENERIC =
	/(太牛|牛逼|厉害|强|优秀|震撼|惊艳|宝藏|干货|硬核|yyds|绝了|学到了|收藏了|谢谢分享|马克|码住|很有价值|非常有帮助|值得一看|涨知识|开了眼界|太棒了|非常好|完美|天花板|顶级|神仙|王炸|必看|狠狠|直接起飞|拉满|爆赞)/;

function found(body: string, pattern: RegExp): string[] {
	const out = new Set<string>();
	for (const match of body.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
		if (match[0]) out.add(match[0]);
	}
	return [...out];
}

export function measureWit(text: string): Wit {
	const body = text.replace(/\s+/g, " ").trim();
	const specific = found(body, SPECIFIC);
	const turns = found(body, TURN);
	const stance = found(body, STANCE);
	const generic = found(body, GENERIC);
	const characters = Array.from(body).length;

	// Share of the reply spent on words that fit anywhere. Length alone is not
	// the test: a long reply made of these is still saying nothing.
	const praiseChars = generic.reduce((sum, phrase) => sum + Array.from(phrase).length, 0);
	const praiseShare = characters ? praiseChars / characters : 0;

	if (praiseShare >= 0.12 && !specific.length && !stance.length)
		return {
			specific,
			turns,
			stance,
			generic_praise: generic,
			verdict: "generic-praise",
			reason: `${Math.round(praiseShare * 100)}% of the text is praise vocabulary with nothing specific in it; it would fit any post in this category`,
		};
	if (specific.length || stance.length || turns.length)
		return {
			specific,
			turns,
			stance,
			generic_praise: generic,
			verdict: "has-a-point",
			reason: [
				specific.length ? `names ${specific.slice(0, 3).join(", ")}` : "",
				stance.length ? "speaks from the writer's own position" : "",
				turns.length ? "turns on a contrast rather than agreeing flatly" : "",
			]
				.filter(Boolean)
				.join("; "),
		};
	return {
		specific,
		turns,
		stance,
		generic_praise: generic,
		verdict: "flat",
		reason: "nothing specific, no position, and no turn — it reads as agreement without content",
	};
}
