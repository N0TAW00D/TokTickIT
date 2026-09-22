# Lab 3 — AI Use with Reflection

Part 4 deliverable (`specification.md` §14 Part 4). Companion to `docs/lab-03/reviewer.md` and to
[`specification.md`](./specification.md), [`tests.md`](./tests.md), [`api-spec.md`](./api-spec.md)
and [`ui-spec.md`](./ui-spec.md).

## LLM used

The AI coding agent for Lab 3 was **Claude (Anthropic)**, used in the same two-role split as
Lab 2 (see `docs/lab-02/ai-use.md`):

- **Claude Code** as the orchestrator / manager — it held the frozen contract (`docs/lab-03/`),
  decomposed each of the nine Issues into small, independently reviewable slices, wrote the brief
  for each slice, personally re-ran and verified every slice's test suite rather than trusting an
  agent's self-report, ran sabotage audits, decided every judgement call an agent flagged, and
  drove the Git and GitHub workflow.
- **Claude Sonnet subagents** as the implementers — each was given one narrow slice, told to
  commit in small logically-separate steps, and told explicitly never to push, open a PR, or
  merge. A handful of purely mechanical test-file touch-ups (re-pointing an already-correct test
  at a contract that had shifted underneath it) were routed to Claude Haiku instead, reserving
  Sonnet for slices requiring real design or security judgement.

