// CPE 334 Lab 2 — TokTickIT Requester Ticketing MVP — submission document.
// Compile from the repo root:  typst compile --root . docs/lab-02/submission.typ docs/lab-02/submission.pdf

#set document(title: "CPE 334 Lab 2 — TokTickIT Submission", author: "Natthawat Primsirikunawut")
#set page(
  paper: "a4",
  margin: (x: 2cm, y: 2cm),
  numbering: "1 / 1",
  footer: context [
    #set text(8pt, fill: luma(120))
    CPE 334 Lab 2 — TokTickIT — N0TAW00D
    #h(1fr)
    #counter(page).display("1 / 1", both: true)
  ],
)
#set text(font: ("Helvetica Neue", "Arial"), size: 10pt)
#set par(justify: true, leading: 0.6em)
#show heading.where(level: 1): it => [
  #pagebreak(weak: true)
  #block(above: 0pt, below: 12pt)[
    #set text(18pt, weight: "bold", fill: rgb("#006b3c"))
    #it.body
  ]
  #line(length: 100%, stroke: 0.5pt + rgb("#d7e0db"))
  #v(6pt)
]
#show heading.where(level: 2): it => block(above: 14pt, below: 6pt)[
  #set text(12pt, weight: "bold")
  #it.body
]
#show link: it => text(fill: rgb("#0b7a46"))[#underline(it)]
#show raw.where(block: false): it => box(fill: luma(240), inset: (x: 2pt), outset: (y: 2pt), radius: 1pt)[#it]
#show raw.where(block: true): it => block(fill: luma(245), inset: 8pt, radius: 3pt, width: 100%)[#set text(8pt); #it]

#let shot(path, caption, w: 100%) = figure(
  image("../../artifacts/lab-02/screenshots/" + path, width: w),
  caption: caption,
)
#let repo = "https://github.com/N0TAW00D/TokTickIT"
#let pr(n) = link(repo + "/pull/" + str(n))[\##n]

#align(center)[
  #v(3cm)
  #text(24pt, weight: "bold", fill: rgb("#006b3c"))[TokTickIT]\
  #v(4pt)
  #text(14pt)[CPE 334 Lab 2 — Requester Ticketing MVP with UI Foundation]\
  #v(1.5cm)
  #text(11pt)[
    Author: *Natthawat Primsirikunawut* (`N0TAW00D`)\
    Reviewer: *Wisit Suwannao* (`Palapluem`)\
    Repository: #link(repo)[github.com/N0TAW00D/TokTickIT]\
    Branch of record: `main`
  ]
  #v(1cm)
  #text(9pt, fill: luma(120))[Generated #datetime.today().display("[year]-[month]-[day]")]
]

= Answer Part 1: Git Use with Engineering Workflow

*Workflow.* `lab2-staging` was cut from `main`. Every GitHub Issue (#13–#20) was implemented on
its own `feat/…` / `docs/…` feature branch, merged into `lab2-staging` through a peer-reviewed
pull request, and the whole of `lab2-staging` reached `main` through the single release PR
#pr(64) (merged 2026-09-07). There are no direct commits to `main` or `lab2-staging`.

- Full commit history: #link(repo + "/commits/main")[github.com/N0TAW00D/TokTickIT/commits/main]
- Pull requests: #link(repo + "/pulls?q=is:pr")[all PRs] — 40+ Lab 2 PRs (#pr(21) onward)
- GitHub Project board: #link("https://github.com/users/N0TAW00D/projects/3")[TokTickIT Individual Sprints]

*Feature-branch → staging → main.* The `lab2-staging` first-parent history is a straight line of
`Merge pull request #NN from N0TAW00D/feat/…` commits:

```
9b7028c  Merge pull request #59 from N0TAW00D/feat/14e-upload-failed-row
af97fde  Merge pull request #53 from N0TAW00D/feat/20e-e2e-cross-requester
ee32a8d  Merge pull request #52 from N0TAW00D/docs/20-tests-final-refresh
f611091  Merge pull request #51 from N0TAW00D/feat/14d-attachment-actions
83df1ca  Merge pull request #50 from N0TAW00D/feat/20-submission-evidence
ba1ef3c  Merge pull request #47 from N0TAW00D/feat/14c-remove-dialog
 …  (many more feature-branch merges) …
```

The IDE Git-graph view of the same history, most-recent first. Every labelled node is a
`Merge pull request #NN` commit onto `lab2-staging`; the whole branch reaches `main` at the
top through the #pr(64) release merge, and `main` was previously at the Lab 1 release
(`Merge pull request #12`) at the bottom.

#shot("submission/part-1-workflow/git-graph-1-recent.png", [Git graph, most recent — `main`
(`origin/HEAD`) at the #pr(64) release merge of `lab2-staging`, above the #pr(57)–#pr(63)
document / fix / token merges.])
#shot("submission/part-1-workflow/git-graph-2-mid.png", [Git graph, middle — the #pr(38)–#pr(53)
merge band: attachment lifecycle, My Tickets, E2E harness and responsive evidence.])
#shot("submission/part-1-workflow/git-graph-3-early.png", [Git graph, earliest — #pr(21)
(spec contract) through the #pr(36) merges, down to `main` at the Lab 1 release.])

