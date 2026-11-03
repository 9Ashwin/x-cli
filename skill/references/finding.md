# 找一条值得回的推

工具能替你排序，不能替你判断。这份文件讲的是**怎么用返回的数字做判断**，以及三条发现路径各自回答什么问题。

## 三条路径，别混用

```bash
x-cli feed read --limit 20 --scrolls 2              # 1. 我的推荐流里现在有什么
x-cli trend read --limit 20                          # 2. 全网在聊什么（不用先想到词）
x-cli trend posts --index 0 --tab news --limit 10    # 2b. 这个话题下的帖子
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

**混用的后果是答错问题。** 拿 `search keyword` 的结果说「现在最火的是什么」，那只是最近有人发了这个词。拿 `trend read` 的条目当帖子引用，那是把话题名当成了内容。

## `auto suggest` 什么时候用

```bash
x-cli auto suggest --goal reply --limit 20
x-cli auto suggest --source search --query "AI agent" --goal reply
x-cli auto suggest --source trend --goal reach
```

它已经把三条路径跑完并排了序，还打开前 8 条各自量了区。**主人说「找几条值得回的」时，先跑这个**，不要自己从 `feed read` 一条条翻。

但 `auto suggest` 不是万能的：

- 它最多测 8 条（每条要一次导航）。想看得更多就按来源单独跑。
- `--source timeline` 的卡片**没有浏览数**，只有 likes/replies。`signals.attention_basis` 会告诉你这一轮用的哪个单位——`likes` 和 `views` 不是一个量级，跨来源比较时要看这个。
- 排序是它的判断，`why` 是它的理由，`signals` 是它的数。**不同意就看数**，别只看顺序。

### `--goal` 怎么选

| goal | 排序依据 | 什么时候用 |
| --- | --- | --- |
| `reply`（默认） | 浏览数 ÷ 回复数 | 大多数时候。每条回复还能分到多少读者，这是回复真正面对的问题 |
| `reach` | 原始 reach | 就是要曝光，不在乎回复被埋 |
| `conversation` | reach × 区的空位 | 想加入一段还在形成的讨论 |

### `angles` 是线索不是草稿

`angles` 指向帖子里**已经有的东西**：它问了问题、区里全是空话、赞回比失衡、没人提问。它是让你决定读不读、往哪个方向读的提示。

**原样贴出去就是最典型的空话**，而且是 `comment check` 专门在抓的那种。你要读原帖、形成自己的立场，再写。`angles` 只说「这里有个口子」，说什么、怎么说，是你的判断。

### 定时跑

`auto suggest` 记着每条帖子什么时候被推过。`--seen-within <天数>`（默认 7）内的帖子仍然出现，但排在新帖后面，标 `seen.seen_recently: true`，`seen_skipped` 报降级了几条。

这是为了定时任务不会每次都推同一条。想看全部按新鲜度排就 `--seen-within 0`。

## 互动数怎么读

| 形状 | 意思 | 该怎么处理 |
| --- | --- | --- |
| likes 高、replies 少 | 没人接得住；你的回复容易是第一条 | 容易被看到，也容易被作者当灌水 |
| replies 已经很多 | 你的回复会沉底 | 除非能说出别人没说的 |
| bookmarks 远高于 likes | 大家觉得有用但没什么情绪 | 写「有共鸣」会空 |
| views 高、replies 极低 | 关注度高但没人开口 | 最好的位置，前提是你说得出东西 |

**这些都不是规则，是参照。** 真正的判断还是读完再说。

## 读到的永远是窗口

所有读取都返回 `scope: "loaded_dom"`、`complete: false`。`--scrolls` 多加载几屏。

**`items` 为空只说明没加载到，不说明没有。**

## 条目形状

都返回同一种：`id`、`handle`、`name`、`text`、`at`、`likes`、`replies`、`retweets`、`promoted`、`liked`、`bookmarked`。`items[].id` 直接能当 `comment post --status` 用。

推广帖被排除，数量写在 `limits` 里。

## `trend read` 的两个坑

**行上没有 id。** X 用点击事件打开话题页，`<a>` 不存在，所以 id 只有打开后才有。每条带一个 `row_index`（它在页面上的位置）。

```bash
x-cli trend read --tab news          # → row_index 0, 1, 2…
x-cli trend posts --index 1 --tab news --limit 10
```

`--tab` 必须和 `trend read` 时一致，否则点到的是另一条。

**四个 tab 不是一回事。** `trending` 是排好序的关键词，落在 `/search?q=…`；`news` / `sports` / `entertainment` 是一行一行的新闻，落在 `/i/trending/<id>`。两边都能读到帖子，返回值的 `url` 说明这次落在哪。

## `search hot` 的运算符

拼的是 X 自己的语法：`lang:` `min_faves:` `min_replies:` `since:` `-filter:retweets`。排序是 X 的 Top 标签给的，不是我重排的。

**`--min-likes` 会清空 Top 标签**，不是收窄。X 在排序之前就先过滤，阈值稍高一点就什么都没有。宁可 `--limit` 大一点、本地再挑。
