import assert from "node:assert/strict";
import test from "node:test";
import { measureWit } from "../src/operations/wit.ts";

// The check is deliberately narrow: it can tell praise that fits anywhere from a
// reply with a referent or a position. It cannot tell whether a reply is good,
// and these tests pin that limit as much as the behaviour.

test("generic praise is caught", () => {
	const wit = measureWit("太牛了，这个真的很有价值，学到了很多，感谢分享！");
	assert.equal(wit.verdict, "generic-praise");
	assert.ok(wit.generic_praise.length > 0);
});

test("a reply with a referent has a point", () => {
	const wit = measureWit("Remotion 那条最值，用 React 写视频确实比剪辑软件省事");
	assert.equal(wit.verdict, "has-a-point");
	assert.ok(wit.specific.length > 0);
});

test("a reply that speaks from the writer's position has a point", () => {
	const wit = measureWit("我试过把 agent 钉在写日报这一步，一周后就非用不可了");
	assert.equal(wit.verdict, "has-a-point");
	assert.ok(wit.stance.length > 0);
});

test("a contrast counts even without a name", () => {
	const wit = measureWit("这不是工具不够好，其实是没给自己留一个每天都用得上的入口");
	assert.equal(wit.verdict, "has-a-point");
	assert.ok(wit.turns.length > 0);
});

test("agreement with nothing in it is flat", () => {
	const wit = measureWit("确实如此");
	assert.equal(wit.verdict, "flat");
});
