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

Eight prompts copied from my Claude Code sessions (typos left as I typed them). Short follow-ups
in the same exchange are joined with "→".

| # | When / Issue | My prompt | What came out of it |
|---|---|---|---|
| 1 | 2026-09-11 · sprint setup (#66) | "'/Users/natthawat/Downloads/Lab_3_sheet.pdf' Please define all detail and create board management throught this labsheet pls 100 percent follow the sheet, dont too much and lesser than the sheet define, concise to the sheet, pls prepare things that can wait for the #65 merge" | Nine Issues (#66–#74) on the Project board with a dependency graph (66→67→68→69→{70, 71, 73}, {70, 71}→72, {72, 73}→74). Cutting `lab3-staging` was held until Lab 2's last PR (#65) merged, so the Lab 2 evidence stayed in the Lab 3 base. |
| 2 | 2026-09-12 · Issue bodies (#66) | "docs have been merge, it will be great to summon another opus to audit yours to be super concise" | A second model reviewed the nine Issue bodies. They went from 2,874 to 2,058 words, mostly by pointing at a handout section instead of retyping it. Seed counts, file paths and the "no `.only`" rule were kept on purpose. |
| 3 | 2026-09-15 · #70 | "continue ur task but pls concern when summon agent to fix the code last time we found the issue that it took to much resource on touching testcase fix, maybe when touch the test case we might use haiku to help" | From then on, mechanical test fixes went to Haiku and Sonnet was kept for route and middleware design. The first one was a Badges test fixture that #71's new `IN_PROGRESS` status had made outdated. |
| 4 | 2026-09-17 · #71 | "try to give agent with many of small task so token of agent will not overflow instead of summon 1 agent to fix all things" | #71 was split into six small dispatches (query validation, route, API tests, screen, responsive layout, client tests). #72 used thirteen and #73 nine. Each result was small enough for me to read and re-run myself. |
| 5 | 2026-09-20 · #72 | "why co author by claude" → "strip" → "i wanna cancel all since 59cee64 and recommit" | Agent commits had picked up a Claude co-author line. The branch history after `59cee64` was rewritten without it, and "no co-author" went into every brief after that. |
| 6 | 2026-09-25 · #74 | "and i think we didnt have new update screenshot? from e2e test?" → "fix the clipping first, is it no need to re capture?" | The committed Staff Ticket Detail screenshots still showed clipped fields. The CSS was fixed first and the screenshots re-captured afterwards, in PR #84. |
| 7 | 2026-09-27 · release | "pls summon subagent gang to check the completeness due to this pdf sheet '/Users/natthawat/Downloads/Lab_3_sheet.pdf'" → "move 1 to the last we will finish all things first before big merge" | Five auditors checked the repository against the handout. Release PR #85 was closed, and the gaps were fixed on `lab3-staging` first: #86 for the traceability and reviewer log, #87 for the axe accessibility tests, #88 for the Part 5–8 evidence. Then one release PR, #89, went to `main`. |
| 8 | 2026-10-04 · submission | "help me to correct does my action follow all of this '/Users/natthawat/Downloads/Lab_3_sheet.pdf'" | A final requirement-by-requirement check. It found the missing post-release reviewer record and the unticked Definition of Done (both fixed in #90), and it led to this submission document. |

## My Reflection

**Specification agent.** Writing `specification.md`, `api-spec.md`, `ui-spec.md` and `tests.md`
before any code helped the most. When there was a question (which status changes are allowed, can
an Administrator post a comment, should another Requester's ticket give 403 or 404) the answer was
already written down, so the coding agent did not guess. The contract still had holes. On #80 the
reviewer found that the Owner filter needed a list of IT Staff that no endpoint provided. I changed
`api-spec.md` myself first and only then asked an agent to build it. I don't think the agent should
be the one deciding to change the contract it is building against.

**Coding agent.** The biggest change from Lab 2 was how I gave out work. At first I gave one agent a
whole Issue. It ran out of context, and its final report was hard to trust. From #71 on I split each
Issue into small tasks and sent simple test fixes to Haiku. Setting this up took longer, but I could
actually read every result. I also stopped trusting "all tests pass". I re-ran each suite myself and
broke guards on purpose to check that the right test failed. Even so, the reviewer found real bugs I
had missed, such as the `/` redirect ignoring the user's role (#83) and clipped fields on Staff
Ticket Detail (#84). Peer review was still needed on top of my own checks.

**Next time.** I would put the standing rules ("no co-author", "run tests in the foreground", "one
small task per agent") into the first brief instead of adding them after something went wrong. I
would also look at the screenshots myself earlier in the sprint instead of at the end, because most
of the layout bugs were visible there long before a test caught them.
