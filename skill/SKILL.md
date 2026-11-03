---
name: x
description: Operate X (Twitter) through the local x-cli — read your timeline, the trending board, a keyword search, or one conversation; like, bookmark and repost; and write a reply that lands. Use this whenever the task involves X or Twitter at all: reading what people are saying under a post, finding posts worth answering, replying to a tweet or to a reply, checking whether a reply actually went out, or signing in for the first time. Also use it when the user says 看看这条推的评论, 找点热帖, 回复这条推, 发个回复, 查一下发出去没有, 我的收藏在哪, or names X or Twitter in any language without mentioning a CLI.
allowed-tools: Bash(x-cli:*) Bash(node dist/cli.js:*)
---

# X 上的读与回

`x-cli` 负责操作页面、留下证据、管住写入。**判断不归它**：读什么、回谁、说什么，都是你的。这个分工是故意的 —— 如果工具替你挑帖、替你写正文，事后没人能问它「为什么选这条」。

先把工具装好：

```bash
x-cli --version || (cd <repo> && pnpm install --ignore-scripts && pnpm build)
```

`x-cli schema` 是命令和参数的唯一来源。这里没写的，以它和实际返回为准。

**注意 schema 里的 id 和实际输入不一样**：`schema` 报 `comment.post`，真正敲的是 `x-cli comment post`。点号是文档里的写法，空格是命令行的写法。`x-cli comment.post` 会报 unknown command。

## 开工前

```bash
x-cli auth status
```

| 返回 | 怎么办 |
| --- | --- |
| `signed_in: true` | 直接用，`account.handle` 是当前账号 |
| `login_required: true` | 跑 `x-cli auth login`，让主人在窗口里登录 |
| `verification_required: true` | 要人验证，跑不了。让主人处理完再查 |

**Google 登录会被拒**，页面写「此浏览器或应用可能不安全」。那是调试端口被识破，不是账号问题。用 `x-cli auth login --manual`：它关掉自动化浏览器，用同一个 profile 开一个**不带调试端口**的窗口，等主人关窗口后把登录态读回来。

## 最省事的一步：`auto suggest`

如果主人说「找几条值得回的」「自动去热帖评论」，先跑这个，不要从 `feed read` 一条条翻。

```bash
x-cli auto suggest --goal reply --limit 20
x-cli auto suggest --source search --query "AI agent" --goal reply
x-cli auto suggest --source trend --goal reach
```

它一次做完三件事：从时间线 / 热榜词 / 关键词收集候选 → 按「每条回复还能分到多少注意力」预排 → **打开前 8 条各自的会话，把区量出来**。

每条候选给你：

| 字段 | 是什么 | 怎么用 |
| --- | --- | --- |
| `engagement` | likes/replies/reposts/bookmarks/views | 判断体量 |
| `section` | 这个区的长度中位数、多少条有空话、拿到赞的回复长什么样 | 决定写多长、写多具体 |
| `signals.attention_per_reply` | 浏览数 ÷ 回复数 | 越高说明回复越有人看 |
| `signals.section_substance` | 区里有立场的回复占比 | 越低说明越有空位 |
| `why` | 它为什么排在这 | 别猜排序逻辑，看这个 |
| `angles` | 帖子里已有的可切入点 | **线索，不是草稿** |

`--goal`：

- `reach`（默认）— 按浏览量。要曝光就这个。
- `reply` — 按每条回复分到的注意力。**大多数时候这个是你要的**：5 万浏览 3 条回复，比 50 万浏览 5000 条回复更值得回。
- `conversation` — 偏爱还没被具体发言填满的区。

**`angles` 不是回复草稿。** 它是「这条帖子里有什么可说的」，你要自己读原帖、形成立场再写。把 `angles` 原样贴出去就是最典型的空话。

`auto suggest` 不写正文、不发送。发送还是 `comment post`。

## 三条找内容的路径，别混用

它们回答的是三个不同的问题，混在一起会答错。

```bash
x-cli feed read --limit 20 --scrolls 2              # 1. 我的推荐流里现在有什么
x-cli trend read --limit 20                          # 2. 全网在聊什么（不用我先想到词）
x-cli trend posts --index 0 --tab news --limit 10    # 2b. 这个话题下现在最热的帖
x-cli search keyword --query "AI agent" --limit 20   # 3. 我知道要找什么
x-cli search hot --query "AI agent" --language zh --min-likes 500   # 3b. 这个词下最热的帖
```