*Project board.* Swept 2026-09-07: Issues #1–#19 are *Done* and closed; #20 (this integration
work) is the last card, moved to *Done* on the #pr(64) release merge. Columns:
Backlog → Specified → Started → PR Review → (Fixing) → Done.

#shot("submission/part-1-workflow/kanban-all-done.png", [GitHub Project "TokTickIT Individual
Sprints" after the #pr(64) merge: Specified / Started / PR Review / Fixing all empty; every
Issue #1–#20 in *Done*.])

*Reviewer record.* Rendered copy: `docs/lab-02/reviewer.md`
(#link(repo + "/blob/main/docs/lab-02/reviewer.md")[view on GitHub]). It lists the reviewer
identity, every PR with its outcome and round count, the substantive review findings with the
author's responses, and the author's own retracted claims. Review within Lab 2 flowed one way
(`N0TAW00D` → `Palapluem`); Lab 1 review was reciprocal (§5 of `reviewer.md`).

*README and `.gitignore`.* Rendered: #link(repo + "/blob/main/README.md")[`README.md`] and
#link(repo + "/blob/main/.gitignore")[`.gitignore`]. `README.md` documents the one-command
bootstrap, the three databases (`localdb`, `toktickit_test`, `toktickit_e2e`), migration, seed,
run and test steps, and the toolchain floor (Node ≥ 20.19, npm ≥ 11.18). `.gitignore` (root +
per-package) excludes `server/uploads/`, all `.env*` except the `.example` templates,
`node_modules`, build output, and `memory/`.

*Repository structure.*

```
client/              React + TypeScript + Vite frontend
  src/{components,screens,shell,requester,tickets,styles}
  tests/lab-02/      component + UI-style test suites
server/              Express + TypeScript + Prisma backend
  src/{routes,middleware,services,validation,lib}
  prisma/{schema.prisma, migrations/, seed.ts}
  tests/lab-02/      API / integration test suites
e2e/                 Playwright end-to-end + responsive tests
  lab-02/{harness.smoke, requester-ticket-flow, responsive, submission-evidence}.spec.ts
docs/lab-02/         specification.md, api-spec.md, ui-spec.md, tests.md, reviewer.md, ai-use.md
artifacts/lab-02/screenshots/   committed Playwright screenshots
```

#shot("submission/part-1-workflow/directory-tree.png", [The repository in the VS Code Explorer:
`client/`, `server/` and `e2e/` each an independent npm package; `docs/lab-02/` the frozen
contract; `artifacts/lab-02/screenshots/` the committed evidence.])


= Answer Part 2: Specification-Driven Development

