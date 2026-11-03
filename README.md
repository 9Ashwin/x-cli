# x-cli

Operate X from the command line. Read a conversation, post a reply, and keep a
receipt of every write. Built for agents: one JSON envelope per command, stable
ids, and a refusal instead of a guess whenever the page disagrees.

## What it does today

**Finding something to answer**

| Command | What it does |
| --- | --- |
| `x-cli auto suggest` | Ranks posts worth replying to, with each one's section already measured |
| `x-cli feed read` | Your home timeline, as the page renders it |
| `x-cli trend read` | X's Explore board: Trending, News, Sports, Entertainment |
| `x-cli trend posts` | The posts under one board entry |
| `x-cli search keyword` | A keyword, newest first |
| `x-cli search hot` | A keyword on X's Top tab, with full engagement counts |
| `x-cli saved bookmarks` / `saved likes` | What this account already kept |

**Reading a conversation**

| Command | What it does |
| --- | --- |
| `x-cli comment list` | The replies the page has rendered under a status |
| `x-cli comment get` | One reply plus the status it answers |
| `x-cli post get` | One status, without its replies |
| `x-cli comment section` | What this section's replies are like, what drew a reaction, and what they are about |
| `x-cli comment check` | Measure a draft against the section, and against what you already wrote |

**Writing**

| Command | What it does |
| --- | --- |
| `x-cli comment post` | Reply to a status |
| `x-cli comment reply` | Reply to one reply in a conversation |
| `x-cli post create` | Publish a new post |
| `x-cli comment delete` / `delete-many` | Remove your own replies, with ownership proved from the author |
| `x-cli post like` / `bookmark` / `repost` | Set a post's state for this account |
| `x-cli user follow` | Follow or unfollow an account |

**Pieces around the edges**

| Command | What it does |
| --- | --- |
| `x-cli auth login` | Opens X's sign-in in the dedicated Chrome profile |
| `x-cli auth login --manual` | Same, with the debugging port off — required for Google sign-in |
| `x-cli auth status` | Whether the tab is signed in, and as whom |
| `x-cli status` | Page kind, URL, account and the open status |
| `x-cli notice read` | Who liked, replied to, mentioned or followed you |
| `x-cli receipt get` | The durable record of one write |
| `x-cli history list` | Every confirmed operation, locally |
| `x-cli browser start/stop/status/configure` | The dedicated Chrome |
| `x-cli clean` | Remove the profile's caches, keep the sign-in |

## Install

```bash
pnpm install --ignore-scripts
pnpm build
node dist/cli.js --help
```

Requires Node 22.19+ and Google Chrome. `x-cli` talks to Chrome over the DevTools
protocol; it does not bundle a browser.

## First run

```bash
x-cli browser start --headless false
x-cli auth login
```

Sign in by hand in the window that opens. The tool never types credentials. The
profile lives in `~/.x-cli/chrome`, so the session survives restarts.

### Google sign-in is refused in an automation browser

Google answers *"This browser or app may not be secure"* for a browser started
with a debugging port, which is exactly how the tool starts Chrome. Use:

```bash
x-cli auth login --manual
```

That closes the automation browser, opens the same profile **without** the
debugging port, waits until you close it, and then reads the session back. Every
later command uses the CDP browser on the same profile.

### Behind a proxy

X is unreachable on some networks without one. Set it once:

```bash
x-cli browser configure --proxy http://127.0.0.1:7890
```

## Reading a conversation

```bash
x-cli comment list --status https://x.com/handle/status/1234567890 --limit 30 --scrolls 3
```

```json
{
  "status_id": "1234567890",
  "root": { "id": "1234567890", "handle": "handle", "text": "…", "root": true },
  "items": [
    { "id": "…", "handle": "…", "text": "…", "reply_to": { "handle": "…", "id": null }, "depth": 0 }
  ],
  "scope": "loaded_dom",
  "complete": false
}
```

`scope` and `complete` are always `loaded_dom` and `false`. X loads replies as the
conversation scrolls, so `items` is a window, not the thread. An empty list means
nothing loaded, not that nobody replied.

## Reading a timeline or a search

```bash
x-cli feed read --limit 20 --scrolls 2
x-cli search keyword --query "AI agent" --limit 20
x-cli post get --status 1234567890
```

