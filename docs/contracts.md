# Contracts

Everything here is public. A caller — usually an agent — is written against it,
so changes are versioned by behavior, not by intent.

## Envelopes

Success, stdout, exit `0`:

```json
{ "ok": true, "data": { … } }
```

A dry run adds `"dry_run": true` beside `ok`.

Failure, stderr, nonzero exit:

```json
{ "ok": false, "error": { "type": "state", "code": "selector_changed", "message": "…", "hint": "…", "retryable": false } }
```

`details` is present when the failure has structured evidence.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | internal |
| 2 | validation |
| 3 | authentication or verification |
| 4 | browser or timeout |
| 5 | state, selector or identity |
| 6 | uncertain delivery or idempotency conflict |
| 130 | cancelled |

## Error codes

| Code | Type | Meaning |
| --- | --- | --- |
| `invalid_argument` | validation | The arguments cannot describe an operation. |
| `login_required` | authentication | X presented a signed-out page. |
| `verification_required` | authentication | X presented a human-verification gate. |
| `browser_not_running` | browser | No dedicated Chrome session. |
| `browser_unavailable` | browser | Chrome was reachable but not usable. |
| `chrome_not_found` | browser | No Chrome executable was found. |
| `timeout` | browser | The command exceeded its timeout. |
| `delivery_uncertain` | execution | A press happened with no evidence the page accepted it. |
| `idempotency_conflict` | execution | A request ID was reused with different input. |
| `selector_changed` | state | A control or record was not where the adapter expects it. |
| `identity_mismatch` | state | The page disagreed about which account, tweet or composer is current. |
| `draft_conflict` | state | A composer holds text this command did not type. |
| `editor_not_ready` | state | A composer is not rendered yet or not open. |
| `not_found` | state | A requested record is not in the loaded window. |
| `busy` | state | Another command owns the state directory. |
| `state_corrupt` | state | A state file cannot be trusted. |

`retryable` is true only for `timeout`, `browser_not_running`,
`browser_unavailable`, `busy` and `editor_not_ready`. `selector_changed` is
deliberately not retryable: it covers both a page mid-render and a structural
change, and repeating it spends the same time for the same answer.

## Commands

| Command | Effect | Writes |
| --- | --- | --- |
| `browser start/stop/status/configure/config` | local | no |
| `auth login` | navigation | no |
| `auth status` | read | no |
| `status` | read | no |
| `feed read` | navigation | no |
| `search keyword` | navigation | no |
| `search hot` | navigation | no |
| `trend read` | navigation | no |
| `trend posts` | navigation | no |
| `auto suggest` | navigation | no |
| `notice read` | navigation | no |
| `post get` | navigation | no |
| `saved bookmarks` / `saved likes` | navigation | no |
| `comment list` | navigation | no |
| `comment get` | navigation | no |
| `comment section` | navigation | no |
| `comment check` | navigation | no |
| `comment scroll` | navigation | no |
| `comment post` | account_write | yes |
| `comment reply` | account_write | yes |
| `comment delete` / `delete-many` | account_write | yes |
| `post create` | account_write | yes |
| `post like` / `post bookmark` / `post repost` | account_write | yes |
| `user follow` | account_write | yes |
| `list members` | navigation | no |
| `list follow` | account_write | yes |
| `receipt get` | read | no |
| `history list` | read | no |
| `clean` | local | no |

## Reading a source: timeline, search, one status

```json
{
  "source": "timeline",
  "query": null,
  "items": [
    {
      "id": "1234567890",
      "handle": "someone",
      "name": "Someone",
      "text": "…",
      "at": "2026-11-03T06:00:00.000Z",
      "likes": 12,
      "replies": 3,
      "retweets": 1,
      "reply_to": null,
      "root": false,
      "mine": false,
      "depth": 0,
      "promoted": false
    }
  ],
  "scope": "loaded_dom",
  "complete": false,
  "scrolls": 2,
  "limits": ["…"]
}
```

`source` is `timeline`, `search` or `status`. `post get` returns
`{ status_id, item, scope, complete, limits }` instead, because there is exactly
one item by definition.

Promoted posts are removed from `items` and the count is stated in `limits`.
Dropping them silently would make a caller's "the timeline had ten posts" wrong;
leaving them in would let a target be picked through an advertisement.

`items[].id` is accepted by `comment post --status` and `comment list --status`
unchanged. There is no second id form.

No command joins reading to writing. That is a contract, not an omission — see
[AGENTS.md](../AGENTS.md#what-is-out-of-scope-on-purpose).

## Reading a conversation

```json
{
  "status_id": "1234567890",
  "root": { "id": "1234567890", "handle": "someone", "text": "…", "root": true, … },
  "items": [ { "id": "…", "handle": "…", "text": "…", "reply_to": { "handle": "…", "id": null }, "depth": 0, … } ],
  "scope": "loaded_dom",
  "complete": false,
  "scrolls": 3,
  "limits": [ "…" ]
}
```

`scope` and `complete` are always `loaded_dom` and `false`. They are not
bookkeeping: a caller that treats `items` as the full thread will be wrong, and
the field is the only warning it gets.

`reply_to.id` is null because X's "Replying to" line links the profile, not the
replied-to tweet. Use `items[].id` for reply targets.

## The write contract

A write requires `--request-id`. The request id names a fingerprint of
`{action, status_id, comment_id, text}`:

- same id, same fingerprint, status `confirmed` → the receipt is replayed,
  nothing is sent.
- same id, different fingerprint → `idempotency_conflict`.
- same id, status `dispatching` → `delivery_uncertain`, nothing is sent.

A send returns:

```json
{ "request_id": "…", "confirmed": true, "changed": true,
  "result": { "evidence": "toast", "reply_to": { "tweet_id": "…", "handle": "…" } } }
```

`evidence` is `toast` (X's own success message) or `new_row`. `new_row` requires
three things at once: the row's status id was not on the page when the command
started typing, its text is exactly what was typed, and its article says this
account wrote it. Text alone is not evidence — a page can load an older row that
somebody else wrote, and matching on text confirmed sends that never happened.

With neither, the command fails with `delivery_uncertain` and the receipt records
`uncertainty_reason`: `composer_still_open`, `composer_closed_without_new_row`,
`new_row_by_another_account`, or `no_delivery_evidence`. A composer that closes
without leaving a new row is **not** success: X closes it on success, and it also
closes it when the send is rejected or the owner presses Escape.

**A `delivery_uncertain` reply is never resent automatically.** It may be out.

## Receipt

```json
{
  "request_id": "reply-1234567890-01",
  "fingerprint": "sha256:…",
  "operation": "comment.post",
  "status": "prepared | dispatching | confirmed | not_sent",
  "created_at": "…",
  "updated_at": "…",
  "target": { "tweet_id": "…", "comment_id": "…" },
  "result": { … },
  "uncertainty_reason": "…"
}
```

`prepared` is written before the composer is armed. `dispatching` is written
immediately before the press and is the point of no return. `not_sent` means the
attempt failed with certainty that nothing left. `confirmed` means the page
produced evidence.
