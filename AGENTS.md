# AGENTS.md

Working rules for this repository. Detailed reference lives in the linked
documents — read the one your task needs rather than carrying all of it here.

## Read as needed

- [Architecture](docs/architecture.md) — layers, source layout, the page adapter,
  the state directory, testing layers, glossary. Read when changing module
  boundaries or when a term is unclear.
- [TypeScript conventions](docs/typescript.md) — types, lint rules, naming,
  comments and the anti-patterns drawn from what has gone wrong here. Read before
  writing code in an area you have not touched.
- [Contracts](docs/contracts.md) — the public surface: command ids, error codes,
  response fields, exit codes, the receipt contract.

## Working language

Repository guidance, issue and PR templates, and commit messages are in English.
Conversation follows the user's language. Keep quoted code, error output and
upstream material in their original language.

Reader-facing documentation has two versions: `README.md` is Simplified Chinese
and is the main page, `README.en.md` is its English counterpart. A change to one
is a change to the other — a pair that has drifted is worse than one language,
because the reader cannot tell which is current. The agent skill
(`skills/xx/SKILL.md` and `skills/xx/references/`) is written in Chinese, matching the
language its reader is spoken to in.

Use Conventional Commits for commit messages and PR titles.

## What this project is

The project is **x-cli**; its command is **`xx`**. It is a local CLI that lets an
agent operate X (Twitter) from the command line: read a conversation, post a
reply, and leave a durable record of every write. It does not bundle a model, schedule anything, or decide content — the
calling agent does that.

Two commitments shape most of the code:

- **The tool never decides for the account.** Every write leaves a receipt before
  it can dispatch, a `delivery_uncertain` write is never retried automatically,
  and identity is always a stable id rather than a display name or a handle.
- **The page is the source of truth, not the fixture.** A test that passes while
  the live page fails is the expected state. Real-page evidence is what turns a
  claim into a fix.

X is a hostile surface for automation: it renames selectors, gates behaviour
behind its internal GraphQL and serves different markup per account tier. The
response to that is bounded claims — every read says it saw a window of the DOM,
not the whole world — never a wider selector that "usually works".

## Code and behavior

- Read affected files before changing them. Trace the operation owner before
  choosing a fix. Keep argument handlers thin.
- Metadata owns WHAT; help guidance owns command prerequisites and recovery.
  Keep help/schema descriptions in the catalog.
- Success goes to stdout as one `{ok:true,data}` envelope. Failures go to stderr
  as one `{ok:false,error}` envelope and a nonzero exit. Explicit help and
  version are the documented presentation exceptions.
- Error `type`, `code`, exit values, flags and response fields are public
  contracts. Preserve exact accepted message text. Never replace a requested
  action silently.
- Dry-run validates and resolves supplied text without starting Chrome, creating
  state, filling inputs or sending content.
- Save a receipt before a write can dispatch. Reusing a confirmed request ID
  returns the receipt. A pending/uncertain dispatch must never be automatically
  resent.
- Serialize operations per state directory. If ownership is lost, cancel the
  operation. Preserve corrupt state for diagnosis.
- Direct external dependencies use exact versions. Update the lockfile with
  `pnpm install --ignore-scripts`; use `pnpm install --frozen-lockfile
  --ignore-scripts` for clean installs. No implicit package lifecycle scripts.
- Edit TypeScript sources, then regenerate `dist/`. Do not hand-edit build output.

## Checks

After code changes run `pnpm check` and the relevant `node --test
test/<file>.test.ts`. Before delivery run `pnpm test` and `pnpm build`.

Browser changes also require `pnpm test:browser` after building. Those tests use
a temporary Chrome profile, an intercepted fixture page and no account
credentials. Test success is not proof of logged-in X behavior. Report
real-platform validation separately.

Stage explicit paths and inspect the resulting diff before committing. Do not
commit cookies, Chrome profiles, receipts, or local state.

## Keeping secrets out

- Keep credentials, cookies, Chrome profiles and local state out of the
  repository. Never log cookie values or browser storage contents.
- The tool never types a password. Sign-in happens in the dedicated Chrome
  profile, by the owner.
- A token pasted into a conversation is not a file to write. Never commit one,
  and never put one in a test fixture.

## What the tool must never decide

`xx` acts on a real account. The code's job is to make every action auditable
and reversible by the person running it — not to decide whether the action is
appropriate.

- A write leaves a receipt before it can dispatch. A `delivery_uncertain` write
  is never retried automatically: it may already be out, and sending again makes
  two.
- Anything irreversible stays behind an explicit request. Never guess an
  identity, never substitute a display name for a stable id, and never widen a
  check to make a command succeed.
- A reply that is not provably in reply mode is not posted: the modal's own
  "Replying to" line is checked before typing, because a missed press would turn
  a private reply into a public post.

## What is out of scope on purpose

Reading and writing are separate commands, and nothing in this repository joins
them into a loop. Do not add, and do not accept a contribution that adds:

- a command that picks a target on its own and posts to it;
- generation of comment text inside the tool;
- randomised, jittered or "human-like" timing between sends.

The first two move judgement into code that cannot be asked why it chose a
target or a sentence. The third exists only to make automated posting harder for
the platform to recognise, and that is detection evasion — it is also what gets
accounts banned. A caller that wants to space out its own sends can do so in the
calling loop; the tool neither needs to know nor should provide it.

`timeline read` and `thread list` return candidates and stop there. If a future
feature seems to need a queue that sends itself, the feature is the problem.
