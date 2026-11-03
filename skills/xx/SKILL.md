---
name: xx
description: "Operate X (Twitter) through the local `xx` — read your timeline, the Explore board, a keyword search, or one conversation; post, reply, like, bookmark, repost, follow and delete; and read notifications. Use this whenever the task involves X or Twitter at all: reading what people are saying under a post, finding posts worth answering, warming up a reply, publishing a new post, checking whether something actually went out, or signing in for the first time. Also use it when the user says 看看这条推的评论, 找点热帖, 自动去热帖评论, 挑几条值得回的, 回复这条推, 发个回复, 发个新帖, 查一下发出去没有, 我的收藏在哪, 最近谁找过我, or names X or Twitter in any language without mentioning a CLI."
allowed-tools: Bash(xx:*) Bash(node dist/cli.js:*)
---

# X 上的读与写

`xx` 负责操作页面、留下证据、管住写入。**判断不归它**：读什么、回谁、说什么，都是你的。这个分工是故意的——如果工具替你挑帖、替你写正文，事后没人能问它「为什么选这条」。

这份文件常驻，所以只放每次都用的东西。场景细节在 `references/`。

## 先确认装好、登好

```bash
xx --version || (cd <repo> && pnpm install --ignore-scripts && pnpm build)
xx auth status
```

| 返回 | 怎么办 |
| --- | --- |
| `signed_in: true` | 直接用，`account.handle` 是当前账号 |
| `login_required: true` | `xx auth login`，让主人在窗口里登录 |
| `verification_required: true` | 要人验证，跑不了。让主人处理完再查 |

Google 账号登录会被拒（「此浏览器或应用可能不安全」）。用 `xx auth login --manual`。详见 `references/setup.md`。

`xx schema` 是命令和参数的唯一来源。**注意 schema 里的 id 和命令行输入不一样**：`schema` 报 `comment.post`，敲的是 `xx comment post`。

## 按任务读参考

| 你在做什么 | 读 |
| --- | --- |
| 装、登录被拒、代理、卡住了 | `references/setup.md` |
| 找帖子、挑值得回的、读互动数 | `references/finding.md` |
| 量一个区、写回复、自测、`delivery_uncertain` | `references/writing.md` |
| 发新帖、关注、点赞、删帖、通知、收藏 | `references/account.md` |
| 为什么读到的和预期不一样 | `references/platform-facts.md` |

**冲突时以实际返回为准**，其次 `xx schema`，最后这些文件。

## 最省事的一步

主人说「找几条值得回的」「自动去热帖评论」时，先跑这个，不要从 `feed read` 一条条翻：

```bash
xx auto suggest --goal reply --limit 20
```

它从时间线 / 热榜词 / 关键词收集候选，按「每条回复还能分到多少注意力」排序，并且**打开前 8 条各自的会话把区量出来**。每条带 `section`、`signals`、`why`、`angles`。

**`angles` 是线索不是草稿。** 它指向帖子里已经有的东西（它问了问题、区里全是空话、赞回比失衡）。原样贴出去就是最典型的空话。你要读原帖、形成立场，再写。

它不写正文、不发送。细节和 `--goal` 怎么选见 `references/finding.md`。

## 一条回复的完整流程

```bash
xx comment section --status <id> --scrolls 3       # 1. 这个区长什么样
xx comment check --status <id> --draft "…"        # 2. 我的草稿像不像话
xx comment post --status <id> --text "…" --request-id reply-<id>-01
```

**`--request-id` 必须给，每次新的发送用新的 id。** 不给会被直接拒绝——没有 id 的写入事后没法查、也没法重放。

`comment check` 给两样东西：`verdict`（是不是空话）和 `sameness`（跟你以前发过的比，是不是在变成同一个模子）。**`template` 的解法是换角度，不是换词。**

`check` 是报告不是闸门，过了也不等于写得好——它测不了观点对不对、有没有编造。

## 结果怎么读

| 返回 | 意思 |
| --- | --- |
| `confirmed: true` | 发出去了。证据是成功 toast，或页面上**新增**的一行（文字完全一致、作者是本账号）。**不用再查** |
| `replayed: true` | 这个 request id 之前就成功了，没有重发 |
| `delivery_uncertain` | 按了按钮但页面没给证据。**可能已经发出去** |
| `idempotency_conflict` | 同一个 request id 配了不同文字 |
| `identity_mismatch` | 弹窗不是回复模式，或回的账号不对。**什么都没打进去** |
| `draft_conflict` | 输入框里有别人留下的草稿，被保留了 |
| `needs_confirmation: true` | 半小时内发得有点多，停下来问。看过之后加 `--confirm` |

**`delivery_uncertain` 绝不自动重发。** 它可能已经出现在时间线上，再发就是两条。核对步骤见 `references/writing.md`——注意「历史里没有」不能当作没发出去的证据。

## 做事的时候一直说话

刷一批、看几条、写一条，这种活要跑几分钟。**一条一条说**，别憋到最后一起报。用户在等，他不知道你在干什么，就只能看着屏幕不动；你要是做到第 8 条才发现方向不对，已经浪费了七条。

```
找第 1 条：2.3 万浏览 / 11 回复，区里 70% 在聊帖子本身
找第 2 条：15.6 万浏览 / 1560 回复，区已经满了，跳过
回了第 1 条：「…」
```

**长任务开始前先说一句要做什么、大概几步**，用户好在跑偏时叫停。写操作尤其要边说边做。

不要这样：`✓ 好的，我来找一下` 然后五分钟没声、最后贴一屏 JSON。也不要「正在处理第 1/12 条……」——那是进度条，不是说话。

## 谁需要先问

| 动作 | 默认做法 |
| --- | --- |
| 读、找、量 | 直接做 |
| 公开回复、发新帖 | 默认先说「我要发这条：……」再发 |
| 点赞、收藏、转发、关注 | 用户当轮明确要就做，别自己找帖子点 |
| 删帖、取消关注 | **必须明确同意**，删了没得撤 |

**授权是按当轮的。** 用户说「这轮不用问」就不用问；不要把它写成常驻设置或文件。什么事都需要对外说的时候，用户有权重新决定。

## 硬规则

- **用稳定 id 定位，不用昵称。** 昵称和 handle 都会改，数字 id 不会。
- **不编造读过的内容。** `items` 是什么就说什么，没滚到的地方说没滚到。没读过的帖子不要说「我看过」。
- **公开回复是发给所有人的。** 发之前读一遍：是不是在回答这条，有没有在编经历，像不像模板。
- **`identity_mismatch` 是保护不是故障。** 它拦住「把回复变成公开发帖」和「回错人」。
- **不批量操作陌生人。** X 明确禁止搜到人就自动回复、自动点赞、自动关注。工具没有这类命令，也不该手写循环绕过。
- **自动化身份要声明。** 用这个账号做自动化时，账号简介里应说明这一点和运营者。这是 X 开发者指南的要求，不是建议。
- **测试功能不要拿陌生人的帖子当试验田。** 「测试一下」「验证能否发送」这类句子公开、撤不回，而且会让人莫名其妙。要验证链路用自己的帖子或 `--dry-run`。
- 别为了让命令成功去放宽检查。真的过不去，报告卡在哪。

## 没有的

**私信**——X 要 4 位 passcode，只有账号主人知道，工具代填不了。Lists、Space、书签分组也没有。
