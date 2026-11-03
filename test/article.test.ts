import assert from "node:assert/strict";
import test from "node:test";

// A long-form Article card carries no `tweetText`. The reader falls back to the
// card's own leaf spans, dropping the byline, the "Article" label and the
// action counters. The fallback matters: four of five bookmarks in one account
// are Articles, and reading only `tweetText` returned an empty string for all
// of them — the list looked like blank entries rather than like articles.

const INTERACTION = /^[\d.,]+\s*[KkMm]?$/;

function articleBody(leaves: string[], name = "", context = ""): string {
	const kept = leaves.filter((leaf) => {
		if (leaf === "Article" || leaf === "长文" || leaf === "文") return false;
		if (INTERACTION.test(leaf)) return false;
		if (context && leaf === context) return false;
		if (name && leaf === name) return false;
		if (leaf === "·") return false;
		return true;
	});
	return kept.filter((leaf, index) => leaf !== kept[index - 1]).join(" ");
}

test("an article card yields its headline and standfirst", () => {
	// The shape observed on the real page: name, handle, separator, "Article",
	// headline, standfirst, then counts.
	const leaves = [
		"唐清乐",
		"@tangqingyue",
		"·",
		"Article",
		"纯正干货！五大方法让你成为提示词工程大师",
		'提示词工程实战：从"AI写的很烂"到"AI写得真好"的完整方法',
		"5",
		"10",
		"53",
	];
	const body = articleBody(leaves, "唐清乐");
	assert.match(body, /纯正干货/);
	assert.match(body, /提示词工程实战/);
	assert.ok(!body.includes("Article"));
	assert.ok(!/\b53\b/.test(body));
});

test("a headline rendered twice for layout appears once", () => {
	// X renders the headline in two spans that sit on top of each other.
	const body = articleBody(["Article", "标题在这里", "标题在这里", "摘要一句"], "");
	assert.equal(body, "标题在这里 摘要一句");
});

test("a retweet's social context line is not part of the body", () => {
	const body = articleBody(["某人转推了", "Article", "正文一句"], "", "某人转推了");
	assert.equal(body, "正文一句");
});

test("the byline is not repeated into the body", () => {
	const body = articleBody(["唐清乐", "Article", "正文一句"], "唐清乐");
	assert.ok(!body.includes("唐清乐"));
});

test("an interaction count with a unit is still a count", () => {
	const body = articleBody(["Article", "正文", "1.2K", "34K"], "");
	assert.equal(body, "正文");
});
