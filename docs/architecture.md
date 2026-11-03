# Architecture

## What it is

A CLI that drives a dedicated Chrome tab through the Chrome DevTools Protocol and
answers in one JSON envelope per command. It holds no model and no schedule.

```
src/
  cli.ts              executable entry; EPIPE handling and signals
  main.ts             commander wiring: catalog -> parsed input -> App.execute
  app.ts              dispatcher: local commands, dry-run plan, lease, session
  catalog.ts          every command's metadata, flags and help guidance
  browser.ts          dedicated Chrome lifecycle and the CDP Session
  store.ts            state directory: config, browser.json, receipts, history
  lease.ts            one command per state directory at a time
  errors.ts           typed CliError, exit codes, error envelope
  progress.ts         progress lines on stderr during a write
  operations/
    validate.ts       input shapes and target parsing
    navigation.ts     opening a status and waiting for it to settle
    comments.ts       reading a conversation (bounded DOM window)
    write.ts          the reply send path, receipt contract, confirmation
    auth.ts           sign-in state and the login window
  page/               the page adapter: bundled to dist/page-adapter.js
    index.ts          operation dispatcher injected into the tab
    page.ts           page kind, sign-in state, account, status from URL
    tweets.ts         reading <article data-testid="tweet"> records
    composer.ts       the reply composer, its guard, and write-result evidence
    dom.ts            measurement helpers: rendered(), point(), one()
```

## The two halves

**Node side (`src/`, not `src/page/`).** Owns the browser, the state directory,
the receipt, retries and the envelope. It may use a Playwright locator to wait
for or click a control — that is driving the browser.

**Page adapter (`src/page/`).** Bundled by esbuild into `dist/page-adapter.js` and
injected as one string. It is the only code that reads the DOM, and it returns
`{data}` or `{error:{code,message,hint}}`. Nothing in it decides policy.

The split exists because the DOM is the volatile half. When X changes its markup,
only `src/page/` changes; the receipt, idempotency and envelope do not.

## Data flow of a reply

```
catalog.comment.post
  -> App.execute          validate, resolve status id, dry-run short circuit
  -> lease                one command at a time per state directory
  -> openStatus           navigate, verify URL identity, wait for tweets
  -> tweet.list           find target and its author handle
  -> reply.composer       refuse an existing draft
  -> reply.control        measure and mark the reply button
  -> click                reply modal opens
  -> reply.composer       verify the modal says "Replying to @handle"
  -> reply.prepare        mark the editor, refuse a non-empty composer
  -> insertText
  -> reply.arm-write      re-check the text and target, arm post with a guard
  -> receipt: dispatching
  -> click post           the guard can still refuse at press time
  -> reply.result         toast or new row = evidence; repeated twice
  -> receipt: confirmed | delivery_uncertain
```

## State directory

`~/.x-cli` by default, `X_CLI_STATE_DIR` or `--state-dir` to override.

| File | Holds |
| --- | --- |
| `browser.json` | the dedicated Chrome's port, websocket and owned tab id |
| `chrome/` | the Chrome profile: cookies, local storage, caches |
| `config.json` | Chrome path, headless default, proxy |
| `receipts.json` | every write, by request id |
| `history.jsonl` | every confirmed operation, append-only |

Receipts and history are the audit trail and are never rewritten except to
advance a receipt's own status.

## Testing layers

- **Pure tests** (`test/*.test.ts`) — parsing, id derivation, the receipt state
  machine. No browser.
- **Browser tests** (`test/browser.test.ts`, `pnpm test:browser`) — a temporary
  Chrome profile, an intercepted fixture page with X-shaped markup, real clicks
  and guards. No credentials, no network.
- **Real page** — the only proof that the selectors still match X. Run by hand
  against a signed-in profile; results are reported separately, never implied by
  a green test run.

## Glossary

| Term | Meaning |
| --- | --- |
| status | One tweet. Its numeric id is the identity. |
| conversation | The status plus the replies the page has rendered under it. |
| reply target | The tweet whose reply control was pressed; a reply to a reply reaches that reply's author. |
| receipt | Durable record written before a write can dispatch. |
| `delivery_uncertain` | A press happened but the page produced no evidence of delivery. Never retried automatically. |
| guard | A capture-phase listener that re-checks identity at press time and can cancel the event. |
| loaded window | The tweets currently in the DOM. Never the whole thread. |