*Rendered / linked:* `docs/lab-02/specification.md`
(#link(repo + "/blob/main/docs/lab-02/specification.md")[GitHub]). It contains numbered
Functional Requirements (FR-01–FR-37), Business Rules (BR-01–BR-42), Acceptance Criteria
(AC-01–AC-43), and a two-part Definition of Done (§10.1 Product, §10.2 Course Delivery). The
companion contracts are `api-spec.md` (every endpoint, status code and error body), `ui-spec.md`
(the Zen Green token set and per-screen component rules), and `tests.md` (the planned-test
table + AC traceability).

*The contract existed before implementation.* The four `docs/lab-02/` files were first committed
on *2026-09-01* (commit `7947a36`, "add md specification … to shape the development guidelines")
and merged to `lab2-staging` via #pr(21) on *2026-09-01 15:54 UTC*. The first line of screen or
server implementation code was committed on *2026-09-06* (commit `b135e65`, "add Zen Green
presentational foundation"), merged via #pr(23). The frozen contract preceded the first
implementation PR by five days.

```
$ git log --diff-filter=A --format='%ci  %h  %s' -- docs/lab-02/specification.md
2026-09-01 15:13:21 +0700  7947a36  docs: add md specification of api-spec.md, specification.md, …

$ git log --reverse --format='%ci  %h  %s' --since=2026-09-01 -- server/src client/src | head -1
2026-09-06 11:23:14 +0700  b135e65  feat(lab-02): add Zen Green presentational foundation
```

#shot("submission/part-2-spec/pr-timeline-early.png", [GitHub PR list, oldest first: #pr(21)
(the spec / API / UI / test-plan contract) *merged last week*; the first implementation PRs
#pr(22)–#pr(39) *merged yesterday* — the contract landed before any implementation branch.])
#shot("submission/part-2-spec/pr-timeline-recent.png", [GitHub PR list, most recent — after the
#pr(64) release merge: 1 open (#pr(62), this document), 52 closed — the full peer-reviewed
Lab 2 PR set.])


= Answer Part 3: Test-Driven Development and Traceability

*Rendered / linked:* `docs/lab-02/tests.md`
(#link(repo + "/blob/main/docs/lab-02/tests.md")[GitHub]). It holds the planned-test table
(§2, 6 test levels: unit / API / UI component / UI style / responsive / E2E), the
acceptance-criterion traceability matrix (§3 — every AC maps to ≥ 1 planned test), the real
automated-test file path for every row, and the *Final* pass column.

*Final status.* Every §2 row is *Pass*. `tests.md` §3 shows each AC-01…AC-43 tracing to at
least one passing test.

*Passing test output.*

All three suites on `main` at `77e3142` (the #pr(64) release merge):

```
$ git rev-parse --short HEAD
77e3142
$ npm run test:all

  test:server   Test Files  13 passed (13)     Tests  187 passed (187)
  test:client   Test Files  11 passed (11)     Tests  206 passed (206)
  test:e2e      77 passed (40.8s)

  470 checks, all passing
```

The screenshots below are the individual runs from the same `main` checkout.

#shot("submission/part-3-tests/test-server.png", [`npm run test:server` on `main` (`77e3142`) —
Vitest + Supertest against `toktickit_test`: *13 files, 187 passed*.])
#shot("submission/part-3-tests/test-client.png", [`npm run test:client` on `main` (`77e3142`) —
Vitest + Testing Library (jsdom): *11 files, 206 passed* — includes S-01's Zen Green token check.])
#shot("submission/part-3-tests/test-e2e.png", [`npm run test:e2e` on `main` (`77e3142`) —
Playwright, real client + real API + `toktickit_e2e`: *77 passed* (harness smoke,
E2E-01..E2E-05, R-01..R-06 + R-01b, Answer Part 6/7/8 evidence specs).])


= Answer Part 4: AI Use with Reflection