All three return the same shape, so `items[].id` goes straight into
`comment post --status`. Promoted posts are excluded and counted in `limits`.

## Posting a reply

```bash
x-cli comment post --status 1234567890 --text "…" --request-id reply-1234567890-01
x-cli comment reply --status 1234567890 --comment-id 0987654321 --text "…" --request-id reply-2
```

A send:

- saves a receipt **before** the post button can be pressed;
- proves the reply target from the composer's own quoted tweet, because X's reply
  dialog and its new-post dialog are the same component — without the quote the
  press would publish to everyone;
- re-checks the text and the target at press time, inside the page;
- reports `confirmed` only from a success toast, a new row, or the dialog closing;
- otherwise fails with `delivery_uncertain` and **is never resent automatically**.

Reusing a request id replays the receipt. Reusing it with different text is an
`idempotency_conflict`.

### A run of replies stops and asks

The tool counts its own confirmed sends in the last 30 minutes. At eight, a send
returns `needs_confirmation` with the count and sends nothing:

```json
{ "sent": false, "needs_confirmation": true,
  "pace": { "recent": 8, "window_minutes": 30, "threshold": 8, "over": true },
  "next": "If this is intended, run the same command with --confirm. Nothing has been sent." }
```

It does not block: `--confirm` carries on. The count comes from this machine's
own log, so it is not X's limit and does not claim to be — it is a pause at the
point where a run of replies starts to look like one.

## Safety rules

- A `delivery_uncertain` write may be out. Check the page and the receipt; a
  second request id is a second reply.
- Identity is the numeric status id. Handles are renameable and display names are
  decoration.
- The tool never types a password, and never stores cookies outside the Chrome
  profile.
- `--dry-run` validates and plans without starting Chrome.

## Development

```bash
pnpm check          # biome + tsc
pnpm test           # pure tests
pnpm build          # bundle the page adapter, compile src/
pnpm test:browser   # isolated Chrome, fixture page, no credentials
```

Read [AGENTS.md](AGENTS.md) first, then
[docs/architecture.md](docs/architecture.md),
[docs/typescript.md](docs/typescript.md) and
[docs/contracts.md](docs/contracts.md).

## Agent skill

`skill/SKILL.md` teaches an agent to use the CLI. Copy it into your agent's skill
directory, or point the agent at this file.

## Limits, stated plainly

- X changes its markup. Every read is bounded to what the page rendered, and a
  changed control is reported as `selector_changed` rather than retried blindly.
- No direct messages: X gates them behind a four-digit passcode screen this tool does not attempt. No Lists.
- Tested against a signed-in account on x.com with English and Chinese UI. Other
  locales and account tiers may need selector work.

## Reading and replying are separate

`auto suggest`, `feed read` and `search keyword` return candidates. `comment post` sends one
reply, to one id you name. There is no command that joins the two.

That gap is the point. Choosing which post to answer and writing what to say are
judgement calls, and judgement in a CLI is judgement nobody can ask about. If the
tool picked the target, "why this post" would have no answer; if it wrote the
text, "what does it mean" would have none either.

Two measurements aim at the same failure from different sides. `comment section`
labels every reply `about_work`, `about_self`, `asking` or `spam`, because
quoting "agreed" under a reply that is actually about the writer's own situation
reads as nobody having read the section. `comment check` compares a draft with
the confirmed replies in this machine's own log and reports `sameness` —
`varied`, `narrowing` or `template` — because a draft can pass every per-draft
check and still be the fifth time the same opening was used. `template` is not a
prompt to change a synonym; it is a prompt to change the angle.

`auto suggest` narrows the first half without closing it: it ranks candidates and
reports the numbers it used (`signals`), the reason each is where it is (`why`),
and what is already in the post (`angles`). It does not write a reply and does
not send one. `angles` are pointers at the post, not drafts, and pasting one in
is the generic praise `comment check` is built to catch.

So the tool provides no generated comment text and no randomised or
"human-like" spacing between sends. Spacing is something a calling script can do
if it wants; making it look human is not a feature this repository builds.

Reading commands and sending commands are separate here for the same reason. A
tool that did both in one step would be choosing on the caller's behalf, and the
caller would have no way to see that it had.