| 想知道 | 用 | 返回什么 |
| --- | --- | --- |
| 我关注的人/算法推给我什么 | `feed read` | 帖子 |
| 现在什么话题在涨 | `trend read` | **话题**，不是帖子 |
| 这个话题下哪几条帖子在被读 | `trend posts --index <row_index>` | 帖子 + 完整互动数 |
| 关键词下有什么 | `search keyword` | 帖子，最新优先 |
| 关键词下哪几条被讨论得最多 | `search hot` | 帖子 + 完整互动数，按 X 的 Top 排 |

`trend read` 返回的是话题（如 `Sports · Trending | Draymond`），不是帖子，也没有 id —— X 用点击事件打开话题页，id 只有打开后才存在。所以每条带一个 `row_index`：`trend posts --index <row_index> --tab <同一个 tab>` 会重开那个 tab、点开这一行、跟着跳到帖子页。`--tab` 必须和 `trend read` 时一致，否则点到的是另一条。

四个 tab 不是一回事：`trending` 是排好序的关键词，`news` / `sports` / `entertainment` 是一行一行的新闻，带时间和帖子数。**两个方向都能用**：先按话题找帖，或者直接看新闻下的帖。

`search hot` 会拼 X 自己的运算符（`lang:` `min_faves:` `min_replies:` `since:`），排序是 X 的 Top 标签给的，不是我重排的。

所有读取都返回同一种条目：`id`、`handle`、`name`、`text`、`at`、`likes`、`replies`、`retweets`、`promoted`、`liked`、`bookmarked`。`items[].id` 直接能当 `comment post --status` 用。

读到的永远是窗口：`scope: "loaded_dom"`、`complete: false`。`--scrolls` 多加载几屏。**`items` 为空只说明没加载到，不说明没有。**

## 挑一条之前先看它是不是值得回

`search hot` 给的互动数就是用来做这个判断的：

- **likes 高但 replies 少** → 没人接得住，你的回复容易是第一条，容易被看到，但也容易被作者判定为灌水。
- **replies 已经很多** → 你的回复会沉底。除非你能说出别人没说的。
- **bookmarks 远高于 likes** → 大家觉得有用但没什么情绪，写「有共鸣」会空。

这些都不是规则，是参照。真正的判断还是读完再说。

## 读一个区，再写

```bash
x-cli comment section --status <id> --scrolls 3
```

它量这个评论区：回复长度中位数、多少人提问、拿到赞的回复长什么样、多少条是空泛吹捧。

拿到之后你会知道「这里的正常回复长什么样」。**这不是让你写得像，是让你知道写多长、写多具体才不算突兀。**

写完先自己过一遍：

```bash
x-cli comment check --status <id> --draft "…"
```

| `verdict` | 意思 | 该做什么 |
| --- | --- | --- |
| `has-a-point` | 有具体指认、有第一人称立场、或有个转折 | 可以发 |
| `flat` | 没具体的东西，也没立场 | 补一句只有读过这条才说得出的 |
| `generic-praise` | 大部分是「太牛了」「学到了」「很有价值」这类放到哪条都成立的话 | 重写。这种话对作者和读者都是噪音 |

`check` 是报告不是闸门，它不会拦你。**过了它也不等于写得好** —— 它只测「像不像空话」，测不了观点对不对、有没有编造。那些你自己核。

## 发

```bash
# 回整条推
x-cli comment post --status <id> --text "…" --request-id reply-<id>-01

# 回某一条回复
x-cli comment reply --status <id> --comment-id <reply-id> --text "…" --request-id reply-<id>-02
```

**`--request-id` 必须给，每次新的发送用新的 id。** 先 `--dry-run` 检查参数（不开浏览器）：

```bash
x-cli comment post --status 123 --text "…" --request-id t-1 --dry-run
```

### 结果怎么读

| 返回 | 意思 |
| --- | --- |
| `confirmed: true` + `result.evidence` | 发出去了。`toast` 是平台的成功提示；`new_row` 是新行；`modal_closed` 最弱 |
| `replayed: true` | 这个 request id 之前就成功了，没有重发 |
| `delivery_uncertain` | **按了按钮但页面没给证据。可能已经发出去。** |
| `idempotency_conflict` | 同一个 request id 配了不同文字 |
| `identity_mismatch` | 弹窗不是回复模式，或回的账号不对。**什么都没打进去** |
| `draft_conflict` | 输入框里有别人留下的草稿，被保留了 |
| `needs_confirmation: true` | 半小时内发得有点多，停下来问。看过之后加 `--confirm` 继续 |

### `delivery_uncertain` 绝不自动重发

它可能已经出现在时间线上，再发就是两条。

1. 先确认页面没有登录/验证遮罩（有遮罩时读到的是旧页面）。
2. `x-cli comment list --status <id>` 看你的文字在不在。窗口是加载出来的，**没看到不等于没发出去**。
3. `x-cli receipt get <request-id>` 看回执停在哪。
4. 真的没发出去，才用**新的** request id 重来，并告诉主人这是新的一次。

