# Lab 2 — AI Use with Reflection

Part 2 deliverable (`specification.md` §10.2). Companion to the Lab 2 peer-review record and to
[`specification.md`](./specification.md), [`tests.md`](./tests.md), [`api-spec.md`](./api-spec.md)
and [`ui-spec.md`](./ui-spec.md).

## LLM used

The AI coding agent for Lab 2 was **Claude (Anthropic)**, used in two roles:

- **Claude Code** as the orchestrator / manager — it held the frozen contract (`docs/lab-02/`),
  cut the work into small single-purpose slices, wrote the brief for each one, ran the audit of
  every slice, and drove the Git and GitHub workflow.
- **Claude Sonnet subagents** as the implementers — each was given one narrow slice, its own
  git worktree (and, for server work, its own test database), and the instruction to commit in
  small steps but never push.

The human engineer (`N0TAW00D`) reviewed and audited every subagent's output before anything was
pushed, decided every judgement call the agent flagged, responded to the peer reviewer, and merged
nothing (all merges were done by the reviewer, `Palapluem`). This mirrors the lab's own "AI Coding
Agent + human engineer" model: the agent produces, the human is accountable for what ships. No
specific model version numbers are claimed beyond "Claude" / "Claude Sonnet".

## Selected key prompts

These are **representative** prompts reconstructed from the sprint, not verbatim transcripts. They
were chosen to show the range of what the agent was used for: contract authoring, implementation,
test infrastructure, verification by sabotage, debugging, responding to review, and documentation.

