// CPE 334 Lab 4 — TokTickIT Actions Taken, Dashboards and Final Regression — submission document.
// Compile from the repo root:  typst compile --root . docs/lab-04/submission.typ docs/lab-04/submission.pdf

#set document(title: "CPE 334 Lab 4 — TokTickIT Submission", author: "Natthawat Primsirikunawut")
#set page(
  paper: "a4",
  margin: (x: 1.8cm, y: 1.8cm),
  footer: context [
    #set text(8pt, fill: luma(120))
    CPE 334 Lab 4 — TokTickIT — N0TAW00D
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
#show table: set par(justify: false)
#show raw.where(block: false): it => box(fill: luma(240), inset: (x: 2pt), outset: (y: 2pt), radius: 1pt)[#it]
#show raw.where(block: true): it => block(fill: luma(245), inset: 8pt, radius: 3pt, width: 100%)[#set text(8pt); #it]

#let repo = "https://github.com/N0TAW00D/TokTickIT"
#let pr(n) = link(repo + "/pull/" + str(n))[\##n]
#let doc(path) = link(repo + "/blob/main/" + path)[#raw(path)]
#let shots = "../../artifacts/lab-04/screenshots/"
#let full = 17.4cm

// Cropped screenshot: pw/ph = pixel size of the PNG; x0..x1 and y0..y1 = pixel region kept, scaled to width w.
#let crop(path, pw, ph, caption, w: full, x0: 170, x1: 1270, y0: 0, y1: none, base: shots) = {
  let bottom = if y1 == none { ph } else { calc.min(y1, ph) }
  let s = w / (x1 - x0)
  figure(
    box(width: w, height: (bottom - y0) * s, clip: true, stroke: 0.4pt + luma(210),
      place(top + left, dx: -x0 * s, dy: -y0 * s, image(base + path, width: pw * s, height: ph * s))),
    caption: caption,
    numbering: none,
  )
}
#let tbl(cols, aligns: auto, ..cells) = table(
  columns: cols, inset: 4pt, stroke: 0.4pt + luma(200),
  align: if aligns == auto { left + horizon } else { aligns }, ..cells)

#align(center)[
  #v(3cm)
  #text(24pt, weight: "bold", fill: rgb("#006b3c"))[TokTickIT]\
  #v(4pt)
  #text(14pt)[CPE 334 Lab 4 — Actions Taken, Dashboards and Final Regression]\
  #v(1.5cm)
  #text(11pt)[
    Author: *Natthawat Primsirikunawut* (`N0TAW00D`)\
    Reviewer: *Wisit Suwannao* (`Palapluem`)\
    Repository: #link(repo)[github.com/N0TAW00D/TokTickIT]\
    Branch of record: `main` (release #pr(115), merge `d8f2de5`)
  ]
]
#v(1fr)

= Answer Part 1

== Git use with engineering workflow

