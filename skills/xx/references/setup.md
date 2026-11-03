# 安装与登录

## 装

```bash
xx --version
```

有版本号就直接用。没有的话：

```bash
cd <repo>
pnpm install --ignore-scripts
pnpm build
```

需要 Node 22.19+ 和 Google Chrome。`xx` 通过 DevTools 协议驱动 Chrome，不打包浏览器。

## 登录

```bash
xx auth status
```

| 返回 | 怎么办 |
| --- | --- |
| `signed_in: true` | 直接用，`account.handle` 是当前账号 |
| `login_required: true` | 跑 `xx auth login`，让主人在窗口里登录 |
| `verification_required: true` | 要人验证，跑不了。让主人处理完再查 |

登录态存在专用 profile（`~/.xx/chrome`），一次登录长期有效，不落在仓库里。**工具从不输入密码。**

## 登录只走一条路

```bash
xx auth login
```

它做四件事：关掉自动化浏览器 → 用同一个 profile 开一个**不带调试端口**的窗口 → 等主人关窗口（靠 profile 锁，不是靠进程退出）→ 重新起自动化浏览器并读回登录态。

**这是默认，因为它稳定。** 直接在自动化浏览器里登录经常失败：X 的 Google 登录会被 Google 拒掉，页面写「此浏览器或应用可能不安全」——那是调试端口被识破，不是账号问题。

只有账号不用 Google 登录时，才可以 `xx auth login --manual false` 走短路径。别把这个当默认。

## 代理

X 在某些网络下不通。设置一次：

```bash
xx browser configure --proxy http://127.0.0.1:7890
```

## 浏览器

```bash
xx browser start              # 起专用 Chrome
xx browser start --headless false
xx browser status
xx browser stop
xx clean                      # 清缓存，保留登录态
```

**headless 更容易被 X 要求验证。** 一个 headless 浏览器报 `login_required` 可能只是需要 `--headless false`。

## 状态目录

`~/.xx/` 里放 `browser.json`、`chrome/`、`config.json`、`receipts.json`、`history.jsonl`、`seen.json`、`operation.lock`。

`--state-dir <path>` 或 `XX_STATE_DIR` 可以换地方。**永远不要把状态目录放进仓库。**

## 卡住的时候

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| `busy` / `Workspace lock ownership was lost` | 另一个命令占着滚动锁 | 等一会儿重试 |
| 命令很久没动静 | 浏览器窗口被别的操作挡住，或页面在等人验证 | `xx status` 看页面是什么 |
| `selector_changed` | X 改了页面 | 报告卡在哪，不要自己反复重试 |
| 页面空白但报成功 | 可能是登录遮罩 | `xx auth status` 先确认 |

**别为了让命令成功去放宽检查。** 真的过不去，告诉主人卡在哪。