*Rendered / linked:* `docs/lab-02/ai-use.md`
(#link(repo + "/blob/main/docs/lab-02/ai-use.md")[GitHub]).

*LLM used.* Claude (Anthropic) — Claude Code as the orchestrator that held the frozen contract,
cut each Issue into a small slice, wrote the brief, and audited every slice; Claude Sonnet
subagents as the implementers, each given one slice and its own git worktree; the human engineer
(`N0TAW00D`) reviewed and audited every slice before it was pushed and decided every judgement
call. A teammate (`Palapluem`) merged every PR.

*Key prompts.* `ai-use.md` §"Selected key prompts" is a table of 8 representative prompts
spanning contract authoring, an implementation slice, verification by sabotage, the E2E test
infrastructure, responding to a code review, a flake root-cause hunt, checking a review against
the contract, and documentation — each with what the agent produced and how it was verified.

*My Reflection.* The full text is in `ai-use.md`. In short: I set the project up so I would
control the work and not write the code myself — frozen contract first, one small slice per
agent, audit before push, a teammate merges. Freezing the four docs is what made it hold
together: disagreements were settled by quoting a line of the contract, not by arguing intent.
The audit step is where the value was — a green test suite was not the same as a correct slice
(the pagination page-reset had untested gaps, a date formatter shipped rendering "Sept" because
the test called the same broken function, one of my own E2E tests asserted a condition that
could not fail), and I only found those by deliberately breaking the implementation and checking
the right test failed by name. That technique has its own limit — it proves a test is wired, not
that its expected value is right. The controller-plus-subagent split cost real time and created
its own failures (a PR merged onto the wrong branch, stale branches). The peer reviewer still
caught what neither the agent nor my audit did — a `ui-spec` row state that was never built, two
E2E tests that only passed in one execution order — and the lesson I take is that "the test
documents the current behaviour" is not acceptable when the behaviour disagrees with the frozen
contract.


= Answer Part 5: Development Requester Selection

Folded into Answer Part 6 (screenshots 1–6 below).


= Answer Part 6: Working Create Mode

*Screens and states.*

#shot("submission/part-6-create-ticket/01-requester-selection-initial.png", [1 — Development Requester Selection, initial state.])
#shot("submission/part-6-create-ticket/02-requester-dropdown-populated.png", [2 — the active-user dropdown, populated from `GET /api/requesters` (active Requesters only).])
#grid(columns: 2, gutter: 8pt,
  shot("submission/part-6-create-ticket/05-requester-selection-loading.png", [3 — loading state.]),
  shot("submission/part-6-create-ticket/06-requester-selection-failure.png", [4 — API-failure state.]),
)
#shot("submission/part-6-create-ticket/03-selected-requester-app-shell.png", [5 — after selection: the app shell shows the selected Requester in the header.])
#shot("submission/part-6-create-ticket/04-change-requester-menu-open.png", [6 — the "Change Requester" action.])

#shot("submission/part-6-create-ticket/07-create-ticket-initial.png", [7 — Create Ticket, initial. Ticket No. / Ticket Date are read-only ("Generated on submit" / "Set on submit"); Submit is disabled.])
#shot("submission/part-6-create-ticket/08-create-ticket-validation-failure.png", [8 — validation failure: each required field shows a red message directly below it; the errored controls get a red border; focus moves to the first error.])
#grid(columns: 2, gutter: 8pt,
  shot("submission/part-6-create-ticket/09-create-ticket-submitting.png", [9 — submitting: Submit shows the busy "Submitting…" state and is disabled.]),
  shot("submission/part-6-create-ticket/10-create-ticket-success.png", [10 — success: the confirmation shows the official Ticket Number returned by the backend + "View ticket" / "Create another".]),
)
#shot("submission/part-6-create-ticket/11-create-ticket-api-failure-preserved.png", [11 — API failure on submit: a safe error above the actions; every entered value is preserved; Submit returns to enabled.])

*The five numbered demonstrations.*

1. *Requester field populated from the selection, and the saved `requesterId` matches.*
   #shot("submission/part-6-create-ticket/12-demo1-ticket-detail-requester-match.png", [Demo 1 — the ticket opened straight after creation shows the same Requester that was selected before entering the app. The E2E test `E2E-01` also asserts the `POST /api/tickets` `201` body's `requester.id` equals the selected Requester's id.])

2. *Desktop reference data loaded from the database.*
   #shot("submission/part-6-create-ticket/13-demo2-desktop-reference-data-populated.png", [Demo 2 — Category and Related System options come from `GET /api/categories` / `GET /api/related-systems` (seeded rows), not hard-coded.])

3. *Invalid submission shows field-level messages* — screenshot 8 above.

4. *One valid and one invalid attachment.*
   #shot("submission/part-6-create-ticket/14-demo4-valid-and-invalid-attachment.png", [Demo 4 — `battery-report.pdf` is queued (name + size + Remove; count "Attachments (1/5)"); `virus.exe` is rejected inline with "Unsupported file type — not added." and is never queued. The uploader validates extension *and* MIME type, so this holds for drag-and-drop and programmatic files, not just the file-picker `accept` hint.])