*Workflow.* `lab4-staging` was cut from `main` after Lab 3 was released. Each of the nine Lab 4 Issues
(\#92–\#100) was implemented on its own feature branch and merged into `lab4-staging` through a
peer-reviewed pull request (#pr(101)–#pr(114)); `lab4-staging` reached `main` through one release pull
request, #pr(115), which closed Issues \#93–\#100 on merge. Nothing was committed directly to `main` or
`lab4-staging`, and every pull request was reviewed and merged by `Palapluem`.

- Commit history: #link(repo + "/commits/main")[github.com/N0TAW00D/TokTickIT/commits/main]
- Pull requests: #link(repo + "/pulls?q=is:pr")[all PRs]
- Reviewer record: #doc("docs/lab-04/reviewer.md")

*Feature branch → `lab4-staging` → `main` evidence.* First-parent history of `main`
(`git log --first-parent --format='%h %cd  %s' --date=short`; dates are committer dates in UTC+7), newest first; the Lab 4 release #pr(115) sits on
Lab 3's final #pr(91):

```
d8f2de5 2026-11-03  #115 lab4-staging
99158e6 2026-10-04  #91 docs/lab-03-submission-polish
844f093 2026-10-04  #90 docs/lab-03-final
6d66399 2026-10-04  #89 lab3-staging
8d699e4 2026-09-12  #65 docs/20-submission-final-audit
ce2c9de 2026-09-08  #62 docs/20-submission-pdf
77e3142 2026-09-08  #64 lab2-staging
3396c41 2026-08-08  #12 lab1-staging
5d2ca71 2026-08-04  first commit
```

First-parent history of `lab4-staging` since Lab 3's last commit on `main`
(`git log --first-parent 99158e6..lab4-staging`), newest first. Each line is a reviewed feature or fix branch merged
into `lab4-staging`:

```
7027e74 2026-11-03  #114 docs/100-submission
4ccb5a2 2026-11-02  #113 docs/100-final-results
55dcf3c 2026-11-02  #112 feat/100-integration
f4ec16d 2026-11-02  #111 feat/99-hardening
78b6ba7 2026-10-31  #110 feat/96-actions-taken-ui
12f921e 2026-10-30  #109 feat/98-dashboard-ui
bfce69f 2026-10-30  #108 feat/95-ticket-workflow
4759377 2026-10-29  #107 fix/94-review-followups
732a058 2026-10-18  #106 feat/97-dashboard-api
d0a797c 2026-10-15  #105 feat/94-actions-taken-api
d748eb6 2026-10-14  #104 fix/93-seed-review
ef80e88 2026-10-13  #103 feat/93-actions-taken-model
89c2a7b 2026-10-13  #102 docs/92-spec-numeric-order
a7c9f92 2026-10-12  #101 docs/92-lab-04-spec
```

*Project board (Kanban).* GitHub Project: #link("https://github.com/users/N0TAW00D/projects/3")[TokTickIT Individual Sprints]
(columns Backlog → Specified → Started → PR Review → (Fixing) → Done). Final state: all 30 items are in Done, none in
any other column. The nine Lab 4 items and their Issues (all closed):

#tbl((auto, 1fr, auto, auto), aligns: (center + horizon, left, center + horizon, center + horizon),
  [*Issue*], [*Title*], [*Board*], [*Issue state*],
  [\#92], [Lab 4 specification and test plan], [Done], [Closed],
  [\#93], [Actions Taken data model, migration and Lab 4 seed data], [Done], [Closed by #pr(115)],
  [\#94], [Actions Taken API: create, update, authorization, stale updates], [Done], [Closed by #pr(115)],
  [\#95], [Ticket workflow: transition matrix, resolution gate, conflicts], [Done], [Closed by #pr(115)],
  [\#96], [Actions Taken UI on Ticket Detail], [Done], [Closed by #pr(115)],
  [\#97], [Role dashboards API], [Done], [Closed by #pr(115)],
  [\#98], [Role dashboards UI and navigation], [Done], [Closed by #pr(115)],
  [\#99], [Final regression, accessibility and hardening], [Done], [Closed by #pr(115)],
  [\#100], [E2E, responsive inspection, release integration], [Done], [Closed by #pr(115)],
)

*Reviewer record* (#doc("docs/lab-04/reviewer.md") §1–§4). Author `N0TAW00D` (Natthawat Primsirikunawut); reviewer
`Palapluem` (Wisit Suwannao), who reviewed and merged every Lab 4 pull request; `THN4` was not a Lab 4 reviewer. "Rounds" counts
review cycles (each changes-requested or finding-raising review plus the final approval).

#tbl((auto, 1fr, 1.3fr, auto), aligns: (center + horizon, left, left, center + horizon),
  [*PR*], [*Title*], [*Review outcome*], [*Rounds*],
  [#pr(101)], [Lab 4 specification, API spec, UI spec and test plan (\#92)], [Changes requested (gate vs regression rule) → approved], [2],
  [#pr(102)], [BRs and ACs in strict numeric order (\#92)], [Approved], [1],
  [#pr(103)], [Actions Taken model, migration, seed (\#93)], [Changes requested ×4 findings; merged before they were fixed], [1],
  [#pr(104)], [Seed review fixes (\#93)], [Changes requested ×3 → approved], [4],
  [#pr(105)], [Actions Taken API (\#94)], [Changes requested ×2 → approved], [3],
  [#pr(106)], [Dashboards API (\#97)], [Approved; approved again after conflict merge], [2],
  [#pr(107)], [\#105 follow-ups (\#94)], [Changes requested → approved], [2],
  [#pr(108)], [Ticket workflow and resolution gate (\#95)], [Changes requested ×2 → approved], [3],
  [#pr(109)], [Dashboards UI and Dashboard landing (\#98)], [Inline findings, changes requested → approved], [2],
  [#pr(110)], [Actions Taken UI (\#96)], [Changes requested (6 inline) → approved], [2],
  [#pr(111)], [Final regression, accessibility, hardening (\#99)], [Approved], [1],
  [#pr(112)], [E2E, screenshots, visual fixes (\#100)], [Commented, changes requested (server timeouts) → approved], [3],
  [#pr(113)], [Final test results in `tests.md` (\#100)], [Approved], [1],
  [#pr(114)], [Review log and AI use record (\#100)], [Approved], [1],
  [#pr(115)], [`lab4-staging` → `main` release], [Approved], [1],
)

*Representative review findings and resolutions* (full text and replies in `reviewer.md` §2–§3):

#tbl((auto, 1fr),
  [#pr(101)], [The strict resolution gate (BR-17) would break two earlier tests while the plan claimed it listed every edit — the gate was kept (D-27) and both re-pointings listed in `tests.md` §4.2.],
  [#pr(103)–#pr(104)], [Reseeding after real activity (a status change, an upload, "problem appears resolved") rewrote Ticket state — the seed now leaves such Tickets alone; MIG-06b–06e prove each case.],
  [#pr(105)], [Validation order (BR-34): access and `STALE_UPDATE` were checked before field validity — body shape first, then access, then merged-state validation, then the version compare.],
  [#pr(108)], [Unsaved workflow input was lost after failures and Refresh (BR-36) — drafts for status, owner and IT Priority now survive and are never resubmitted automatically.],
  [#pr(109)], [Role filter not in the URL; the chip's "×" button was 28 px on mobile — URL-backed filter (C-33); labelled 44 × 44 px target (R-06).],
  [#pr(110)], [A late response for ticket A could replace ticket B's rows — both detail screens now drop reads for a ticket that is no longer current (C-36).],
  [#pr(112)], [The full server suite timed out under load (10 s hook in WF-11) — the fixture users are created once per file: that file 627 s → 102 s, the suite 1363 s → 512 s, all 1175 passing; no timeout was raised.],
)

One process exception is recorded rather than hidden: #pr(103) was merged by the reviewer while its changes-requested
review was still open; the four findings were fixed in #pr(104) and re-reviewed in four rounds.

*README and `.gitignore`.* #doc("README.md") (prerequisites, one-command bootstrap, databases, seeded accounts, server / client /
e2e / full-suite commands, the Lab 4 test map and per-role demo walk-through, project structure) and
#doc(".gitignore") (excludes `memory/`, `server/uploads/`, `.env*` except the `.example` templates, `node_modules`, build output).

*Repository structure* (top level; verified in the working tree):

```
client/              React + TypeScript + Vite frontend       client/tests/lab-04/
server/              Express + TypeScript + Prisma backend    server/tests/lab-04/
e2e/                 Playwright E2E + responsive + evidence   e2e/lab-04/
docs/lab-04/         specification, api-spec, ui-spec, tests, reviewer, ai-use, submission
artifacts/lab-04/    screenshots/{staff-dashboard, requester-dashboard,
                       actions-taken, ticket-workflow}
README.md  .gitignore  docker-compose.yml  package.json
```

= Answer Part 2

== Specification-driven development

*Link:* #doc("docs/lab-04/specification.md"); companions #doc("docs/lab-04/api-spec.md"),
#doc("docs/lab-04/ui-spec.md"), #doc("docs/lab-04/tests.md"). The specification holds Functional Requirements
FR-01–FR-23 (§4), an authorization matrix (§4.1), Business Rules BR-01–BR-41 (§5), the Ticket status transition matrix (§5.1),
data changes with migration, backfill and recovery (§7), 27 numbered design decisions D-01–D-27 (§7.6, §11), Acceptance Criteria
AC-01–AC-52 (§9) with FR → AC coverage, and the Definition of Done (§10).

*Sample numbered contract items* (full lists at the link):

#tbl((auto, 1fr),
  [FR-01], [IT Staff and Administrators can create an Action Taken under a Ticket with action date/time, description, result, optional assignee, follow-up flag and note, and attachment notes; the backend records the performer.],
  [FR-04], [An Action Taken moves through a status lifecycle (Planned → In Progress → Completed; Cancelled from either non-terminal state); Completed and Cancelled are read-only.],
  [FR-10], [The backend refuses Resolved unless the resolution gate (BR-17) holds, returning the reasons.],
  [FR-12], [Ticket status, owner and IT Priority writes, and Action Taken updates, are rejected as stale when the client's `version` is no longer current, and the response carries the current resource.],
  [BR-01], [An Action Taken belongs to exactly one Ticket, fixed at creation.],
  [BR-02], [The Ticket Owner coordinates the Ticket, but an Action Taken may be performed by a different IT Staff member.],
  [BR-17], [*Resolution gate.* A transition to Resolved requires (a) a Ticket Owner, (b) at least one Completed Action Taken, and (c) no Action Taken in Planned or In Progress; otherwise `RESOLUTION_BLOCKED`, listing every failed condition. Enforced by the backend for any client.],
  [BR-22], [*Recent window:* time zone `Asia/Bangkok` (UTC+7, no DST); `windowStart` is 00:00 Bangkok on the day six days before today; "updated recently" means `Ticket.updatedAt >= windowStart`.],
  [AC-01], [Given a permitted IT Staff user and valid data, when an Action Taken is created, then it is saved under the correct Ticket with the authenticated creator as performer and the approved assignee.],
  [AC-20], [Given a Ticket with no Completed Action, when Resolved is requested directly through the API, then it is rejected with `RESOLUTION_BLOCKED` naming that reason.],
  [AC-27], [Given seeded Tickets for a Requester, when the Requester dashboard is retrieved, then Open, Waiting for Me, Recently Updated and Recently Resolved equal the values recomputed directly from the database.],
)

*Authorization matrix* (`specification.md` §4.1; "Own" = records the user owns as Requester; ‡ = new or changed in Lab 4):

#tbl((1.8fr, auto, auto, auto), aligns: (left + horizon, center + horizon, center + horizon, center + horizon),
  [*Operation*], [*Requester*], [*IT Staff*], [*Administrator*],
  [Log in / out, read own identity, change own password], [✓], [✓], [✓],
  [Create Ticket], [✓], [—], [—],
  [List / view Tickets], [Own], [All], [All (read)],
  [Post Public Comment], [Own], [All], [—],
  [IT Staff Ticket Queue (read) ‡], [—], [✓], [✓],
  [Claim / assign / reassign owner], [—], [✓], [—],
  [Change Ticket status (incl. Resolved, Closed, Cancelled)], [—], [✓], [—],
  [Read Actions Taken ‡], [Own], [All], [All],
  [Create / update Action Taken ‡], [—], [✓], [✓],
  [Read Ticket status history ‡], [Own], [All], [All],
  [Requester dashboard ‡], [✓], [—], [—],
  [IT Staff dashboard ‡], [—], [✓], [✓],
  [User counts inside the dashboard ‡], [—], [—], [✓],
  [List / create / edit users, set initial password], [—], [—], [✓],
)

*Ticket status transition rules* (`specification.md` §5.1; every transition is IT Staff only, unchanged from Lab 3, with the BR-17
gate on every arrival at Resolved; a pair not listed, including a no-op, is `INVALID_TRANSITION`):

#tbl((auto, 1fr, 1.3fr),
  [*From*], [*Permitted next*], [*Notes*],
  [New], [Open, In Progress, Cancelled], [In Progress needs an owner],
  [Open], [In Progress, Waiting for Requester, Resolved, Cancelled], [Resolved needs BR-17],
  [In Progress], [Waiting for Requester, Resolved, Cancelled], [Resolved needs BR-17],
  [Waiting for Requester], [In Progress, Resolved, Cancelled], [In Progress needs an owner; Resolved needs BR-17],
  [Resolved], [Closed, Reopened], [Closed needs BR-40 (no open Actions)],
  [Closed], [Reopened], [No Action writes (BR-12)],
  [Reopened], [In Progress, Waiting for Requester, Resolved, Cancelled], [Resolved needs BR-17],
  [Cancelled], [—], [Terminal; cancelling also cancels open Actions (BR-41)],
)

*Dashboard calculations* (`specification.md` BR-20–BR-24, `api-spec.md` §4–§5): all metrics are computed by the backend
from the database in the `Asia/Bangkok` time zone. The Requester dashboard returns open Tickets, Tickets waiting for the
Requester, recently updated and recently resolved Tickets for the caller's own Tickets only. The IT Staff dashboard returns
unassigned Tickets, Tickets owned by the caller, counts by status and by IT Priority (open Tickets), urgent and recently updated
Tickets, follow-ups, and the caller's open Actions Taken; an Administrator also gets user counts. Each card has a drill-down
query that returns the same count (API-22, API-28). Lists are capped at five items with a "View all" link; empty states are
documented in `ui-spec.md` §3–§4.

*Migration decisions* (`specification.md` §7.4, §7.6): the Lab 4 migration adds an `ActionTaken` table, an append-only
`TicketStatusChange` table and `Ticket.version` without discarding any Lab 2 or Lab 3 row, with a documented recovery path that
is tested on a Lab 3-shaped database (MIG-01..MIG-09). Justified decisions include *D-07* (an integer `version` column instead of
comparing `updatedAt`, because BR-15 bumps `updatedAt` on Action writes and would report false conflicts), *D-03* (a separate
append-only history table instead of deriving history, so "append-only" is structural) and *D-20* (follow-up consistency as a
database `CHECK` as well as service validation). Legacy Tickets get an empty history rather than invented rows (D-10). The
seed is idempotent and leaves Tickets with real application activity alone (MIG-06b–06e).

*Product Definition of Done* (`specification.md` §10.1) — the coding agent may claim "done" only when: every FR is implemented
and every BR enforced by the backend; every AC passes with an automated test listed in `tests.md`; the authorization matrix is
enforced server-side, never by hiding a control; the migration applies to a Lab 3 database with everything intact and the seed is
idempotent; the full suite (unit, API/integration, UI component, UI style, responsive, accessibility, security/authorization,
migration/regression, E2E) passes with nothing skipped, disabled or `.only`; every major screen is verified at desktop, tablet and
mobile with the visual checklist complete; and nothing from the excluded list (§3.2) is built. §10.2 adds the staging → main
workflow, Kanban all Done, `reviewer.md`, `ai-use.md`, this before-implementation evidence, and a current README and `.gitignore`.

*Evidence the specification existed before the implementation.* From the repository history:

```
$ git log --reverse --format='%ci  %h  %s' -- docs/lab-04/specification.md | head -2
2026-10-12 14:53:10 +0700  71af372  docs(lab-04): scaffold the Sprint 4 contract documents and repository structure
2026-10-12 15:03:50 +0700  678320c  docs(lab-04): write the Sprint 4 specification
$ git log --reverse --format='%ci  %h  %s' -- docs/lab-04/api-spec.md docs/lab-04/ui-spec.md docs/lab-04/tests.md
2026-10-12 15:05:08 +0700  8594f2a  docs(lab-04): write the Sprint 4 API contract
2026-10-12 15:07:06 +0700  1fe9b1f  docs(lab-04): write the Sprint 4 UI specification
2026-10-12 15:09:21 +0700  8c9a894  docs(lab-04): write the Sprint 4 test plan and AC traceability
$ git log -S'ActionTaken' --reverse --format='%ci  %h  %s' -- server/prisma/schema.prisma | head -1
2026-10-12 23:55:52 +0700  9db5b4e  feat(db): add Actions Taken, status history and Ticket version (Lab 4 migration)
```

The four contract documents were written on *2026-10-12 between 15:03 and 15:09 +0700* and merged to `lab4-staging` through
#pr(101) at *16:20 +0700*. The first Lab 4 implementation commit (the migration) is at *23:55 +0700 the same day*, and the first
implementation pull request, #pr(103), merged on *2026-10-13 at 10:16 +0700* — after the specification pull request. Every later
implementation pull request (#pr(105)–#pr(112)) merged between 2026-10-15 and 2026-11-02.

= Answer Part 3

== Test-driven development and traceability

*Link:* #doc("docs/lab-04/tests.md"). It holds the commands and rules (§1), the planned tests with a Final column (§2), the
Acceptance Criterion → test matrix (§3), the Labs 1–3 regression rules and the permitted edits to earlier tests (§4) and the final
output (§5).

*Planned tests and actual test files* (`tests.md` §1.1, §2; every row below has Final = Pass):

#tbl((auto, auto, 1fr, auto), aligns: (left + horizon, left + horizon, left, center + horizon),
  [*Level*], [*IDs*], [*Test files*], [*Rows*],
  [Unit], [UNIT-01..11], [`server/tests/lab-04/{action-rules, action-request-hash, ticket-transitions, dashboard-window, …}.test.ts`], [11],
  [API / integration], [API-01..35], [`server/tests/lab-04/{actions-taken, requester-dashboard, staff-dashboard, …}.api.test.ts`, `route-inventory.test.ts`], [35],
  [Workflow], [WF-01..16], [`server/tests/lab-04/ticket-workflow.api.test.ts`], [16],
  [Authorization / security], [SEC-01..08], [`server/tests/lab-04/authorization.api.test.ts`], [8],
  [Migration], [MIG-01..09 (+06b–06e)], [`server/tests/lab-04/migration.test.ts`], [13],
  [Performance smoke], [PERF-01..02], [`server/tests/lab-04/performance-smoke.api.test.ts`], [2],
  [UI component], [C-01..37], [`client/tests/lab-04/{StaffDashboard, RequesterDashboard, ActionsTaken, TicketWorkflow, …}.test.tsx`], [37],
  [UI style], [S-01..09], [`client/tests/lab-04/ui-style.test.tsx`], [9],
  [Responsive], [R-01..06], [`e2e/lab-04/{responsive, drilldown-chips}.spec.ts`], [6],
  [Accessibility], [A11Y-01..06], [`e2e/lab-04/accessibility.spec.ts`], [6],
  [End-to-end], [E2E-01..19], [`e2e/lab-04/{actions-taken-flow, ticket-resolution, dashboards, regression-smoke, screenshots}.spec.ts`], [19],
  [Regression (Labs 1–3)], [REG-01..07], [`server/tests/lab-0{1,2,3}/`, `client/tests/lab-0{1,2,3}/`, `e2e/lab-0{2,3}/`], [7],
  [*Total*], [], [`npm run test:all`], [*169*],
)

*AC traceability* (`tests.md` §3): every one of AC-01…AC-52 maps to at least one test, for example AC-01 → API-01, E2E-01;
AC-20 → WF-03, E2E-07; AC-24 → API-16, WF-08, WF-09, C-26, C-37, E2E-09; AC-27 → API-17, E2E-12. Authorization is asserted at
the HTTP layer (SEC and WF rows), never by UI visibility.

*Final status as recorded in `tests.md` §5* (one run of each suite on `lab4-staging` at `55dcf3c`, the code that #pr(115) carried to
`main` unchanged; #pr(113) and #pr(114) only changed documents; nothing skipped, disabled or `.only`):

```
npm run test:server   Test Files  40 passed (40)   Tests  1175 passed (1175)   485 s
npm run test:client   Test Files  31 passed (31)   Tests   552 passed (552)
npm run test:e2e      352 passed (7.8m)            one worker, database reset first
planned rows: 169 / 169 Pass (Labs 1–3 regression included as REG-01..07)
```

*Complete passing output, file by file* (from the per-test JSON of those runs; each number is the count of tests that passed in
that file, and no test failed):

#set text(7.5pt)
*Server — 40 files, 1175 tests*

#tbl((1fr, auto, 1fr, auto), aligns: (left, center, left, center),
  [`lab-01/app.test.ts`], [2], [`lab-01/categories.test.ts`], [1],
  [`lab-02/attachments.api.test.ts`], [54], [`lab-02/create-ticket.api.test.ts`], [12],
  [`lab-02/my-tickets.api.test.ts`], [14], [`lab-02/reference-data.api.test.ts`], [4],
  [`lab-02/seed.test.ts`], [7], [`lab-02/test-db-identity.test.ts`], [11],
  [`lab-02/test-db-runner.test.ts`], [2], [`lab-02/ticket-detail.api.test.ts`], [8],
  [`lab-02/ticket-number.test.ts`], [9], [`lab-02/validation.test.ts`], [54],
  [`lab-03/attachment-download-staff.api.test.ts`], [7], [`lab-03/auth.api.test.ts`], [75],
  [`lab-03/authorization.api.test.ts`], [23], [`lab-03/comment-validation.test.ts`], [9],
  [`lab-03/comments-notes.api.test.ts`], [27], [`lab-03/migration.test.ts`], [8],
  [`lab-03/password.test.ts`], [14], [`lab-03/staff-assignable-users.api.test.ts`], [11],
  [`lab-03/staff-queue.api.test.ts`], [24], [`lab-03/ticket-detail-staff.api.test.ts`], [11],
  [`lab-03/ticket-it-priority.api.test.ts`], [17], [`lab-03/ticket-notes.api.test.ts`], [20],
  [`lab-03/ticket-owner.api.test.ts`], [21], [`lab-03/ticket-status.api.test.ts`], [88],
  [`lab-03/users-admin.api.test.ts`], [58], [`lab-04/action-request-hash.test.ts`], [4],
  [`lab-04/action-rules.test.ts`], [36], [`lab-04/actions-taken.api.test.ts`], [49],
  [`lab-04/authorization.api.test.ts`], [16], [`lab-04/dashboard-window.test.ts`], [7],
  [`lab-04/migration.test.ts`], [6], [`lab-04/performance-smoke.api.test.ts`], [2],
  [`lab-04/requester-dashboard.api.test.ts`], [9], [`lab-04/route-inventory.test.ts`], [2],
  [`lab-04/seed.test.ts`], [13], [`lab-04/staff-dashboard.api.test.ts`], [8],
  [`lab-04/ticket-transitions.test.ts`], [31], [`lab-04/ticket-workflow.api.test.ts`], [401],
)

*Client — 31 files, 552 tests*

#tbl((1fr, auto, 1fr, auto), aligns: (left, center, left, center),
  [`lab-01/App.test.tsx`], [3], [`lab-02/AppShell.test.tsx`], [1],
  [`lab-02/AttachmentSection.test.tsx`], [82], [`lab-02/Badges.test.tsx`], [11],
  [`lab-02/CreateTicket.test.tsx`], [18], [`lab-02/MyTickets.test.tsx`], [27],
  [`lab-02/RequesterTicketDetail.test.tsx`], [12], [`lab-02/formatDateTime.test.ts`], [7],
  [`lab-02/ui-style.test.tsx`], [24], [`lab-03/AppShell.test.tsx`], [4],
  [`lab-03/ChangePassword.test.tsx`], [12], [`lab-03/Login.test.tsx`], [10],
  [`lab-03/RequireRole.test.tsx`], [16], [`lab-03/StaffTicketDetail.test.tsx`], [34],
  [`lab-03/StaffTicketQueue.test.tsx`], [10], [`lab-03/TicketDetailComments.test.tsx`], [16],
  [`lab-03/UserBadge.test.tsx`], [5], [`lab-03/UserManagement.test.tsx`], [31],
  [`lab-03/ui-style.test.tsx`], [26], [`lab-04/ActionsTaken.test.tsx`], [65],
  [`lab-04/ActionsTakenNavigation.test.tsx`], [1], [`lab-04/AppShellNav.test.tsx`], [11],
  [`lab-04/DashboardRoute.test.tsx`], [5], [`lab-04/DrillDownChips.test.tsx`], [2],
  [`lab-04/ListDrillDown.test.tsx`], [27], [`lab-04/RequesterActionsView.test.tsx`], [9],
  [`lab-04/RequesterDashboard.test.tsx`], [10], [`lab-04/StaffDashboard.test.tsx`], [15],
  [`lab-04/StaffTicketDetailAdministrator.test.tsx`], [2], [`lab-04/TicketWorkflow.test.tsx`], [28],
  [`lab-04/ui-style.test.tsx`], [28], [], [],
)

*E2E — 18 spec files, 352 tests*

#tbl((1fr, auto, 1fr, auto), aligns: (left, center, left, center),
  [`lab-02/harness.smoke.spec.ts`], [2], [`lab-02/requester-ticket-flow.spec.ts`], [5],
  [`lab-02/responsive.spec.ts`], [52], [`lab-02/submission-evidence.spec.ts`], [16],
  [`lab-03/accessibility.spec.ts`], [11], [`lab-03/authentication.spec.ts`], [4],
  [`lab-03/responsive.spec.ts`], [88], [`lab-03/staff-ticket-flow.spec.ts`], [4],
  [`lab-03/submission-evidence.spec.ts`], [24], [`lab-03/user-administration.spec.ts`], [4],
  [`lab-04/accessibility.spec.ts`], [18], [`lab-04/actions-taken-flow.spec.ts`], [9],
  [`lab-04/dashboards.spec.ts`], [22], [`lab-04/drilldown-chips.spec.ts`], [1],
  [`lab-04/regression-smoke.spec.ts`], [6], [`lab-04/responsive.spec.ts`], [63],
  [`lab-04/screenshots.spec.ts`], [18], [`lab-04/ticket-resolution.spec.ts`], [5],
)
#set text(10pt)

*Passing test output in the terminal.* The three commands, as run, end with the summary lines above; the same runs wrote the
JSON this table is built from. The visual checklist V-01…V-17 is reproduced in Answer Part 9.

= Answer Part 4

== AI use with reflection

*Link:* #doc("docs/lab-04/ai-use.md").

*LLM used.* Claude (Anthropic) through Claude Code. The session logs for 12 Oct – 2 Nov show `claude-opus-5-5` (from 12 Oct) and
`claude-sonnet-5-5` (from 22 Oct) as the orchestrator that held the contract, split each Issue into small slices, re-ran and verified
every slice and drove Git; `claude-sonnet-5-5` subagents as the implementers (one narrow slice each, never allowed to push, open a
pull request or merge); and `claude-haiku-5-5` for mechanical test-file touch-ups. The subagent logs before 22 Oct are not on this
machine, so the worker model for the earliest slices is not shown there. The human engineer (`N0TAW00D`) read every result, decided
every judgement call and answered every review; every merge was done by the reviewer `Palapluem`.

*Selected key prompts.* Nine prompts copied from my Claude Code sessions, typos left as typed (Thai ones glossed in square brackets;
the full table is in `ai-use.md`):

#tbl((auto, 1fr, 1fr),
  [*When*], [*My prompt*], [*What came out of it*],
  [12 Oct · \#92], ["pls pre setup my lab04 to following this sheet '…/SE+Lab+4.pdf' comprehensively and hardly following the requirement."], [Issues \#92–\#100 with the `lab-4` label and a dependency graph, `lab4-staging` cut after Lab 3's release, and the `docs/lab-04/` scaffold with every required file and test path.],
  [12 Oct · #pr(101)], ["next review the big one through '…/SE+Lab+4.pdf'"], [A line-by-line review of the merged specification against the handout; it found a numeric-ordering fix had missed the merge, which became #pr(102).],
  [13 Oct · #pr(104)], ["so fix 104 and re request again"], [Three open review points fixed; each new guard was disabled once to prove its test fails; review re-requested.],
  [13 Oct · #pr(104)], ["ไม่เข้าใจว่าติดอะไร" [I don't understand what is blocking]], [The reviewer's fourth round turned into a five-row table of what was asked and what I would do, so I could act on it.],
  [17 Oct · #pr(107)], ["จัดการได้เลย clarify ให้ดด้วย" [Go ahead and handle it, and clarify it for me too]], [A small follow-up pull request for #pr(105) (hash test, 413 code, spec notes) before the workflow lane was rebased.],
  [30 Oct · \#98, \#96], ["pls check the exisiting work in task list and PRs list, and delegate work to sub agent sonnet worker."], [The board was synced and the remaining Issues were handed to Sonnet workers, each in its own worktree.],
  [30 Oct · \#98, \#96], ["u can delegate more than 1 sub agent"], [Three Sonnet workers ran at the same time, each with its own worktree and test database, none allowed to push.],
  [2 Nov · #pr(112)], ["dud u set timeout?"], [A direct answer: no timeout had been changed; the failing hook was vitest's 10 s default. That ruled out "raise the timeout" and pointed at the slow fixture.],
  [2 Nov · #pr(112)], ["make it cheaper"], [Fixture users created once per file: 627 s → 102 s for that file, suite 1363 s → 512 s, 1175/1175 passing.],
)

*My Reflection*

_Specification agent._ Writing the four contract documents before any code again helped most. When a question came up (may a Resolve
happen with an open Action, what does a stale update return, in which order are checks made) the answer was already written, so the
coding agent did not guess. The contract still needed correcting twice. The reviewer of #pr(101) found that the strict resolution gate
would break two earlier tests while the plan said it listed every edit, and I kept the gate and recorded the consequence (D-27)
instead of loosening the rule. On #pr(107) the spec said text is trimmed while the code stores `attachmentNotes` verbatim, and I changed
the wording to state the exception, not the code. I think the agent should not decide to change the contract it is building against;
I decided each of those.

_Coding agent._ I split each Issue into phases of small tasks so I could read every result, and I did not accept "all tests pass" from
an agent: I re-ran the suites myself and disabled a guard on purpose to check that the right test failed. That caught real gaps, for
example an attachment guard that no test actually proved. Review still mattered on top of it: the reviewer found reseed and
validation-order bugs that my checks had missed (#pr(104), #pr(105)), and a missing test-first order in #pr(110) that I could only
record as a deviation because pushed history is not rewritten. A last-week lesson was about test cost: the slowest file made the full
suite time out under load, and the answer was to make the fixture cheaper, not to widen the timeout.

_Next time._ I would put the standing rules into the first brief (run tests in the foreground, one small task per agent, no
co-author line) instead of adding them after something broke, and I would have the agent check for leftover processes on a shared
port before a long run: the agent left a stale server behind, so one end-to-end run never started while I waited for it. I would also
write test fixtures to create users once per file from the start.

= Answer Part 5

== Working IT Staff Dashboard UI

#par(justify: false)[Evidence: `artifacts/lab-04/screenshots/staff-dashboard/` (Playwright spec `e2e/lab-04/screenshots.spec.ts`, E2E-19) and the tests named in each caption.]

*Approved operational metrics, current-user Actions Taken, recent and urgent Tickets, accurate counts.* The IT Staff dashboard
shows the metrics `ui-spec.md` §3 and `api-spec.md` §5 define: Unassigned, Owned by me, Urgent, Follow-ups, counts by status and by IT
Priority, My Open Actions (the current user's own Actions Taken), and Recently Updated Tickets.

#crop("staff-dashboard/loaded-desktop.png", 1440, 1560, [1 — *Loaded* IT Staff dashboard at desktop: metric cards, status and IT Priority counts, the current user's *My Open Actions*, Urgent and Recently Updated lists, each with a drill-down link (C-03, C-04).], w: full, x0: 170, x1: 1270, y0: 0, y1: 1020)
#crop("staff-dashboard/loaded-zero-desktop.png", 1440, 1355, [2 — *Zero state*: a staff member who owns nothing and has no open Actions sees *Owned by Me 0* and *My Open Actions 0* with "You have no open actions.", while the team-wide counts stay correct and nothing errors (API-27, E2E-14, C-06).], w: full, x0: 170, x1: 1270, y0: 0, y1: 820)
#crop("staff-dashboard/loading-desktop.png", 1440, 900, [3 — *Loading* feedback while the dashboard is fetched (C-06).], w: full, x0: 170, x1: 1270, y0: 0, y1: 420)
#crop("staff-dashboard/failure-desktop.png", 1440, 900, [4 — *Safe failure*: an intercepted `500` shows a failure message with Retry and no console error (E2E-16).], w: full, x0: 170, x1: 1270, y0: 0, y1: 420)
#crop("staff-dashboard/administrator-users-desktop.png", 1440, 1563, [5 — *Administrator view* (bottom of the same dashboard): the Users strip with active and inactive counts per role, each with a View list link to `/admin/users?role=…`; IT Staff users do not get it (API-26, API-31, E2E-13).], w: full, x0: 170, x1: 1270, y0: 1330, y1: 1545)
#align(center)[
  #crop("staff-dashboard/loaded-mobile.png", 390, 3004, [6 — *Responsive behavior*: the same dashboard at 390 px (top of the page; no horizontal scroll, R-01).], w: 5.5cm, x0: 0, x1: 390, y0: 0, y1: 900)
]

*Drill-down behavior and forbidden state.* Each card opens the Ticket Queue with the matching filter and the queue total equals the card
value (API-28, E2E-11); a Requester who opens a staff-only URL sees the forbidden state and no protected request is sent (E2E-15).

*Selected metrics match database queries.* The staff metrics are asserted against independent SQL over the seeded database, not
against the code under test:

#tbl((auto, 1fr, auto), aligns: (center + horizon, left, center + horizon),
  [*Row*], [*What the test compares to the database*], [*Final*],
  [API-23], [`unassigned`, `ownedByMe`, `byStatus` (all eight keys) and `byItPriority` equal independent SQL], [Pass],
  [API-24], [My Open Actions counts Planned/In Progress Actions on open Tickets for assignee = me (or none and performer = me)], [Pass],
  [API-25], [Follow-ups, Urgent and Recently Updated equal independent SQL], [Pass],
  [API-28], [Every card's drill-down queue total equals the card value], [Pass],
  [API-31], [Each user-count role `active + inactive` equals the length of `GET /api/users?role=<ROLE>`], [Pass],
)

= Answer Part 6

== Working Actions Taken UI

#par(justify: false)[Evidence: `artifacts/lab-04/screenshots/actions-taken/` (E2E-19) and `e2e/lab-04/actions-taken-flow.spec.ts` (E2E-01..06).]

#crop("actions-taken/list-desktop.png", 1440, 2496, [1 — *List*: several different Actions Taken on one Ticket, each with date/time, description, result, performer, assignee, follow-up and status badge; Edit/View per row (C-10, E2E-02).], w: full, x0: 170, x1: 1270, y0: 860, y1: 1590)
#crop("actions-taken/create-form-desktop.png", 1440, 3453, [2 — *Create*: the form with date/time, status, assignee (active IT Staff and Administrators only), follow-up with its conditional note, description, result and attachment notes; Performed by is shown, not editable (C-11, C-13).], w: 16cm, x0: 170, x1: 1270, y0: 860, y1: 1912)
#crop("actions-taken/edit-desktop.png", 1440, 3642, [3 — *Edit* an open Action: the form is pre-filled and the status control offers only the permitted next states; Planned → In Progress → Completed, and Cancelled behind a confirm dialog, are exercised by C-18 and E2E-03.], w: 16cm, x0: 170, x1: 1270, y0: 940, y1: 2090)
#crop("actions-taken/view-desktop.png", 1440, 3109, [4 — *View mode*: read-only fields on the read-only surface; a Completed or Cancelled Action loses Edit (C-17, S-05).], w: 16cm, x0: 170, x1: 1270, y0: 870, y1: 2030)
#crop("actions-taken/validation-desktop.png", 1440, 3712, [5 — *Validation*: messages sit directly below their field and the typed values are kept (C-12, E2E-04).], w: 15cm, x0: 170, x1: 1270, y0: 950, y1: 2170)
#crop("actions-taken/stale-conflict-desktop.png", 1440, 3082, [6 — *Stale update*: the second editor sees who changed the Action and when, the current values including the date/time, and keeps their typed edit (C-15, E2E-05).], w: 16cm, x0: 170, x1: 1270, y0: 950, y1: 2010)
#crop("actions-taken/requester-readonly-desktop.png", 1440, 1781, [7 — *Role restriction*: the owning Requester sees every Action Taken read-only, with no write controls and no Internal Notes (C-27, E2E-09).], w: full, x0: 170, x1: 1270, y0: 840, y1: 1340)
#align(center)[
  #crop("actions-taken/list-mobile.png", 390, 4125, [8 — *Responsive behavior*: below 768 px the table becomes stacked cards (top of the page, R-03).], w: 5.5cm, x0: 0, x1: 390, y0: 0, y1: 1300)
]

*Assign, inactive-assignee rejection, role restrictions and safe failures* are proven by tests, not screenshots alone: assigning to an
active staff member (API-01, E2E-01), refusing an invalid or deactivated assignee with a field error (API-07, C-19, E2E-04), Requesters
refused on every Actions write (SEC-01) while Administrators keep access with their limits (SEC-02), duplicate submit and a dropped-then-retried
request creating exactly one Action (C-16, API-13, API-33, E2E-06), and the failure state with Retry for a `500` (C-28, E2E-16). All of these rows are Pass in `tests.md`.

= Answer Part 7

== Working Ticket Workflow

#par(justify: false)[Evidence: `artifacts/lab-04/screenshots/ticket-workflow/` (E2E-19), `e2e/lab-04/ticket-resolution.spec.ts` (E2E-07..10) and `server/tests/lab-04/ticket-workflow.api.test.ts` (WF-01..16).]

#crop("ticket-workflow/status-options-desktop.png", 1440, 2496, [1 — *Permitted transitions*: the status control offers only the transitions the matrix allows for the Ticket's current status; the resolution checklist matches the Ticket's data (C-22, C-24, WF-01, WF-02).], w: full, x0: 170, x1: 1270, y0: 150, y1: 660)
#crop("ticket-workflow/resolution-blocked-desktop.png", 1440, 2628, [2 — *Resolution gate*: Resolved is blocked with every failed reason listed; after the open Action is completed the same control succeeds (WF-03..06, E2E-07).], w: full, x0: 170, x1: 1270, y0: 150, y1: 740)
#crop("ticket-workflow/status-history-desktop.png", 1440, 2496, [3 — *Append-only history in stable order*: each change with from, to, who and when, ordered by time then id; visible to IT Staff, Administrators and the owning Requester (WF-08, WF-09, E2E-09).], w: full, x0: 170, x1: 1270, y0: 1180, y1: 1600)

*Stable ordering and append-only behaviour* are asserted at the HTTP layer: history is returned in `changedAt` then `id` order and is `[]`
for a Ticket that never changed (API-16, WF-09); POST, PUT, PATCH and DELETE on the history route are `404` for every role and write
nothing (WF-09). *Role-appropriate visibility:* the owning Requester reads their own history, another Requester gets the same `404` as for
a nonexistent Ticket, and a request with no session is `401` (WF-09, SEC rows). A status change and its history row commit in one
transaction, and a forced failure rolls both back (WF-08); a stale status write returns `409 STALE_UPDATE` with the current Ticket (WF-10,
E2E-10).

= Answer Part 8

== Working Requester Dashboard and Final Regression UI

Evidence: `artifacts/lab-04/screenshots/requester-dashboard/` (E2E-19) and `e2e/lab-04/dashboards.spec.ts` (E2E-11..16).

#crop("requester-dashboard/loaded-desktop.png", 1440, 900, [1 — *Requester-owned metrics*: My Open Tickets, Waiting for me, Recently Updated and Recently Resolved for the signed-in Requester only, with recent and attention-required Tickets and "View all" drill-downs (C-08, API-17, API-22).], w: full, x0: 170, x1: 1270, y0: 0, y1: 760)
#crop("requester-dashboard/loaded-zero-desktop.png", 1440, 900, [2 — *Zero state*: a Requester with no Tickets sees zero cards and empty messages (API-20, E2E-14, C-09).], w: full, x0: 170, x1: 1270, y0: 0, y1: 520)
#crop("requester-dashboard/failure-desktop.png", 1440, 900, [3 — *Safe failure* with Retry (E2E-16).], w: full, x0: 170, x1: 1270, y0: 0, y1: 420)

*Ownership protection.* Another Requester's Tickets are never counted or listed and a `requesterId` in the query is ignored (API-18);
a pasted `/tickets/:id` of another Requester's Ticket is not found (E2E-12, SEC rows).

*Representative regression evidence for Labs 1–3.* E2E-18 (`e2e/lab-04/regression-smoke.spec.ts`) walks, on the Lab 4 build, login and forced password change, My Tickets,
Ticket Detail, attachments, Public Comments, the IT Staff queue and detail, Internal Notes, and Administrator user management; it is Pass.
The Labs 1–3 suites themselves are green and unchanged except for the edits recorded in `tests.md` §4.2: server REG-01..03, client
REG-04 (349 tests across Labs 1–3) and e2e REG-05..06 (75 Lab 2 and 135 Lab 3 e2e tests) are all Pass. Two of those screens are shown below from the
committed Lab 3 screenshot set; E2E-18 and REG-05/06 re-exercise them on the final build.

#crop("submission/part-7-staff-detail/05-public-comment-posted.png", 1440, 1702, [IT Staff posting a Public Comment on a Ticket (Lab 3 submission set; Lab 4 keeps the thread and adds the Actions Taken and history cards above it)], w: full, x0: 170, x1: 1270, y0: 900, y1: 1500, base: "../../artifacts/lab-03/screenshots/")
#crop("submission/part-8-user-management/01-list-name-email-role-status-edit.png", 1440, 1088, [Administrator User Management: list, role and status, edit action (Lab 3 submission set)], w: full, x0: 170, x1: 1270, y0: 0, y1: 760, base: "../../artifacts/lab-03/screenshots/")

= Answer Part 9

== Zen Green UI, responsive, accessibility and final polish

*Rendered / linked:* #doc("docs/lab-04/ui-spec.md") — Zen Green reuse and extensions (§1), navigation and role landing (§2), IT Staff
Dashboard (§3), Requester Dashboard (§4), Actions Taken on Ticket Detail (§5), ticket workflow and resolution feedback (§6), feedback
conventions (§7), responsive behavior (§8), accessibility (§9), the visual and accessibility checklist (§10) and screenshot paths (§11).

*Desktop / tablet / mobile screenshots* (`artifacts/lab-04/screenshots/{screen}/{state}-{desktop,tablet,mobile}.png`; 1440×900, 820×1180 and
390×844 viewports; tall pages are cropped to their top here, the full images are committed):

#block(breakable: false, {
  crop("staff-dashboard/loaded-desktop.png", 1440, 1560, [IT Staff Dashboard — desktop], w: 12cm, x0: 170, x1: 1270, y0: 0, y1: 600)
  grid(columns: (1.5fr, 1fr), gutter: 8pt,
    crop("staff-dashboard/loaded-tablet.png", 820, 1920, [tablet], w: 8.6cm, x0: 0, x1: 820, y0: 0, y1: 620),
    crop("staff-dashboard/loaded-mobile.png", 390, 3004, [mobile], w: 5.4cm, x0: 0, x1: 390, y0: 0, y1: 620))
})
#block(breakable: false, {
  crop("requester-dashboard/loaded-desktop.png", 1440, 900, [Requester Dashboard — desktop], w: 12cm, x0: 170, x1: 1270, y0: 0, y1: 600)
  grid(columns: (1.5fr, 1fr), gutter: 8pt,
    crop("requester-dashboard/loaded-tablet.png", 820, 1180, [tablet], w: 8.6cm, x0: 0, x1: 820, y0: 0, y1: 700),
    crop("requester-dashboard/loaded-mobile.png", 390, 1347, [mobile], w: 5.4cm, x0: 0, x1: 390, y0: 0, y1: 800))
})
#block(breakable: false, {
  crop("actions-taken/list-desktop.png", 1440, 2496, [Actions Taken list on Staff Ticket Detail — desktop], w: 12cm, x0: 170, x1: 1270, y0: 860, y1: 1590)
  grid(columns: (1.5fr, 1fr), gutter: 8pt,
    crop("actions-taken/list-tablet.png", 820, 2828, [tablet], w: 8.6cm, x0: 0, x1: 820, y0: 1160, y1: 1700),
    crop("actions-taken/list-mobile.png", 390, 4125, [mobile], w: 5.4cm, x0: 0, x1: 390, y0: 1560, y1: 2400))
})
#block(breakable: false, {
  crop("actions-taken/requester-readonly-desktop.png", 1440, 1781, [Requester read-only Actions Taken and history — desktop], w: 12cm, x0: 170, x1: 1270, y0: 840, y1: 1340)
  grid(columns: (1.5fr, 1fr), gutter: 8pt,
    crop("actions-taken/requester-readonly-tablet.png", 820, 1862, [tablet], w: 8.6cm, x0: 0, x1: 820, y0: 920, y1: 1420),
    crop("actions-taken/requester-readonly-mobile.png", 390, 2573, [mobile], w: 5.4cm, x0: 0, x1: 390, y0: 1310, y1: 2130))
})
#block(breakable: false, {
  crop("ticket-workflow/resolution-blocked-desktop.png", 1440, 2628, [Ticket workflow: resolution blocked — desktop], w: 12cm, x0: 170, x1: 1270, y0: 150, y1: 740)
  grid(columns: (1.5fr, 1fr), gutter: 8pt,
    crop("ticket-workflow/resolution-blocked-tablet.png", 820, 2960, [tablet], w: 8.6cm, x0: 0, x1: 820, y0: 0, y1: 900),
    crop("ticket-workflow/resolution-blocked-mobile.png", 390, 4281, [mobile], w: 5.4cm, x0: 0, x1: 390, y0: 0, y1: 1000))
})

*Completed visual and accessibility checklist* (`ui-spec.md` §10; each row is proven by the tests and screenshots in its Evidence column,
and every test ID below is Pass in `tests.md` §2 on the final run):

#set text(8.5pt)
#tbl((auto, 1.5fr, 1fr, auto), aligns: (center + horizon, left, left, left + horizon),
  [*\#*], [*Check*], [*Evidence*], [*Result*],
  [V-01], [Every colour comes from a token; no hard-coded hex outside `theme.css`.], [S-01], [Pass],
  [V-02], [Dashboard, Actions Taken and history are visually of a piece with Labs 2–3 (card, spacing, type scale).], [E2E-19], [Pass],
  [V-03], [Dashboard is first in every role's nav, active state shown, and no unauthorized destination rendered.], [C-01, E2E-15], [Pass],
  [V-04], [Metric cards: label, value, sub-label and link affordance all visible; zero cards are still readable; needs-attention is conveyed by text, not colour alone.], [C-03, C-08, S-03], [Pass],
  [V-05], [Dashboard lists at most 5 rows, with a "View all (N)" link, and empty lists show their message.], [C-04, C-06, C-09], [Pass],
  [V-06], [Editable vs read-only is unmistakable in the Action form and View mode (surface vs `--zen-readonly-bg`; Performed by is static text).], [C-11, C-17, S-05], [Pass],
  [V-07], [Validation messages sit directly below their field; the stale and blocked callouts keep user input visible.], [C-12, C-14, C-15, C-24], [Pass],
  [V-08], [`ActionStatusBadge` is distinct from `StatusBadge`; Ticket status, IT Priority and Requested Priority badges stay consistent everywhere.], [S-02], [Pass],
  [V-09], [The status control offers only permitted transitions; the resolution checklist matches the data.], [C-22, C-24, E2E-07], [Pass],
  [V-10], [Visible focus on every interactive element, including metric cards, row buttons and the conditional follow-up note; logical tab order.], [A11Y-05, A11Y-06], [Pass],
  [V-11], [No clipping, no overlap, no hidden primary action; long text clamps with a `title`.], [R-01, R-02, R-03, R-04], [Pass],
  [V-12], [No horizontal page scroll at 320, 768, 992 and 1440 px.], [R-01, R-02, R-03, R-04], [Pass],
  [V-13], [Loading, empty, no-results, forbidden, not-found, stale, blocked and failure states each render distinctly.], [C-06, C-09, C-14, C-15, C-24, C-28, C-30], [Pass],
  [V-14], [Dialogs usable at mobile width and restore focus on close.], [R-05, C-18], [Pass],
  [V-15], [Requester Ticket Detail shows Actions Taken and history read-only with no write controls and no Internal Notes.], [C-27, R-04, A11Y-04], [Pass],
  [V-16], [No console errors, broken links, placeholder or lorem text, or unfinished controls on any main journey.], [E2E-17], [Pass],
  [V-17], [Private vs shared content is distinguishable at a glance and without colour: Internal Notes keep the private surface, border and "Private" badge; Actions Taken, status history and Public Comments carry no private styling, and the Actions Taken header states "Visible to the requester".], [S-06, C-27], [Pass],
)
#set text(10pt)

_Note (V-12):_ the project's three-tier viewport matrix (390 / 820 / 1440) is used for screenshots; the responsive tests additionally
assert 320, 768 and 992 px (R-01..R-04) and the 44 × 44 px drill-down chip target at 390 px (R-06).
