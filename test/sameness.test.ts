import assert from "node:assert/strict";
import test from "node:test";
import { measureSameness } from "../src/operations/sameness.ts";

// Whether this account's replies are converging on one shape. One draft can pass
// every per-draft check and still be the fifth time the same opening was used;
// only the comparison shows it.

test("three different replies are varied", () => {
	const report = measureSameness([
		"这套课把工具调用讲得很细，我之前一直卡在这里",
		"斯坦福这个大纲让我想起自己走过的弯路，评测那部分尤其",
		"收藏了，周末慢慢啃",
	]);
	assert.equal(report.verdict, "varied");
});

test("widely different openings and lengths are varied even at a larger window", () => {
	const report = measureSameness([
		"确实如此，这套课最难的是把评测和工程链路连起来",
		"我去年试过类似的路线，卡在记忆那一层就没继续",
		"工具调用那节的作业设计得好",
		"看完大纲我更想知道他们的评测集是怎么构造的",
	]);
	assert.equal(report.verdict, "varied");
});

test("the same opening half the time is a template", () => {
	const report = measureSameness([
		"确实如此，这套课最有价值的是工程链路那部分内容",
		"确实如此，工具调用这块我之前一直没想明白",
		"确实如此，评测那一章值得单独拿出来讲",
		"确实如此，动手作业的设计比很多课都实在",
		"完全不同意，这套课其实很浅",
	]);
	assert.equal(report.verdict, "template");
	assert.equal(report.openings[0].prefix, "确实如此");
	assert.equal(report.openings[0].count, 4);
});

test("replies of identical length with no shared opening still read as a template", () => {
	// Different words, same shape. A person writing about four different posts
	// does not land on the same character count four times.
	const report = measureSameness([
		"一二三四五六七八九十",
		"甲乙丙丁戊己庚辛壬癸",
		"子丑寅卯辰巳午未申酉",
		"春夏秋冬年月日时分秒",
	]);
	assert.equal(report.verdict, "template");
	assert.equal(report.length.min, report.length.max);
});

test("one repeated closing is narrowing, not varied", () => {
	const report = measureSameness([
		"这套课把工具调用讲得很细，值得一看",
		"我试过类似的路线，不过没走通，值得一看",
		"评测那部分最重要，工业界很少讲，值得一看",
	]);
	assert.equal(report.verdict, "narrowing");
	assert.ok(report.endings[0].count >= 3);
});

test("fewer than three replies is too-few rather than a verdict", () => {
	const report = measureSameness(["只有这一条，说不出来什么"]);
	assert.equal(report.verdict, "too-few");
	assert.equal(report.samples, 1);
});

test("the draft is measured together with what was already written", () => {
	// The caller prepends the draft, so a draft that repeats the established
	// opening has to show up in the same report as the history.
	const history = ["确实如此，这套课的工程链路部分最有价值", "确实如此，工具调用那节讲得细"];
	const report = measureSameness(["确实如此，评测那章值得看", ...history]);
	assert.equal(report.verdict, "template");
	assert.equal(report.samples, 3);
});