5. *Backend stopped → safe error, form values preserved* — screenshot 11 above. The E2E test
   `E2E-04` drives this end to end (`route.abort` on the create POST) and asserts every field
   value survives and Submit re-enables.


= Answer Part 7: Working My Tickets

#shot("submission/part-7-my-tickets/01-requesterA-ticket-list.png", [Requester A ("David Lee") — the full ticket list. Desktop table columns: Ticket No., Created, Summary, Category, Related System, Priority badge, Status badge, Last Updated, View. More than one page of results ("Showing 1–10 of N", pages 1 / 2).])
#shot("submission/part-7-my-tickets/02-after-switch-requesterB-ticket-list.png", [After Change Requester → B ("Sarah Johnson"): only B's own tickets; A's are gone. Backend ownership scoping (`GET /api/tickets` is always filtered to the caller), not a UI filter.])
#grid(columns: 2, gutter: 8pt,
  shot("submission/part-7-my-tickets/03-search-matching-result.png", [Search by ticket number — one matching row.]),
  shot("submission/part-7-my-tickets/04-filters-applied.png", [Filters: Category = Network + Priority = High + Status = New; every rendered row matches all three; the list shrinks and Clear filters appears.]),
)
#grid(columns: 2, gutter: 8pt,
  shot("submission/part-7-my-tickets/05-sorting-applied.png", [Sort = "Ticket number (A→Z)"; the Ticket No. header shows the active caret; rows in ascending order.]),
  shot("submission/part-7-my-tickets/06-pagination-page2.png", [Pagination: page 2, the range indicator updates ("Showing 11–N of N"), Prev enabled / Next disabled on the last page.]),
)
#grid(columns: 2, gutter: 8pt,
  shot("submission/part-7-my-tickets/07-empty-state.png", [Empty state (a Requester who owns zero tickets): "You haven't created any tickets yet." + a primary CTA; the search / filter bar is hidden.]),
  shot("submission/part-7-my-tickets/08-no-results-state.png", [No-results state (a query that matched nothing): "No tickets match your search or filters." + Clear filters; the search / filter bar stays visible and populated. Structurally different from the empty state.]),
)
#shot("submission/part-7-my-tickets/09-cross-requester-access-rejected.png", [Cross-requester access: Requester B navigating directly to `/tickets/:idOfA` gets "Ticket not found" (`GET /api/tickets/:id` is a `404` for a ticket the caller does not own — the same response as an unknown id). E2E test `E2E-03` drives the full switch-and-navigate flow.])


= Answer Part 8: Working Ticket Detail and Attachments

#shot("submission/part-8-ticket-detail/01-owned-ticket-detail.png", [Owned Ticket Detail — every header field in the read-only style, no inputs in the information card; the attachment section shows one active row with Download + Remove and the count "Attachments (1 active / 1 total)".])
#grid(columns: 2, gutter: 8pt,
  shot("submission/part-8-ticket-detail/02-add-attachment.png", [Add attachment via the "+ Add attachment" control — a second active row appears; the count advances to "2 active / 2 total".]),
  shot("submission/part-8-ticket-detail/03-download-active-attachment.png", [Download an active attachment — the test asserts `GET /api/attachments/:id/download` returns `200` with `Content-Disposition: attachment; filename="…"` before this shot.]),
)
#shot("submission/part-8-ticket-detail/04-remove-dialog-with-reason.png", [Soft removal — the confirmation dialog with a required "Reason for removal" (3–200 chars, counter) typed in.])
#shot("submission/part-8-ticket-detail/05-attachment-removed-with-reason.png", [After removal — the row is in the "Removed" presentation: `Removed <date> · "<reason>"`, a `role="status"` toast confirms, the count drops to "0 active / 1 total" (the attachment is retained, not deleted).])
#grid(columns: 2, gutter: 8pt,
  shot("submission/part-8-ticket-detail/06-removed-metadata-retained.png", [Retained metadata — the removed row still shows name / size / type / removed-date / reason.]),
  shot("submission/part-8-ticket-detail/07-removed-download-blocked.png", [Blocked download — the removed row offers no Download / Preview / Remove control, and `GET /api/attachments/:id/download` for it now returns `410 ATTACHMENT_REMOVED` (asserted by a direct API call before this shot).]),
)
#shot("submission/part-8-ticket-detail/08-unauthorized-access-rejected.png", [Unauthorized access — a different selected Requester ("Michael Brown") opening this ticket's `/tickets/:id` URL gets the "Ticket not found" state. Ownership is enforced in the backend for both the ticket and the attachment endpoints.])


