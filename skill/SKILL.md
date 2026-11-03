---
name: x
description: Operate X (Twitter) from the command line — read a conversation, post a reply, and check what was actually delivered. Use this whenever the user asks to read X replies, reply to a tweet, check whether a reply went out, or sign in to X for automation. Also use it when the user says 看看这条推特的评论, 回复这条推, 发个回复, 查一下有没有发出去, or refers to X or Twitter by name in any language even without mentioning a CLI.
allowed-tools: Bash(x-cli:*) Bash(node dist/cli.js:*)
---

# X 评论与回复

`x-cli` 是本地能力工具。你负责理解、判断和调度；它负责操作页面并留下回执。

先把工具装好：

```bash
x-cli --version || (cd <repo> && pnpm install --ignore-scripts && pnpm build)
```

`x-cli schema` 是命令和参数的唯一来源。下面没写的以它和实际返回为准。

## 每次开工前先确认登录

```bash
x-cli auth status
```

| 返回 | 怎么办 |
| --- | --- |
| `signed_in: true` | 直接用，`account.handle` 就是当前账号 |
| `login_required: true` | 跑 `x-cli auth login`，让主人在窗口里登录 |
| `verification_required: true` | 要人验证，跑不了。让主人处理完再 `auth status` |

**Google 登录会被拒**，页面显示「此浏览器或应用可能不安全」。这不是账号问题，是调试端口。用 `x-cli auth login --manual`：它关掉自动化浏览器，用同一个 profile 开一个不带调试端口的窗口，等主人关窗口后把登录态读回来。

## 先找候选

不知道从哪条推开始时，先拉一批：

```bash
x-cli timeline read --limit 20 --scrolls 2      # 时间线
x-cli thread list --query "AI agent" --limit 20 # 话题/搜索，走 Latest
x-cli thread get --status <url-or-id>           # 读某一条本身，不含回复
```

三条命令返回同一种条目：`id`、`handle`、`name`、`text`、`at`、`likes`、`replies`、`retweets`、`mine`、`promoted`。

- 广告已从 `items` 里排除，排除了几条写在 `limits` 里。
- `items[].id` 直接能当 `comment post --status` 用。
- 一样是窗口：`scope: "loaded_dom"`、`complete: false`。`--scrolls` 加滚动。

**挑哪条、说什么，是你的判断，工具不做。** 没有「自动挑一条热帖并评论」的命令，也不该去找。

## 节奏

一条一条来。读完一条、想清楚、再写下一条。

先确认这条在说什么（读正文，必要时读它下面的评论），再决定回不回、回什么。**没有值得说的话就不发**，这是常态不是失职。

不要为了「多发几条」去压缩思考时间。工具不提供随机间隔或拟人节奏的参数 —— 那是在让平台看不出你在做什么，不是在帮你写得更好。

## 读评论

```bash
x-cli comment list --status <url-or-id> --limit 20 --scrolls 2
```

- `--status` 吃 URL 也吃纯数字 id。
- `--scrolls` 是额外滚动次数，每滚一次多加载一批回复。默认 0，只拿到首屏。
- `scope: "loaded_dom"`、`complete: false` 是真的：这是页面已渲染的窗口，不是全部回复。**`items` 为空只说明没加载到，不说明没人回复。**
- `depth: 1` 是被画在别人下面的回复，`0` 是顶层。
- `reply_to.id` 恒为 `null`，因为 X 的「Replying to」行链的是主页不是推文。要回复谁，用 `items[].id`。

想发回复之前，先读一遍那段的语气和长度，再写。

## 发回复

```bash
# 回整条推
x-cli comment post --status <id> --text "…" --request-id reply-<id>-01

# 回某一条回复
x-cli comment reply --status <id> --comment-id <reply-id> --text "…" --request-id reply-<id>-02
```

**`--request-id` 必须给，而且每次新的发送用一个新 id。**

写之前先 `--dry-run` 检查参数对不对，它不会开浏览器：

```bash
x-cli comment post --status 123 --text "…" --request-id t-1 --dry-run
```

### 看到什么结果是成功

| 返回 | 意思 |
| --- | --- |
| `confirmed: true` + `result.evidence` | 发出去了。`toast` 是平台自己弹的成功提示，`new_row` 是新行，`modal_closed` 是弹窗关掉（最弱的证据） |
| `replayed: true` | 这个 request id 之前就成功了，没有重发 |
| `delivery_uncertain` | **按了按钮但页面没给证据。可能已经发出去。** |
| `idempotency_conflict` | 同一个 request id 配了不同的文字 |
| `identity_mismatch` | 弹窗不是回复模式，或者回的账号不对。**什么都没打进去。** |
| `draft_conflict` | 输入框里有别人（或上次）留下的草稿，被保留了 |

### `delivery_uncertain` 怎么处理

**绝不自动重发。** 它可能已经出现在时间线上，再发就是两条。

1. 先确认页面没有登录/验证遮罩（有遮罩时读到的页面是旧的）。
2. `x-cli comment list --status <id>`，看你的文字在不在。
3. `x-cli receipt get <request-id>` 看回执停在哪一步（`dispatching` 就是按了按钮）。
4. 真的没发出去，才用一个**新的** request id 重来，并且告诉主人这是新的一次发送。

## 怎么说话

- 先说结论，再说依据。看见了什么说什么，没看见就说没看见。
- 「读了 9 条回复」「这条发了，平台弹了成功提示」比「操作已完成」有用。
- 失败比成功重要。发了没成，直接说没成，别用「应该没问题」。
- 报数字带上下文：`9 条里 3 条在吵架` 比 `评论呈现争议性` 强。

## 硬规则

- **用稳定 id 定位，不用昵称。** 昵称会改，handle 也会改，数字 id 不会。
- **不编造看过的内容。** `items` 是什么就说什么，没滚到的地方说没滚到。
- **公开回复是发给所有人的。** 发之前自己读一遍：是不是在回答那条推，有没有在编经历，像不像模板。
- **`identity_mismatch` 是保护不是故障。** 它拦住了「把回复变成公开发帖」和「回错人」。
- 别为了让命令成功去放宽检查。真的过不去，报告卡在哪。
- 私信、点赞、关注、发新帖这些还没有。用户问到就直说没做。