| # | Phase / Issue | Prompt (summarized) | What the agent produced | How the human verified it |
|---|---|---|---|---|
| 1 | Spec authoring (#13, PR #21) | Draft the four `docs/lab-02/` contract documents — `specification.md`, `api-spec.md`, `ui-spec.md`, `tests.md` — from the labsheet. Every acceptance criterion must map to at least one planned test; every planned test names its real file path. Then run a second pass to find gaps and contradictions in the draft. | Four rendered Markdown docs: BR/FR/AC list, full endpoint contract with exact status codes and error bodies, Zen Green token set and component rules, and a planned-test table (UNIT/API/C/S/R/E2E) with AC traceability. The self-audit pass folded in 13 gaps. | Read in full and approved as the frozen contract before any implementation PR. From that point the docs were read-only; the only sanctioned later edit was the `tests.md` Final-results column (plus two reviewer-requested sections on PR #42). |
| 2 | Implementation slice (#16, PRs #27/#28) | Implement only the Ticket Number allocator and the `POST /api/tickets` route. `TKT-YYYY-NNNNNN`, year in Asia/Bangkok time, per-year sequence. Prove BR-28 atomicity: the concurrency test must fail if the allocator is swapped for a naive read-then-write. Small commits; commit but do not push; do not touch any file outside this slice; reuse the validator message strings verbatim. | An `INSERT … ON CONFLICT DO UPDATE … RETURNING` allocator callable with a transaction, the create route with reference checks and retry-on-collision, and unit + API tests including a 20-way parallel allocation test. | Checked out each commit and ran the suite on it; swapped in a naive allocator and confirmed the concurrency test failed; ran a cross-year instant to confirm the Bangkok-year logic; fresh `npm ci` worktree run. |
| 3 | Verification by sabotage (#18, PR #38) | Audit the My Tickets pagination slice. For every control that should reset the page to 1 (search, each filter, sort, rows-per-page, Clear filters), delete that one `setPage` call, confirm the file actually changed, run the suite, and report whether a test fails. Restore between each. | A sabotage table covering nine behaviours. | Re-run independently, not taken on the agent's report. Three gaps found that the agent's sample missed: priority-change, status-change, and Clear-filters page resets were implemented but had no test protecting them. One existing "Clear filters" test was also unfalsifiable — its setup left the control at its default. Tests added; each `setPage` deletion now fails exactly one test. |
| 4 | Test infrastructure (#20, PR #42) | Build a Playwright E2E harness: a root `test:all` script, a dedicated `toktickit_e2e` database that both the Playwright config and the reset script refuse to run against any other `DATABASE_URL`, a per-run truncate+reseed, and a one-line bootstrap for a clean clone. | The `e2e/` workspace, `playwright.config.ts` with two guarded `webServer` entries, `reset-e2e-db.ts`, and one end-to-end flow test. | Inserted probe rows via `psql` and confirmed the reset cleared only Ticket/Attachment/TicketCounter; tested both port guards separately; pointed `.env.e2e` at the dev DB and confirmed both guard layers refuse to run. Two review rounds followed (see #5). |
| 5 | Responding to review (#20, PR #42 round 2) | The reviewer says pinning "npm 11" is not enough — `npm install-scripts` is not available on all npm 11.x. Establish the true minimum npm version from npm's own release notes, add `engines` to every package that relies on `allowScripts`, commit `.npmrc` with `engine-strict=true`, and re-run bootstrap and the E2E suite from a wiped `node_modules`. | `engines` (`node >=20.19.0`, `npm >=11.18.0`) in the root and all three package manifests, committed `.npmrc`, and updated setup docs — with `npm 11.18.0` identified as the first release where `npm install-scripts` exists. | Confirmed the version claim against npm's `release/v11` changelog independently; verified `engine-strict` fails fast by bumping a manifest to an impossible version; ran the full clean-checkout sequence by hand. Flagged to the reviewer that `engine-strict` is now a hard requirement for all collaborators. |
| 6 | Debugging (PR #34) | The server suite fails roughly one run in eight, on a different test each time, sometimes at the HTTP layer ("socket hang up"). Diagnose the actual root cause. Do not claim it is benign and do not attribute it to parallel agents without proof. | Root cause: `supertest`'s `request(app)` calls `app.listen(0)` for every request, so a test file churns through dozens of ephemeral servers and the OS can hand a request a recycled port still holding a pooled keep-alive socket. Fix: one shared `http.Server` per file via a `useTestServer` helper. | Ruled out the alternatives with evidence (clean base branch; two suites on separate DBs); measured the flake rate before the fix, 0 in 30 after, and confirmed the flake returned when the fix was reverted. Earlier claims to the reviewer that the flake was "pre-existing" and "parallel-agent contention" were corrected in writing on the PRs. |
| 7 | Checking a review against the contract (PRs #25, #26) | The reviewer's comments cite `specification.md §11.20`, `STY-003`, and a "§11.15" ordering rule. Before changing any code, verify every citation against the actual frozen documents and quote file:line for what they really say. | A point-by-point reply: no §11.20 or §11.15 exists; `STY-003` appears nowhere; BR-09 and `ui-spec.md` mandate `localStorage`, and `api-spec.md §2.1` + `tests.md` API-01 mandate ordering by `id`. One routing point in the same review was valid and was accepted. | The disproof was checked line by line before posting. No code changed on those points; the reviewer withdrew the phantom citations on re-review and both PRs merged. |
| 8 | Documentation (#20, PR #52) | Reconcile the `tests.md` Final column with what is actually merged on `lab2-staging`. List every test id, its real status, and any id that is delivered but unlabelled — do not "fix" a labelling gap by writing a new test. | A row-by-row reconciliation identifying the delivered-but-unlabelled cases (e.g. API-03) and the rows still genuinely pending (S-01, the not-yet-written E2E rows). | Cross-checked the id families by reading the document rather than trusting a regex (an earlier regex had silently missed the S/R/V families); confirmed each "Pass" against a real suite run on staging before the column was flipped. |

## My Reflection

The workflow that worked for me was a spec-driven loop: write the frozen contract first
(`specification.md`, `api-spec.md`, `ui-spec.md`, `tests.md`), then have an agent implement one
small slice against it, then audit that slice before it went anywhere — and if the audit failed,
send the slice back and go round again until it held. Freezing the docs up front was the part
that paid off most: every later disagreement — with an agent or with the reviewer — could be
settled by quoting a line of the contract instead of arguing about intent, and the agents
couldn't quietly redesign a screen or an endpoint because the shape was already fixed.

The audit step earned its place. A passing test suite was not the same as a correct slice: the
pagination page-reset had real gaps that every test still went green over, a date formatter shipped
rendering "Sept" that the suite never noticed because the test built its expectation by calling the
same broken function, and one of my own E2E tests asserted a condition that could never fail. I
only caught those by deliberately breaking the implementation and checking the right test failed
by name. But sabotage has a blind spot of its own — it proves a test is wired, not that its
expected value is right — so a test that confidently asserts the wrong answer passes the audit and
is still wrong.

Splitting the work into a controller plus single-slice subagents cost real time and produced a lot
of small PRs to coordinate, and it added its own failure mode — a merge that landed on the wrong
branch, branches going stale as others merged. What I got back was that the review was always
against a settled base, and the audit stayed sequential and focused, which is where the value was.

The human reviewer still caught things neither the agent nor my audit did: that a `ui-spec` row
state ("Upload failed — retry" with Retry and Dismiss) was simply never built, and that two of my
E2E tests only passed in one execution order. The lesson I'm taking is that "the test documents
the current behaviour" is not an acceptable answer when the behaviour disagrees with the frozen
contract — that is a defect to fix, not to write down.