= Answer Part 9: Zen Green UI and Responsive Evidence

*Rendered / linked:* `docs/lab-02/ui-spec.md`
(#link(repo + "/blob/main/docs/lab-02/ui-spec.md")[GitHub]) — the colour-token set (§2), typography
and layout (§3), field / control / feedback rules (§5), badges (§7), and per-screen specs
(§6, §8, §9, §10) with responsive behaviour and the visual-inspection checklist (§14).

*Desktop / tablet / mobile screenshots* (`artifacts/lab-02/screenshots/{screen}/{viewport}.png`).
Each screen: desktop full-width, then tablet and mobile below.

#shot("create-ticket/desktop.png", [Create Ticket — desktop (1280×900).])
#grid(columns: (1.4fr, 1fr), gutter: 8pt,
  shot("create-ticket/tablet.png", [tablet (820×1024)]),
  shot("create-ticket/mobile.png", [mobile (375×812)]),
)
#shot("my-tickets/desktop.png", [My Tickets — desktop.])
#grid(columns: (1.4fr, 1fr), gutter: 8pt,
  shot("my-tickets/tablet.png", [tablet — the eight-column table scrolls within its own container (V-09 note)]),
  shot("my-tickets/mobile.png", [mobile — card layout]),
)
#shot("ticket-detail/desktop.png", [Ticket Detail — desktop.])
#grid(columns: (1.4fr, 1fr), gutter: 8pt,
  shot("ticket-detail/tablet.png", [tablet]),
  shot("ticket-detail/mobile.png", [mobile]),
)

*Completed visual checklist* (`tests.md` §4 — walked at desktop 1280×900, tablet 820×1024,
mobile 375×812 against `ui-spec.md` §14):

#table(
  columns: (auto, 1fr, auto),
  inset: 5pt,
  align: (center + horizon, left, center + horizon),
  stroke: 0.4pt + luma(200),
  table.header([*\#*], [*Check*], [*Result*]),
  [V-01], [Header + primary buttons use `--zen-primary`; active nav marked + `aria-current`], [PASS],
  [V-02], [Page bg `--zen-page-bg`; cards white + restrained shadow + `--zen-border`], [PASS],
  [V-03], [Editable fields white/neutral border; read-only fields clearly distinct], [PASS],
  [V-04], [Required `*` present *and* a validation message shows on error, directly under the field], [PASS],
  [V-05], [One input height; Description textarea taller, resizes without breaking layout], [PASS],
  [V-06], [Buttons show text; disabled distinct + inert; Submit busy during request], [PASS],
  [V-07], [Priority + Status badges consistent everywhere and carry a text label], [PASS],
  [V-08], [List = table ≥ 768px, cards < 768px; card carries the same fields + mobile-only 📎 count], [PASS],
  [V-09], [Filters, sort, Clear Filters, pagination usable + unclipped at all viewports], [PASS\*],
  [V-10], [Attachment controls + removed-metadata usable at all viewports; names wrap not clip], [PASS],
  [V-11], [Empty state vs no-results state visibly different], [PASS],
  [V-12], [Visible focus ring when tabbing; keyboard reaches every control], [PASS],
  [V-13], [No horizontal page scroll, no overlap, no hidden primary action], [PASS\*],
  [V-14], [Create Ticket matches Figure-1 field grouping], [PASS],
  [V-15], [Screenshots saved under `artifacts/lab-02/screenshots/{…}/`], [PASS],
)

\* *V-09 / V-13 note:* with eight columns and `ui-spec.md` §9 fixing the table layout at
≥ 768px, the My Tickets table is wider than an 820px tablet viewport and scrolls inside its own
`overflow-x: auto` container. The *page* never scrolls horizontally (asserted by R-01 on all
three screens × three viewports), and no filter / sort / pagination control or label is clipped.
The colour checks (V-01, V-02) are also asserted programmatically in real Chromium by test S-01
(`rgb(0, 107, 60)` / `rgb(245, 247, 246)`).
