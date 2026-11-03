# X 页面上摸到的事实

这些是实测出来的，不是文档里写的。知道它们能省很多重试，也能避免把工具的读数当成平台的事实。

## 互动数在同一个 aria-label 里

```
174 replies, 541 reposts, 2741 likes, 3949 bookmarks, 234215 views
```

一条推的每个计数都在这一个 label 上。按按钮分别读会漏掉收藏数和浏览数——收藏按钮自己的 label 只有 "Bookmark"，没有数字。

**缺失就是 `null`，不是 0。** 卡片会先渲染出来、后印标签，所以读到 `null` 有时只是还没加载完。

## 时间线卡片没有浏览数

`feed read` 的卡片只有 likes / replies / retweets。views 和 bookmarks 只在搜索结果和话题页上印。

所以拿时间线做候选时，不能假装知道 reach。`auto suggest` 的 `signals.attention_basis` 会说明这一轮用的是 `views` 还是 `likes`——**它们不是一个量级**，900 likes 比 1,800 views 大。

## 回复弹窗和新帖弹窗是同一个组件

区别只有一个：**有没有引用推文**。

这是这个工具里最危险的一处。没有引用就是公开新帖——本来想回一个人，结果发给了所有人。所以 `comment post` 在打字前校验弹窗里有引用推文、handle 一致，按下前在页面内再校验一次。

`post create` 是同一个组件的反向：**必须没有**引用。这个对称性是两者不混淆的唯一保证。

## 控件在页面上有多个副本

同一个按钮（回复、赞、转发）在一条推的卡片上、在详情页上、在悬浮层里都有。用「第一个匹配」会点错。

所以定位靠的是**每次测量生成的唯一标记**，不是共享的选择器。如果你看到 `identity_mismatch`，那是在拒绝一个歧义的按压。

## 推广内容有三处

1. **时间线里的推广帖** —— 带 `promoted` 标记，读取时被排除，数量写在 `limits` 里
2. **会话里的推广回复** —— 和真实回复在同一个列表里，也是 `promoted`。一条广告能拿到几千赞，不排除会把 `section.led` 整个带偏
3. **Explore 榜里的推广行** —— `trend read` 排除；`trend posts` 点名到它也会拒绝

## Explore 的四个 tab

| tab | 一行是什么 | 点开去哪 |
| --- | --- | --- |
| Trending | 排好序的关键词 | `/search?q=…` |
| News | 标题 + 时间 + 帖子数 | `/i/trending/<id>` |
| Sports | 同上 | `/i/trending/<id>` |
| Entertainment | 同上 | `/i/trending/<id>` |

**没有一行是帖子。** 帖子只在点进去之后的页面里，那里才带完整互动数。

行上**没有 `<a>`、没有 id**——X 用点击事件导航。所以只能按位置 `row_index` 点名，位置是**未过滤**的 DOM 下标。

## 通知

- 两个 tab 是**链接**：`/notifications` 和 `/notifications/mentions`，不是本地筛选
- 每行是 `<article data-testid="notification">`，图标没有 label，类型只能从句子读
- 推荐帖和互动帖**是同一个形状**，只能从措辞区分
- 行带 actor 的 handle，**不带帖子 id**

## 私信要 passcode

X 的私信在四位数字密码屏后面（`/i/chat/pin/recovery`），渲染进一个空 iframe。那个密码只有账号主人知道，工具不输入凭据，所以不通。

## 会话是没有「按赞排序」的

拿不到按赞排序的回复。`comment section` 的 `led` 是**本地**按 likes 排的已加载回复，不是页面的顺序，也不是整个会话的排名。

## Google OAuth 拒绝带调试端口的浏览器

见 `setup.md` 的 `auth login --manual`。

## 一些数字的实测

- `--min-likes` 在 `search hot` 上是**先过滤再排序**，阈值稍高就把 Top 标签清空，不是收窄结果
- 一条 4.8K posts 的新闻话题，页面只渲染 7 条帖子
- `trend read` 返回一次可能 30 条，但 `row_index` 是页面位置，不是名次
