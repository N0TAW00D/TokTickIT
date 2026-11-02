# Lab 4 AI Use — TokTickIT

## LLMs used

Claude (Anthropic), through *Claude Code*. The Claude Code session logs for 12 Oct – 2 Nov 2026 show
these model IDs:

| Role | Model | Evidence |
|---|---|---|
| Orchestrator (held the contract, split Issues into slices, wrote briefs, re-ran and verified every slice, drove Git and GitHub) | `claude-opus-5-5` (from 12 Oct), `claude-sonnet-5-5` (from 22 Oct) | main-session turns in the logs |
| Implementers (one narrow slice each, never allowed to push, open a pull request or merge) | `claude-sonnet-5-5` | subagent turns in the logs |
| Mechanical test-file touch-ups | `claude-haiku-5-5` | subagent turns in the logs |

The subagent logs available on this machine start on 22 Oct, so the exact worker model for the
earlier slices (12–17 Oct) is not shown in them; the working agreement was Sonnet for implementation
throughout, as in Labs 2 and 3. The human engineer (`N0TAW00D`) read every result, decided every
judgement call, answered every review, and the reviewer `Palapluem` did every merge.

## Key prompts

Nine prompts copied from my Claude Code sessions, typos left as typed. Dates are 2026. A Thai
prompt is followed by an English gloss in square brackets. What came out of each is what the
repository and the session record show.

| When | My prompt | What came out of it |
|---|---|---|
| 12 Oct · #92 | "pls pre setup my lab04 to following this sheet '…/SE+Lab+4.pdf' comprehensively and hardly following the requirement." | Nine Issues #92–#100 with the `lab-4` label and a dependency graph, `lab4-staging` cut from `main` after Lab 3 was released, and the `docs/lab-04/` scaffold with every required file and test path. |
| 12 Oct · #101 | "next review the big one through '…/SE+Lab+4.pdf'" | A line-by-line review of the merged specification against the handout. It found that a numeric-ordering fix had missed the merge, which became #102. |
| 13 Oct · #104 | "so fix 104 and re request again" | Three open review points fixed (requester-resolved activity, comment multiplicity, README wording). Each new guard was disabled once to prove its test fails, then review was re-requested. |
| 13 Oct · #104 | "ไม่เข้าใจว่าติดอะไร" [I don't understand what is blocking] | The reviewer's fourth round turned into a five-row table of what was asked, what I would do and what was outside my control, so I could act on it (`tests.md` rows, UNIT-10 path, e2e result). |
| 17 Oct · #107 | "จัดการได้เลย clarify ให้ดด้วย" [Go ahead and handle it, and clarify it for me too] | A small follow-up pull request for #105 (hash test, 413 code, spec notes) before rebasing the workflow lane. |
| 30 Oct · #98, #96 | "pls check the exisiting work in task list and PRs list, and delegate work to sub agent sonnet worker." | The board was synced (#95 and #97 to Done) and the remaining Issues were handed to Sonnet workers, each in its own worktree. |
| 30 Oct · #98, #96 | "u can delegate more than 1 sub agent" | Three Sonnet workers ran at the same time, each with its own worktree and test database, none allowed to push; the two UI lanes were rebased and verified while a follow-up worker folded the #106 notes into #99. |
| 2 Nov · #112 | "dud u set timeout?" | A direct answer: no timeout had been changed; the failing hook was vitest's 10 s default. That ruled out "just raise the timeout" and pointed at the slow fixture. |
| 2 Nov · #112 | "make it cheaper" | `ticket-workflow.api.test.ts` creates its four users once per file instead of per test: 627 s → 102 s for the file, full server suite 1363 s → 512 s, 1175/1175 passing (`d8aed9d`). |

## My Reflection

_Specification agent._ Writing the four contract documents before any code again helped most. When
a question came up (may a Resolve happen with an open Action, what does a stale update return,
which order are checks made in) the answer was already written, so the coding agent did not guess.
The contract still needed correcting twice. The reviewer of #101 found that the strict resolution
gate would break two earlier tests while the plan said it listed every edit, and I chose to keep the
gate and record the consequence (D-27) instead of loosening the rule. On #107 the spec said text is
trimmed while the code stores `attachmentNotes` verbatim, and I changed the wording to state the
exception, not the code. I think the agent should not decide to change the contract it is building
against; I decided each of those.

_Coding agent._ I split each Issue into phases of small tasks so I could read every result, and I
did not accept "all tests pass" from an agent: I re-ran the suites myself and disabled a guard on
purpose to check that the right test failed. That caught real gaps, for example an attachment guard
that no test actually proved. Review still mattered on top of it: the reviewer found reseed and
validation-order bugs that my checks had missed (#104, #105), and a missing test-first order in #110
that I could only record as a deviation because pushed history is not rewritten. A final-week
lesson was about test cost: the slowest file made the full suite time out under load, and the
answer was to make the fixture cheaper, not to widen the timeout.

_Next time._ I would put the standing rules into the first brief (run tests in the foreground,
one small task per agent, no co-author line) instead of adding them after something broke, and I
would have the agent check for leftover processes on a shared port before a long run: the agent
left a stale server behind, so one end-to-end run never started while I waited for it. I would also
write test fixtures to create users once per file from the start.
