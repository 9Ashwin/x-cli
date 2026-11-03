import assert from "node:assert/strict";
import test from "node:test";
import { mixOf, readStance } from "../src/operations/stance.ts";

// Reading what a reply is about, not whether it is good. The cases below are the
// ones that were actually wrong on a live section and had to be corrected, plus
// the ones that define where each label stops.

test("a reply that names the thing the post is about is about the work", () => {
	// Live section, first pass: this read as unknown because it never says "this"
	// — it just names what it is looking at.
	assert.equal(readStance("可惜没有视频，不过 slides 都写的很细致，翻翻能受益").stance, "about_work");
});

test("a reply about the writer's own situation is about them", () => {
	assert.equal(readStance("我用过这套，前两周就卡在 tool calling 上了").stance, "about_self");
	assert.equal(readStance("I tried this last month and gave up at the auth step").stance, "about_self");
});

test("a question is asking when the question is the move, not a tail", () => {
	// Ends on the question: asking.
	assert.equal(readStance("does these have videos? or only ppt?").stance, "asking");
	assert.equal(readStance("这套课有配套代码吗？").stance, "asking");
	// Opens with the question: asking even though it goes on to say more.
	assert.equal(readStance("怎么把 agent 的记忆接上？我试了几次都不稳").stance, "asking");
});

test("a long position that happens to end with a question is still a position", () => {
	// This was the first version's failure: any question mark in the last stretch
	// made a reply "asking", so a paragraph that argues a point and then invites
	// agreement was filed as a question.
	const text =
		"斯坦福这套课值得看的点不在名校光环，而在它把 agent 拆成了可练的步骤：很多人学了一堆概念，动手还是从零开始。你们觉得呢";
	assert.notEqual(readStance(text).stance, "asking");
});

test("selling is spam even when it names the subject", () => {
	assert.equal(readStance("需要 AI 课程资源的私信我，免费领取").stance, "spam");
	assert.equal(readStance("Great post! Check my bio for a free trial").stance, "spam");
});

test("a link to the thing being discussed is not spam", () => {
	// The difference is selling vs. sharing. A bare link is not enough to call
	// somebody an advertiser.
	assert.equal(readStance("slides 在这里 https://example.com/slides").stance, "about_work");
});

test("'不对我们开放' is not read as disagreement", () => {
	// It was, when "不对" was a marker. It states access, not a counter-claim.
	const reading = readStance("不应该没有视频，只是不对我们开放");
	assert.equal(reading.stance, "about_self");
	assert.ok(!reading.signals.includes("不对"));
});

test("nothing readable is unknown, not a guess", () => {
	assert.equal(readStance("").stance, "unknown");
	assert.equal(readStance("这也算是一种商业需求点。").stance, "unknown");
});

test("the mix reports the dominant subject and says what it means", () => {
	const mix = mixOf([
		readStance("我用过这套，卡在 tool calling"),
		readStance("我上个月也试了"),
		readStance("slides 很细"),
	]);
	assert.equal(mix.dominant, "about_self");
	assert.equal(mix.counts.about_self, 2);
	assert.match(mix.note, /own situation/);
});

test("a section with nothing readable has no dominant subject", () => {
	const mix = mixOf([readStance(""), readStance("这也算是一种商业需求点。")]);
	assert.equal(mix.dominant, null);
	assert.match(mix.note, /readable subject/);
});