The human engineer (`N0TAW00D`) reviewed and audited every subagent's output before anything was
pushed, decided every judgement call and contract-amendment question, responded to the peer
reviewer, and merged nothing — every merge across all nine Issues (#66–#74) was done by the
reviewer, `Palapluem`. This mirrors the lab's own "AI Coding Agent + human engineer" model. No
specific model version numbers are claimed beyond "Claude" / "Claude Sonnet" / "Claude Haiku".

## Selected key prompts

These are **representative** prompts reconstructed from the sprint, not verbatim transcripts,
chosen to show the range of what the agent was used for across all nine Issues: contract
authoring, implementation with a real judgement call, mid-sprint contract amendment, verification
by sabotage, responding to review, catching a real bug through generated test infrastructure, and
an honest test-plan reconciliation.

| # | Phase / Issue | Prompt (summarized) | What the agent produced | How the human verified it |
|---|---|---|---|---|
| 1 | Spec authoring (#66, PR #75) | Draft the four `docs/lab-03/` contract documents from the handout, extending (not restating) Lab 2's equivalents. Every acceptance criterion must map to at least one planned test naming a real file path; the dependency graph between the nine Issues must be minimal and symmetric on both sides. Then self-audit for over-scope and exclusion leakage. | Four Markdown documents (BR/FR/AC list, endpoint contract, extended Zen Green tokens, a 120-planned-test table with full AC traceability) plus a self-audit that caught the Issue dependency graph's asymmetry and an over-scope leak, both corrected before freezing. | Read in full and approved as the frozen contract. The peer reviewer independently re-derived the FR/BR/AC/D counts, the 70-AC traceability and the WCAG contrast ratios from the hex values before approving — see `reviewer.md` #75. |
| 2 | Implementation with a judgement call (#67, PR #76) | Rename `RequesterUser` to `User` across the schema, add Session/PublicComment/InternalNote models and Ticket ownership/itPriority columns, hand-write the migration SQL (not generator output) so existing Lab 2 rows survive with ids and ownership intact, and seed all three roles idempotently. | A hand-edited migration preserving every Lab 2 row, a case-insensitive `lower(email)` unique index (deliberately not a Prisma `@unique`, since Prisma has no declarative representation for it), and MIG-01..06 covering the rename, backfills, and idempotent reseeding. | Sabotage-audited (role default, itPriority backfill, the case-insensitive index each independently broken and confirmed to fail exactly its matching MIG test), restored clean, then independently re-run: 198/198. |
| 3 | Verification by sabotage (#69/#70/#71/#72/#73, all PRs) | For each slice, deliberately break one specific guard (a role check, a 403 branch, a page-reset, a forbidden-field allow-list entry) one at a time, confirm the file actually changed, run the suite, and report whether exactly the matching test fails — never taken on the agent's own word. | Across the sprint: 60+ individual sabotage rounds, each tied to one named test. | Every round was re-run by the human, not trusted from an agent's report. This is the same discipline Lab 2's #18 audit established, applied slice-by-slice for the whole sprint rather than once. |
| 4 | Mid-sprint contract amendment (#71/#72, PR #80) | The peer reviewer found the Owner filter couldn't offer "each active IT Staff member" because no IT-Staff-callable endpoint existed to list staff. Decide whether to amend the frozen `api-spec.md` now or defer formally to a later Issue, then draft the amendment. | A new §4.2 endpoint (`GET /api/staff/assignable-users`) added to the frozen contract with a traceability row, reusing an existing FR/BR/AC rather than minting new ones, built to be reused by Issue #72's later Ticket Owner picker. | The amendment decision itself was made by the human (amending a frozen contract is controller-level, not an implementation call); the endpoint and its 403-for-Administrator coverage were sabotage-verified after an agent's implementation pass. |
| 5 | Responding to review (#82, PR #82) | The reviewer found two real defects: deactivating a user didn't drop its existing sessions, and the `LAST_ADMIN` last-active-Administrator check had a concurrent-request race. Fix both with a regression test proving the exact scenario each guards against. | Session deletion generalized to every deactivating `PATCH`, not just the separate password-reset path that already had it; the active-Administrator count and the changed row(s) locked inside one `prisma.$transaction` (`SELECT … FOR UPDATE`) so two concurrent demotions can't both pass the check. | Both fixes sabotage-verified by reverting each independently and confirming its own new regression test — and no other test — failed. |
| 6 | Real bug caught by generated test infrastructure (#74, this Issue) | Write the Playwright responsive/screenshot spec (R-01..R-06) for all four Lab 3 screens at three viewports, following the existing Lab 2 spec's technique, and take the required screenshots. | The IT Staff Ticket Queue's five-filter row copied Lab 2's four-filter "stay on one line above 768px" threshold verbatim; with the Owner filter's real staff names added, the row's true width overflowed the document by 188px at tablet width — a genuine, previously-unnoticed CSS bug, not a test bug. | The human reverted the fix, re-ran just the failing test, confirmed it failed with the identical 188px figure and nothing else broke, then restored the fix — the same sabotage-in-reverse technique used throughout the sprint, applied to a bug the tests themselves discovered rather than one the human planted. |
| 7 | Honest test-plan reconciliation (#74, this Issue) | `tests.md` was written up front, before implementation; go through every row, confirm a real matching test exists and is non-trivial, and only then flip its Status to Pass. If a row's actual coverage is narrower than its own literal claim, leave it `Planned` and report exactly why — do not write a token test just to flip the column, and do not silently mark something Pass to make the count look better. | Of 120 planned tests, 111 verified and flipped to Pass; 9 left honestly `Planned` with a specific, named gap for each (e.g. only 2 of 4 owner-required source states tested, not all four as UNIT-06/API-31 claim). Two rows initially found completely missing — not just narrower than claimed — were written from scratch rather than merely disclosed, since both were fully templated by an existing Lab 2 equivalent. | The human read the diffs and the exact final test counts (507/507 server, 349/349 client, 131/131 e2e) directly rather than trusting the agent's own tally; the 9 remaining gaps were cross-checked against the actual test files' assertions, not just their existence. |

## My Reflection

Lab 3 continued the same controller/subagent split Lab 2 established, but the sprint made the
value of that split sharper in three ways I didn't fully appreciate going in.

First, **decomposition discipline had to go one level deeper than PR size**. Lab 2 taught me to
keep PRs and commits small; partway through Lab 3 I noticed I was still handing one Sonnet agent
an entire Issue — backend route, tests, frontend screen, responsive layout, client tests, all in
one brief — and watching its context fill with exploration and implementation noise before it
even reached the point where I could trust its self-report. Splitting a single Issue into five or
six small, sequential dispatches (one for the query/validation logic, one for the route and its
server tests, one for the screen scaffold, one for responsive layout, one for client tests, and so
on) made each dispatch's output small enough to actually read and verify, not just skim and trust.
That discipline is what let the sabotage audits stay meaningful across nine Issues instead of
becoming a rubber stamp by Issue #71.

Second, **a green suite still was not the same thing as an honest one**, and Lab 3 gave me a
sharper version of the lesson Lab 2's pagination audit first taught. `tests.md` was written
entirely up front, before a line of implementation existed, and by the time Issue #74 asked me to
reconcile its Status column against reality, I found that reconciliation itself needed the same
skepticism I'd been applying to agents' test-passing claims. Several rows claimed more than their
actual test proved — "every non-matrix transition pair" when only a representative sample was
checked, "performs no write" asserted by a response body rather than a database read — and two
rows (an entire missing component test, an entire missing style-discipline test file) had simply
never been picked up by anyone across the whole sprint. The instinct to just flip every `Planned`
to `Pass` because the suite was green would have been the same mistake as trusting an agent's
"done" without re-running it myself. Leaving nine rows honestly `Planned`, each with a one-line
reason, felt like a worse-looking result in the moment than a clean 120/120 — but it's the
accurate one, and it's exactly the kind of gap this lab's own review process exists to catch
before I do.

Third, **the controller role sometimes meant making a call an implementation agent correctly
refused to make on its own**. When the peer reviewer found the Owner filter couldn't list IT
Staff because no endpoint existed to enumerate them, the right response wasn't to have an agent
invent one and hope it matched the spirit of a frozen contract — it was for me to amend
`api-spec.md` first, deliberately, with a traceability row, and only then hand the now-updated
contract to an agent to implement against. The same was true later for Issue #74 itself: deciding
whether two genuinely-missing test files were worth writing from scratch versus just disclosing as
known limitations was a judgement call about the sprint's own completeness claim, not something to
delegate. Agents build faithfully against whatever contract or plan they're handed; deciding when
that contract or plan itself needs to change is where the human accountability in this model
actually lives, and Lab 3 asked for that more often than Lab 2 did.
