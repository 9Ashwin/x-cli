# 账号动作：发帖、关注、点赞、删帖、通知、收藏

这些不是回复，但同样改账号状态。共同点是**设成目标状态，不是切换**：`--value false` 是取消，重放已确认的回执返回的是答案。

## 发新帖

```bash
x-cli post create --text "…" --request-id post-01
```

和回复共用同一个编辑器，校验方向相反：回复**必须**有引用推文，新帖**必须**没有。这个对称性是两者不混淆的唯一保证。

发之前 `--dry-run` 看一眼。编辑器里已有草稿时返回 `draft_conflict`，**草稿会被保留**，不会覆盖。

## 关注 / 取消关注

```bash
x-cli user follow --handle someone               # 关注
x-cli user follow --handle someone --value false # 取消关注
```

按钮按 `aria-label` 里的 handle 匹配，所以侧栏推荐的其他账号不会被误点。对方的账号受保护时返回 `pending`（请求已发，等对方同意），**不是失败**。

**X 禁止批量、无差别关注。** 没有批量命令，也别手写循环。

## 点赞、收藏、转发

```bash
x-cli post like     --status <id> --value true
x-cli post bookmark --status <id> --value true
x-cli post repost   --status <id> --value true
```

`--value false` 是取消。状态从页面的 test id 读（`unlike` / `removeBookmark` / `unretweet` 表示已经做过），**不看数字**——数字是全网总数，会自己动。

同一个 request id 重放不会把状态翻回去；按了但页面没变是 `delivery_uncertain`，不会按第二次。

**X 的自动化规则禁止自动点赞。** 这些命令是「你本人点一下」的等价物，不是让你批量刷。真实用户明确这么说的时候才用，别自己找帖子点。

## 删帖

```bash
x-cli comment delete --status <id> --confirm
x-cli comment delete-many --ids "111,222,333" --confirm
```

**不可撤销。** 不带 `--confirm` 直接拒绝并报出数量。

这是唯一一条「按错了就回不去」的命令，所以它证明的比别的多：帖子必须是 URL 指的那条、作者必须是本账号、菜单里必须恰好一项删除项、打开菜单到按下之间再查一次所有权。结果带 `verification.gone_from_page`，删完回读页面确认消失。

批量时单条失败不中断，`skipped` 记原因，`stopped` 说明为什么整体停下。

## 通知

```bash
x-cli notice read --limit 30
x-cli notice read --tab mentions
```

`kind` 有七种：`like` / `reply` / `follow` / `repost` / `mention` / `recommended` / `other`。

**`recommended` 不是互动。** X 会在没有真实互动时用推荐帖子填满这个 tab。看到一片 `recommended` 说明「这个账号最近没人理」，不是「有人在互动」。别把它当成有人找过你。

`other` 是那行的措辞没匹配上（可能是别的语言），不是你漏了什么。

**行上没有帖子 id。** 要知道是哪条帖只能点开，工具不做——代价是每行驱动一次页面。

## 收藏和喜欢

```bash
x-cli saved bookmarks --limit 30 --scrolls 2
x-cli saved likes --limit 30
```

每条带 `liked` / `bookmarked` 当前状态，所以列表里可能有一条你已经取消过的。用 `id` 可以：

- 取消：`post bookmark --value false`
- 现在有话说：`comment post --status <id>`

**收藏了不等于读过。** 这个命令的意义是「三周前存的东西，现在回头看看有没有能用的」。

## 没有的

- **私信** —— X 的私信要 4 位 passcode 才能解密，那个密码只有账号主人知道，工具代填不了
- Lists、Space、书签分组
- 从通知跳到具体帖子
