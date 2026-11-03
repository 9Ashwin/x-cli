# TypeScript conventions

How this repository writes TypeScript. The compiler and Biome enforce several of
these already; the list below says which ones are enforced and which are a choice
a reviewer has to hold.

## Enforced by the compiler

`tsconfig.json` turns these on, so a violation fails `pnpm check` rather than
being caught in review:

- `strict` — including `strictNullChecks` and `noImplicitAny`.
- `noUnusedLocals` / `noUnusedParameters`.
- `erasableSyntaxOnly` — this is what bans `enum` and constructor parameter
  properties (`constructor(private readonly store: Store)`). Both emit runtime
  code, and this project runs its sources directly with Node's type stripping in
  tests.
- `verbatimModuleSyntax` — type-only imports must say `import type`.
- `allowImportingTsExtensions` with `rewriteRelativeImportExtensions` — imports
  carry their `.ts` extension and are rewritten at build time.

## Linting

**Biome does lint and formatting in one binary**, run as `pnpm check`
(`biome check . && tsc --noEmit`).

`biome.json` on top of `recommended`:

| Rule | Level | Why |
| --- | --- | --- |
| `suspicious/noExplicitAny` | error | `any` turns off the type checker at that point. `unknown` forces the narrowing to be written down. |
| `suspicious/noConfusingVoidType` | error | `void` is a return type, not a generic argument. |
| `suspicious/noDoubleEquals` | error | `==` coerces; this code compares ids and counts where coercion silently matches the wrong thing. |
| `nursery/noMisusedPromises` | error | A promise passed where a value is expected is nearly always a missing `await`. |

**Known gap: there is no `no-floating-promises`.** Biome in this version does not
ship it, and it needs type information. The convention is to make the discard
explicit — `void promise.catch(...)` for fire-and-forget, `await` otherwise.

## The rules that are not enforced, and why they hold anyway

**Use `unknown` at every external boundary, and narrow it immediately.** The
adapter's inputs are the DOM and Playwright's returned JSON; both are untyped and
change without notice. `unknown` forces the narrowing to be written down, and that
narrowing is the actual parsing.

**Parse once, where the data enters.** `statusID()` in `operations/validate.ts`
is the boundary every status target crosses. Everything downstream trusts it.
Adding a second check further in is a sign the boundary is not doing its job.

**Assertions (`as`) are for narrowing after a check, not for silencing.** Nearly
all uses here are a DOM element after a selector, or a `Partial<PageError>` in a
catch. If an assertion is the only thing making a type work, the parse is missing.

## Naming and shape

| Thing | Convention |
| --- | --- |
| Public command ids | `group.action`, lower case, dotted. Public contract. |
| Error codes | `snake_case`, from the fixed list in `src/errors.ts`. Public. |
| Response fields | `snake_case` — the JSON a caller reads. |
| Local variables and functions | `camelCase` |
| Types and interfaces | `PascalCase` |
| Constants that are truly constant | `SCREAMING_SNAKE_CASE` |
| Files | `kebab-case.ts` |
| Test files | `<subject>.test.ts` in `test/` |

Public JSON fields are snake_case because an agent reads them and X's own payloads
use that style; local code is camelCase because TypeScript is. Keep the two apart
rather than converting in both directions.

## What a function should look like

- **One decision lives in one place.** The catalog owns command metadata; the
  operation owns behaviour; the adapter owns the DOM. If a rule appears in two of
  those, one of them is wrong.
- **Pure where possible.** Parsing, id derivation and the receipt state machine
  are pure and take their inputs as arguments. Keep new logic that way and the
  test is a function call.
- **Failures are typed.** Throw `CliError` with a code from the fixed list for
  anything a caller is expected to handle. A bare `Error` is for an invariant
  break inside one function.
- **A `catch` that does not rethrow must say why it is safe.** In this codebase
  they are probes (`does this node exist`) or cleanup. An empty `catch {}` with no
  comment is the one to question in review.
- **No new dependency without a reason.** Direct dependencies are exact versions.

## Comments

Comments explain **why**. The code says what.

- Every non-obvious constant gets the observation behind it, not its value
  restated.
- No JSDoc `@param` / `@returns` tags. They restate the signature.
- A comment that says what the next line plainly does is deleted.
- When a decision is deliberately odd, say what went wrong the other way. That is
  the only thing that stops the next person from "fixing" it.

## Anti-patterns

Drawn from what has actually gone wrong in the sibling project and in this one.

- **Do not read page data outside `src/page/`.** The adapter is the only code that
  parses the DOM. A Playwright locator to wait for or click a control is fine; a
  `page.evaluate` that inspects elements belongs in the adapter as an operation.
- **Do not match a CSS class.** X ships hashed class names that change per build.
  Prefer `data-testid`, then structure, then size — never a hash.
- **Do not pick a handle as an identity.** A handle is renameable and a display
  name is decoration. The numeric status id is the identity; the handle is only
  carried to prove what the composer says it is replying to.
- **Do not widen a check to make a command succeed.** If a target is ambiguous,
  fail with `identity_mismatch`; do not pick the likely one.
- **Do not compare against the whole loaded window when asking "did this
  change".** Loading more replies and a new reply look identical that way.
- **Do not hand-edit `dist/`.** Edit `src/` and run `pnpm build`.
- **`src/page/` may not import from Node.** It is injected into a page; a single
  `node:` import breaks the bundle at runtime, not at build time.