**两个容易误读的地方（都有人踩过）：**

- `history list` 只记**确认成功**的发送。一条 `delivery_uncertain` 的回复**不会**出现在里面。所以「历史里没有」不能当作没发出去的证据。
- 回执停在 `dispatching` 有两种可能：还在确认中，或者就是那次 uncertain。光看状态分不出来，要看 `uncertainty_reason` 和 `updated_at`。
- 回执里的 `tweet_id` 可能指向一个已被删除的帖子，打开会 404。这不代表回执错了，只代表目标没了。

找不到是哪一条时，直接问主人要链接、id 或那次用的 request id。**不要从回执里挑一条时间最近的当成他说的那条。**

## 发新帖

```bash
x-cli post create --text "…" --request-id post-01
```

和回复共用同一个编辑器，但校验方向相反：回复**必须**有引用推文，新帖**必须**没有。发出去之前 `--dry-run` 看一眼。

## 关注

```bash
x-cli user follow --handle someone              # 关注
x-cli user follow --handle someone --value false # 取消关注
```

按钮按 `aria-label` 里的 handle 匹配，所以侧栏推荐的账号不会被误点。对方的账号受保护时返回 `pending`（请求已发，等对方同意），不是失败。

**X 禁止批量、无差别关注。** 没有批量命令，也别手写循环。

## 看通知

```bash
x-cli notice read --limit 30
x-cli notice read --tab mentions
```

`kind` 有七种：`like` / `reply` / `follow` / `repost` / `mention` / `recommended` / `other`。

**`recommended` 不是互动** —— X 会在没有真实互动时用推荐帖子填满这个 tab。看到一片 `recommended` 说明「这个账号最近没人理」，不是「有人在互动」。别把它当成有人找过你。

`other` 是这行的措辞没匹配上（可能是别的语言），不是你漏了什么。

## 点赞、收藏、转发

```bash
x-cli post like     --status <id> --value true
x-cli post bookmark --status <id> --value true
x-cli post repost   --status <id> --value true
```

`--value false` 是取消。状态从页面的 test id 读（`unlike` / `removeBookmark` / `unretweet` 表示已经做过），不看数字 —— 数字是全网总数，会自己动。

同一个 request id 重放不会把状态翻回去；按了但页面没变是 `delivery_uncertain`，不会按第二次。

**注意**：X 的自动化规则禁止**自动**点赞。这些命令是「你本人点一下」的等价物，不是让你批量刷。真实用户明确这么说的时候才用，别自己找帖子点。

## 回看自己存过的东西

```bash
x-cli saved bookmarks --limit 30 --scrolls 2
x-cli saved likes --limit 30
```

每条带 `liked` / `bookmarked` 的当前状态，所以列表里可能有一条你已经取消过的。用 `id` 可以：

- 取消：`post bookmark --value false`
- 现在有话说：`comment post --status <id>`

收藏了不等于读过。这个命令的意义是「三周前存的东西，现在回头看看有没有能用的」。

## 这轮怎么说话

一条一条来。读完一条、想清楚、再写下一条。

先确认这条在说什么（读正文，必要时读它下面的回复），再决定回不回、回什么。**没有值得说的话就不发**，这是常态不是失职，说出来比硬写一条强。

不要为了「多发几条」压缩思考时间。工具不提供随机间隔或拟人节奏的参数 —— 那是在让平台看不出你在做什么，不是在帮你写得更好。

## 硬规则

- **用稳定 id 定位，不用昵称。** 昵称和 handle 都会改，数字 id 不会。
- **不编造读过的内容。** `items` 是什么就说什么，没滚到的地方说没滚到。没读过的帖子不要说「我看过」。
- **公开回复是发给所有人的。** 发之前读一遍：是不是在回答这条，有没有在编经历，像不像模板。
- **`identity_mismatch` 是保护不是故障。** 它拦住「把回复变成公开发帖」和「回错人」。
- **不批量操作陌生人。** X 明确禁止搜到人就自动回复、自动点赞、自动关注。工具没有这类命令，也不该手写循环绕过。
- **自动化身份要声明。** 用这个账号做自动化时，账号简介里应说明这一点和运营者。这不是建议，是 X 开发者指南的要求。
- 别为了让命令成功去放宽检查。真的过不去，报告卡在哪。

还没做的：**私信** —— X 的私信现在要 4 位 passcode 才能解密，那个密码只有账号主人知道，工具代填不了。要用私信，主人得先在自己的浏览器里输一次。

其他没有的：Lists、Space、书签分组。
