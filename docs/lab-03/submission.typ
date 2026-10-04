// CPE 334 Lab 3 — TokTickIT Users, Roles, IT Staff Ticketing and Admin — submission document.
// Compile from the repo root:  typst compile --root . docs/lab-03/submission.typ docs/lab-03/submission.pdf

#set document(title: "CPE 334 Lab 3 — TokTickIT Submission", author: "Natthawat Primsirikunawut")
#set page(
  paper: "a4",
  margin: (x: 1.8cm, y: 1.8cm),
  footer: context [
    #set text(8pt, fill: luma(120))
    CPE 334 Lab 3 — TokTickIT — N0TAW00D
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
#let shots = "../../artifacts/lab-03/screenshots/"
#let full = 17.4cm

// Full or vertically cropped screenshot. pw/ph = pixel size of the PNG; y0/y1 = pixel rows kept.
#let crop(path, pw, ph, caption, w: full, y0: 0, y1: none) = {
  let bottom = if y1 == none { ph } else { calc.min(y1, ph) }
  let s = w / pw
  figure(
    box(width: w, height: (bottom - y0) * s, clip: true, stroke: 0.4pt + luma(210),
      place(top + left, dy: -y0 * s, image(shots + path, width: w, height: ph * s))),
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
  #text(14pt)[CPE 334 Lab 3 — Users, Roles, IT Staff Ticketing and Administration]\
  #v(1.5cm)
  #text(11pt)[
    Author: *Natthawat Primsirikunawut* (`N0TAW00D`)\
    Reviewer: *Wisit Suwannao* (`Palapluem`)\
    Repository: #link(repo)[github.com/N0TAW00D/TokTickIT]\
    Branch of record: `main`
  ]
]
#v(1fr)

= Answer Part 1

== Git use with engineering workflow

*Workflow.* `lab3-staging` was cut from `main`. Each of the nine Lab 3 Issues (#66–#74) was
implemented on its own feature branch and merged into `lab3-staging` through a peer-reviewed pull
request (#pr(75)–#pr(88)); `lab3-staging` reaches `main` through one release PR, #pr(89)
(#pr(85), the first attempt, was closed unmerged before review). No direct commits to `main` or `lab3-staging`.

- Commit history: #link(repo + "/commits/main")[github.com/N0TAW00D/TokTickIT/commits/main]
- Pull requests: #link(repo + "/pulls?q=is:pr")[all PRs]
- Reviewer record: #doc("docs/lab-03/reviewer.md")

*Feature branch → `lab3-staging` evidence.* First-parent history of `lab3-staging`
(`git log --first-parent --format='%h %ci %s'`), newest first:

```
7020dd3 2026-10-04  Merge pull request #88 from N0TAW00D/test/74-submission-evidence
cb52918 2026-10-01  Merge pull request #87 from N0TAW00D/test/74-a11y-axe
5afdbd8 2026-09-29  Merge pull request #86 from N0TAW00D/docs/74-audit-fixes
d0e3d0f 2026-09-26  Merge pull request #84 from N0TAW00D/docs/74-release-leftovers
2a9d21f 2026-09-25  Merge pull request #83 from N0TAW00D/feat/74-integration
5299294 2026-09-22  Merge pull request #82 from N0TAW00D/feat/73-user-management
487844f 2026-09-21  Merge pull request #81 from N0TAW00D/feat/72-staff-ticket-detail
bca95c8 2026-09-17  Merge pull request #80 from N0TAW00D/feat/71-staff-ticket-queue
9bb28d1 2026-09-17  Merge pull request #79 from N0TAW00D/feat/70-requester-regression
20bc7aa 2026-09-15  Merge pull request #78 from N0TAW00D/feat/69-authorization
e857b06 2026-09-15  Merge pull request #77 from N0TAW00D/feat/68-authentication
203fb99 2026-09-14  Merge pull request #76 from N0TAW00D/feat/67-user-model-migration
28347a2 2026-09-14  Merge pull request #75 from N0TAW00D/docs/66-lab-03-spec
```

IDE Git graph of `main` (newest at top): the #pr(89) release merge of `lab3-staging` sits above the
feature-branch merges #pr(88) → #pr(75), which in turn sit on Lab 2's #pr(65).

#crop("submission/part-1-workflow/git-graph-1-recent.png", 990, 1386, [1. Newest: #pr(89) release merge → #pr(83)], w: 12.5cm)
#crop("submission/part-1-workflow/git-graph-2-mid.png", 992, 1586, [2. Middle: #pr(83) → #pr(80)], w: 12.5cm)
#crop("submission/part-1-workflow/git-graph-3-early.png", 972, 1590, [3. Earliest: #pr(80) → #pr(65)], w: 12.5cm)

*Project board (Kanban).* GitHub Project: #link("https://github.com/users/N0TAW00D/projects/3")[TokTickIT Individual Sprints]
(columns Backlog → Specified → Started → PR Review → (Fixing) → Done).

#crop("submission/part-1-workflow/kanban-all-done.png", 2172, 1646, [Project board: Backlog, Specified, Started, PR Review and Fixing are all 0; Done holds all 21 items, including Lab 3 Issues #66–#74 (the Done list is scrolled, so #66 is just above the visible area).], w: 15cm)

*Reviewer record* (#doc("docs/lab-03/reviewer.md") §1–§3). Author `N0TAW00D` (Natthawat
Primsirikunawut); reviewer `Palapluem` (Wisit Suwannao), who reviewed and merged every Lab 3 feature PR
(#pr(75)–#pr(88) in the record); `THN4` (Thanatip Nitinantakul) was not a Lab 3 reviewer.

#tbl((auto, 1fr, 1.2fr, auto), aligns: (center + horizon, left, left, center + horizon),
  [*PR*], [*Title*], [*Review outcome*], [*Rounds*],
  [#pr(75)], [Lab 3 specification, API spec, UI spec and test plan (#66)], [Commented (1 real finding) → approved], [2],
  [#pr(76)], [User model, Lab 2 migration and Lab 3 seed data (#67)], [Commented (1 finding) → approved], [2],
  [#pr(77)], [Authentication foundation (#68)], [Changes requested → approved], [2],
  [#pr(78)], [Role-based authorization and role-aware shell (#69)], [Changes requested → approved], [2],
  [#pr(79)], [Requester regression, Public Comments, resolved indication (#70)], [Changes requested → approved], [2],
  [#pr(80)], [IT Staff Ticket Queue (#71)], [Changes requested → approved], [2],
  [#pr(81)], [IT Staff Ticket Detail (#72)], [Changes requested ×3 → approved], [4],
  [#pr(82)], [Administrator User Management (#73)], [Changes requested → approved], [2],
  [#pr(83)], [E2E, responsive/visual inspection, release integration (#74)], [Changes requested ×2 → approved], [3],
  [#pr(84)], [Finish Staff Ticket Detail clipping; record #pr(83) review (#74)], [Changes requested → approved], [2],
  [#pr(85)], [`lab3-staging` → `main` release (first attempt)], [Closed unmerged, before review], [—],
  [#pr(86)], [Traceability and reviewer-log audit fixes (#74)], [Changes requested ×2 → approved], [3],
  [#pr(87)], [axe accessibility e2e, A-01..A-09 (#74)], [Changes requested ×4 → approved], [5],
  [#pr(88)], [Part 5–8 submission evidence + Requester detail wrap fix (#74)], [Changes requested ×4 → approved], [5],
  [#pr(89)], [`lab3-staging` → `main` release PR], [Commented (3 findings), fixed → approved], [2],
)

#pr(89) was approved on 2026-10-04 ("I found no remaining blocking issues and approve this PR") and merged into `main` as `6d66399`; `reviewer.md` records #pr(75)–#pr(89).

*Representative review findings and resolutions* (full quotes and replies in `reviewer.md` §3):

#tbl((auto, 1fr),
  [#pr(75)], [BR-37 repeal list vs. `api-spec.md` §9 cited a rule (L2-BR-35) not in the repeal list — accepted, `api-spec.md` §9 corrected before the contract froze.],
  [#pr(76)], [`DevPassword123!` visible vs. "no password readable" — resolved by quoting AC-58 (one documented local-only credential allowed).],
  [#pr(77)], [Malformed-cookie crash and a user trapped in forced password change.],
  [#pr(78)], [Forbidden-route test did not actually prove no request was sent.],
  [#pr(79)], [Two write routes missing the 415 Content-Type gate.],
  [#pr(80)], [Owner filter had no option per active IT Staff member — led to the `GET /api/staff/assignable-users` contract amendment.],
  [#pr(82)], [Sessions not dropped on deactivation; unprotected last-Administrator race — fixed with a transaction-locked check and regression tests.],
  [#pr(89)], [MIG-06 timed out at the 5 s default (590/591), stale 154/154 vs 210/210 and a stale `reviewer.md` — query collapsed, 30 s timeout justified, docs reconciled.],
  [#pr(83) / #pr(84)], [Nine tests left `Planned`, login redirect bypass, Staff Ticket Detail clipping, a missed 992 px breakpoint — each fixed with a falsifiable test.],
)

*README and `.gitignore`.* #doc("README.md") (prerequisites, one-command bootstrap, databases, seeded
local-development accounts, server / client / e2e / full-suite commands, project structure) and
#doc(".gitignore") (excludes `memory/`, `server/uploads/`, `.env*` except the `.example` templates,
`node_modules`, build output).

*Repository structure* (top level; verified in the working tree):

```
client/              React + TypeScript + Vite frontend       client/tests/lab-03/
server/              Express + TypeScript + Prisma backend    server/tests/lab-03/
e2e/                 Playwright E2E + responsive + evidence   e2e/lab-03/
docs/lab-03/         specification, api-spec, ui-spec, tests, reviewer, ai-use (+ submission.typ/.pdf)
artifacts/lab-03/    screenshots/{authentication, change-password, staff-queue, staff-ticket-detail,
                       user-management, requester-ticket-detail, forbidden, submission}
README.md  .gitignore  docker-compose.yml  package.json
```

= Answer Part 2

== Specification-driven development

*Link:* #doc("docs/lab-03/specification.md"); companions #doc("docs/lab-03/api-spec.md"),
#doc("docs/lab-03/ui-spec.md"), #doc("docs/lab-03/tests.md"). The specification holds Functional
Requirements FR-01–FR-36 (§4), Business Rules BR-01–BR-42 (§5), an authorization matrix (§4.1), a status
transition matrix (§5.1), Acceptance Criteria AC-01–AC-70 (§9), migration decisions (§7.4) and the Definition of Done (§10).

*Sample numbered contract items* (full lists at the link):

#tbl((auto, 1fr),
  [FR-01], [A user authenticates with an email address and a password.],
  [FR-10], [Every protected endpoint rejects an authenticated caller whose role is not permitted by the authorization matrix in §4.1.],
  [FR-30], [An Administrator can update a user's name, email address, role and activation state.],
  [BR-06], [Passwords are stored only as a bcrypt hash (cost 12); no endpoint, log or error message returns a password or hash.],
  [BR-09], [Email addresses are unique across all users, compared case-insensitively and stored lower-cased.],
  [BR-24], [A Ticket must have a Ticket Owner before it may enter In Progress.],
  [AC-01], [Given an active user with valid credentials, when the user logs in, then the backend establishes authenticated access and returns the permitted user identity and role.],
  [AC-40], [Given a Ticket with no owner, when IT Staff attempt to set In Progress, then it is rejected.],
  [AC-54], [Given the last active Administrator, when any change would leave no active Administrator, then it is rejected.],
  [AC-55], [Given a Requester and an IT Staff user, when each calls any Administrator endpoint, then both are refused.],
)

*Authorization matrix* (`specification.md` §4.1; "Own" = records the user owns as Requester):

#tbl((1.6fr, auto, auto, auto), aligns: (left + horizon, center + horizon, center + horizon, center + horizon),
  [*Operation*], [*Requester*], [*IT Staff*], [*Administrator*],
  [Log in / out, read own identity, change own password], [✓], [✓], [✓],
  [Create Ticket], [✓], [—], [—],
  [List / view Tickets], [Own], [All], [All (read)],
  [Upload / download / remove Attachment], [Own], [All (read)], [All (read)],
  [Post Public Comment], [Own], [All], [—],
  [Read Public Comments], [Own], [All], [All],
  [Indicate "Problem Appears Resolved"], [Own], [—], [—],
  [IT Staff Ticket Queue], [—], [✓], [—],
  [Claim / assign / reassign owner], [—], [✓], [—],
  [Be assigned as Ticket Owner; set IT Priority], [—], [✓], [✓],
  [Change Ticket status; create Internal Note], [—], [✓], [—],
  [Read Internal Note], [—], [✓], [✓],
  [List / create / edit users, set initial password], [—], [—], [✓],
)

*Migration decisions* (`specification.md` §7.4): (1) `RequesterUser` is *renamed* to `User` by
hand-written `ALTER TABLE … RENAME` so no Lab 2 row, id or foreign key is lost; (2) the two Ticket→User
relations are named `TicketRequester` / `TicketOwner`; (3) `role` defaults to `REQUESTER`; (4)
`passwordHash` is added nullable → backfilled → `NOT NULL`, with `mustChangePassword` defaulting `true`;
(5) `Ticket.itPriority` added the same three-step way, backfilled from `requestedPriority`; (6) emails
lower-cased after a loud duplicate check and a unique index on `lower(email)` (BR-09); (7) `TicketStatus`
gains seven values, existing tickets stay `NEW`; (8) the Development Requester selector,
`GET /api/requesters` and `X-Requester-Id` are deleted (BR-37).

*Product Definition of Done* (`specification.md` §10.1) — the coding agent may claim "done" only when:
every FR implemented and every BR enforced server-side; every AC passes with an automated test in
`tests.md`; the authorization matrix is enforced by the backend, never by UI visibility alone; the
migration applies to a database holding Lab 2 data with everything intact and the seed is idempotent; no
Development Requester selector / endpoint / middleware / stored selection remains; passwords exist only as
bcrypt hashes; the full suite (unit, API/integration, UI component, UI style, responsive,
security/authorization, migration/regression, E2E) passes with nothing skipped, disabled or `.only`; every
major screen verified at desktop, tablet and mobile with the visual checklist complete; nothing from §3.2 built.
§10.2 (Course delivery) adds the staging→main workflow, Kanban all-Done, `reviewer.md`, `ai-use.md`, this
before-implementation evidence, and a current `README.md` / `.gitignore`.

*Evidence the specification existed before the implementation PRs.* From the repository history:

```
$ git log --diff-filter=A --format='%ci  %h  %s' -- docs/lab-03/specification.md
2026-09-13 09:51:03 +0700  717fabc  docs(lab-03): add Lab 3 specification
$ git log --diff-filter=A --format='%ci  %h  %s' -- docs/lab-03/tests.md docs/lab-03/api-spec.md docs/lab-03/ui-spec.md
2026-09-13 09:51:16 +0700  5ce4268  docs(lab-03): add Lab 3 test plan
2026-09-13 09:51:16 +0700  2e54d25  docs(lab-03): add Lab 3 UI specification
2026-09-13 09:51:16 +0700  0173849  docs(lab-03): add Lab 3 API specification
```

The four contract documents were committed on *2026-09-13* and merged to `lab3-staging` through #pr(75) on
*2026-09-14 14:00 +0700* (merge `28347a2`). The first Lab 3 implementation commit touching `server/src` or
`client/src` is `0a010f4` ("rescope Lab 2 requester lookups after the User rename", 2026-09-14 17:35), and the
first implementation PR, #pr(76), merged at 2026-09-14 21:33 — after the specification PR. Every later
implementation PR (#pr(77)–#pr(84)) merged between 2026-09-15 and 2026-09-26. `tests.md` itself states that every
planned row "existed before the implementation PRs".

= Answer Part 3

== Test-driven development and traceability

*Link:* #doc("docs/lab-03/tests.md"). It holds the strategy (§1), the planned-test tables (§2), the
AC-to-test traceability matrix (§3, AC-01…AC-70), the visual checklist (§4), commands (§5), final results (§6)
and known limitations (§7).

*Planned tests and actual test files* (`tests.md` §1.1, §2):

#tbl((auto, auto, 1fr, auto), aligns: (left + horizon, left + horizon, left, center + horizon),
  [*Level*], [*IDs*], [*Test files*], [*Planned / Pass*],
  [Unit], [UNIT-01..11], [`server/tests/lab-03/{password,ticket-status.api,staff-queue.api}.test.ts`], [11 / 11],
  [API / integration], [API-xx], [`server/tests/lab-03/{auth,ticket-owner,ticket-it-priority,ticket-status,ticket-notes,comments-notes,staff-queue,staff-assignable-users,ticket-detail-staff,attachment-download-staff,users-admin}.api.test.ts`], [50 / 50],
  [Security / authorization], [SEC-xx], [`server/tests/lab-03/authorization.api.test.ts` (HTTP-level only)], [9 / 9],
  [Migration / regression], [MIG-xx], [`server/tests/lab-03/migration.test.ts`, `server/tests/lab-02/*.api.test.ts`], [8 / 8],
  [UI component], [C-xx], [`client/tests/lab-03/{Login,ChangePassword,AppShell,RequireRole,UserBadge,StaffTicketQueue,StaffTicketDetail,TicketDetailComments,UserManagement}.test.tsx`], [18 / 18],
  [UI style], [S-01..06], [`client/tests/lab-03/ui-style.test.tsx`], [6 / 6],
  [Responsive], [R-01..R-06], [`e2e/lab-03/responsive.spec.ts`], [7 / 7],
  [End-to-end], [E2E-01..12, EV-01..04], [`e2e/lab-03/{authentication,staff-ticket-flow,user-administration,submission-evidence}.spec.ts`], [16 / 16],
  [Accessibility], [A-01..09], [`e2e/lab-03/accessibility.spec.ts`], [9 / 9],
  [*Total*], [], [`npm run test:all`], [*134 / 134*],
)

*AC traceability* (`tests.md` §3): every AC maps to at least one test, for example AC-01 → API-01, E2E-01;
AC-05 → API-02, C-02, E2E-01, E2E-03; AC-10 → API-07, E2E-04; AC-40 → UNIT-06, API-31; AC-14 → SEC-01; AC-41 → API-37, E2E-07.
Authorization is asserted only at the HTTP layer (SEC rows), never by UI visibility.

*Final status as recorded in `tests.md` §6* (a real, synchronous run on the Issue #74 integration work;
no test skipped, disabled or `.only`):

```
npm run test:server   27 files   591 / 591 passing   (unit + API + security + migration/regression)
npm run test:client   19 files   349 / 349 passing   (UI component + UI style)
npm run test:e2e                 210 / 210 passing   (Lab 2 regression + all Lab 3 specs: E2E, responsive, a11y, evidence)
planned IDs: 134 / 134 Pass
```

The visual checklist V-01…V-14 is reproduced in Answer Part 9.

*Run on `main`* (`6d66399`, merge of #pr(89)), `npm run test:all` after `npm install --prefix e2e`:

```
npm run test:server   27 files   591 / 591 passed
npm run test:client   19 files   349 / 349 passed
npm run test:e2e                 210 / 210 passed (3.5 min)
```

These match the totals recorded in `tests.md` §6.

= Answer Part 4

== AI use with reflection

*Link:* #doc("docs/lab-03/ai-use.md").

*LLM used.* Claude (Anthropic). *Claude Code* acted as orchestrator: it held the frozen contract, split each
Issue into small slices, wrote each brief, re-ran and verified every slice, ran sabotage audits and drove the
Git workflow. *Claude Sonnet* subagents were the implementers (one narrow slice each, never allowed to push,
open a PR or merge); mechanical test-file touch-ups went to *Claude Haiku*. The human engineer (`N0TAW00D`)
reviewed every output, decided every judgement call and responded to review; every merge was done by the
reviewer `Palapluem`. No model version numbers are claimed beyond "Claude / Sonnet / Haiku".

*Selected key prompts* (`ai-use.md`, 7 representative prompts, summarized and not verbatim):

#tbl((auto, 1fr, 1.2fr),
  [1 · #pr(75)], [Draft the four `docs/lab-03/` contract documents extending Lab 2's; every AC maps to a planned test with a real file path; minimal symmetric Issue dependency graph; self-audit for over-scope.], [Four documents + a self-audit that caught a dependency asymmetry and an over-scope leak; the reviewer re-derived the FR/BR/AC counts and contrast ratios.],
  [2 · #pr(76)], [Rename `RequesterUser` to `User`, add Session / comment / note models, hand-write migration SQL so Lab 2 rows survive, seed all three roles idempotently.], [Hand-edited migration and a `lower(email)` unique index; sabotage-audited, MIG-01..06 re-run 198/198.],
  [3 · all PRs], [For each slice break one specific guard (role check, 403 branch, page-reset …) and confirm exactly the matching test fails.], [60+ sabotage rounds, each re-run by the human rather than trusted.],
  [4 · #pr(80)], [Reviewer found no endpoint to list IT Staff for the Owner filter: decide amend-now vs. defer, draft the amendment.], [New contract §4.2 endpoint `GET /api/staff/assignable-users` with a traceability row; decision made by the human.],
  [5 · #pr(82)], [Fix sessions surviving deactivation and the last-Administrator race, each with a regression test.], [Session deletion on every deactivating PATCH; count + rows locked in one `$transaction` (`SELECT … FOR UPDATE`); both reverted individually to prove the new tests fail.],
  [6 · #74], [Write the responsive/screenshot spec (R-01..R-06) for all Lab 3 screens at three viewports.], [Exposed a real 188 px tablet overflow in the five-filter row; fix reverted and restored to prove the test.],
  [7 · #74], [Reconcile `tests.md` honestly: flip a row to Pass only if a real, non-trivial test matches its literal claim.], [111 of 120 initially verified, 9 left `Planned` with named gaps, 2 missing tests written from scratch; final 134 / 134.],
)

*My Reflection* (full text in `ai-use.md`). Lab 3 kept the controller/subagent split from Lab 2 and made
three things sharper. First, *decomposition had to go deeper than PR size*: handing one agent a whole Issue
filled its context with noise before I could trust its self-report; splitting an Issue into five or six small
dispatches made each output small enough to actually read, and kept the sabotage audits meaningful across
nine Issues. Second, *a green suite was still not an honest one*: `tests.md` was written entirely up front,
and reconciling its Status column needed the same skepticism as auditing an agent's "done" — several rows
claimed more than their test proved, two had never been picked up at all, and leaving nine rows honestly
`Planned` looked worse than a clean 120/120 but was accurate. Third, *the controller sometimes had to make a
call an agent rightly would not*: when the reviewer found the Owner filter had no staff endpoint, I amended
the frozen `api-spec.md` first and only then had it implemented. Agents build faithfully against whatever
contract they are given; deciding when the contract itself must change is where the human accountability lives.

= Answer Part 5

== Working login and password change UI

Evidence: `artifacts/lab-03/screenshots/submission/part-5-login/` (Playwright spec `e2e/lab-03/submission-evidence.spec.ts`, EV-01).

#crop("submission/part-5-login/01-valid-login-landing.png", 1280, 720, [1 — *Valid login*, and *authenticated user / role display*: the header shows the signed-in name and role badge on the role landing page.])
#crop("submission/part-5-login/02-invalid-credentials-safe-error.png", 1280, 720, [2 — *Invalid login*: a single generic, safe error (BR-08, AC-05).])
#crop("submission/part-5-login/03-inactive-account-safe-error.png", 1280, 720, [3 — *Inactive-account handling*: the same generic message as a wrong password, so account existence is not disclosed.])
#crop("submission/part-5-login/04-login-busy-submitting.png", 1280, 720, [4 — *Busy feedback*: Sign in shows the busy state and is disabled while the request is in flight.])
#crop("submission/part-5-login/05-forced-change-password-screen.png", 1280, 720, [5 — *Mandatory first-password change*: a user flagged `mustChangePassword` cannot reach the normal application.])
#crop("submission/part-5-login/06-password-rule-validation-error.png", 1280, 720, [6 — Password-rule validation (8–128 characters, must differ from the current password) shown directly under the field.])
#crop("submission/part-5-login/07-change-password-success-continuation.png", 1280, 720, [7 — Successful change continues into the application.])
#crop("submission/part-5-login/08-logout-returns-to-login.png", 1280, 720, [8 — *Logout* returns to the Login screen.])
#crop("submission/part-5-login/09-protected-url-after-logout-redirects-to-login.png", 1280, 720, [9 — *Direct access blocked after logout*: a typed protected URL redirects to Login (E2E-04, AC-10).])
*Safe failure feedback* for the server side of login is shown in 2–3 (generic error) and, for the queue and
detail screens, in Answer Parts 6–7.

= Answer Part 6

== Working IT Staff ticket queue UI

Evidence: `artifacts/lab-03/screenshots/submission/part-6-staff-queue/` (EV-02).

#crop("submission/part-6-staff-queue/01-realistic-queue-assigned-unassigned-badges.png", 1440, 1187, [1 — *Realistic queue data*: ticket number, summary, category, IT-priority badge, status badge, Owner (assigned name vs. the literal "Unassigned" token) and Last Updated; 13 tickets, "Showing 1–13 of 13".])
#crop("submission/part-6-staff-queue/02-search-applied.png", 1440, 900, [2 — *Search* by ticket number or summary.])
#crop("submission/part-6-staff-queue/03-filters-applied.png", 1440, 900, [3 — *Filters* (Status, IT Priority, Category, Owner) applied.])
#crop("submission/part-6-staff-queue/04-sorting-applied.png", 1440, 1187, [4 — *Sorting* applied (the Sort control and the active column indicator).], y1: 1000)
#crop("submission/part-6-staff-queue/05-pagination-page2.png", 1440, 900, [5 — *Pagination*, page 2.])
#crop("submission/part-6-staff-queue/06-open-detail-result.png", 1440, 1570, [6 — *Open-detail action*: following a ticket link lands on the IT Staff Ticket Detail screen.], y1: 1000)
#crop("submission/part-6-staff-queue/07-no-results-state.png", 1440, 900, [7 — *No-results* feedback for a query that matches nothing.])
#crop("submission/part-6-staff-queue/10-queue-truly-empty-state.png", 1440, 900, [8 — *Empty queue* state (a stubbed `GET /api/staff/tickets` returning no items), distinct from no-results.])
#crop("submission/part-6-staff-queue/08-api-failure-state.png", 1280, 720, [9 — *Failure* feedback with a retry affordance (stubbed API failure).])
#align(center)[
  #crop("submission/part-6-staff-queue/09-mobile-card-layout.png", 390, 3019, [10 — *Responsive behavior*: card layout below 768 px (top of the page; the full 390×3019 image is in the repository).], w: 7cm, y1: 1450)
]

= Answer Part 7

== Working IT Staff ticket detail UI

Evidence: `artifacts/lab-03/screenshots/submission/part-7-staff-detail/` (EV-03). Crops show the relevant region of
each 1440 px capture; the complete images are in the repository.

#crop("submission/part-7-staff-detail/01-claim.png", 1440, 1674, [1 — *Claim*: the unassigned ticket is claimed; the Ticket Owner control shows the claiming user and "Saved".], y1: 900)
#crop("submission/part-7-staff-detail/02-reassign.png", 1440, 1674, [2 — *Reassign*: Ticket Owner changed to another active IT Staff member ("Saved").], y1: 900)
#crop("submission/part-7-staff-detail/03-it-priority-change.png", 1440, 1674, [3 — *IT Priority* changed (Medium → High) via the segmented control; Requested Priority stays unchanged.], y1: 900)
#crop("submission/part-7-staff-detail/04-attachment-list-continuity.png", 1440, 1674, [4 — *Attachment continuity*: the Lab 2 attachment is listed and downloadable by IT Staff.], y1: 900)
#crop("submission/part-7-staff-detail/05-public-comment-posted.png", 1440, 1702, [5 — *Public Comment* posted and shown in the Comments thread (visible to the Requester).], y0: 900)
#crop("submission/part-7-staff-detail/06-internal-note-posted.png", 1440, 1730, [6 — *Internal Note* posted; the tan "Private — not visible to the Requester" panel is visually distinct from Comments.], y0: 900)
#crop("submission/part-7-staff-detail/07-validation-error-empty-comment.png", 1440, 1754, [7 — *Validation*: an empty comment is rejected with a message under the field.], y0: 900)
#crop("submission/part-7-staff-detail/08-safe-failure-routed-500.png", 1440, 1770, [8 — *Safe failure*: a routed 500 on posting shows "Could not post your message. Please check your connection and try again." and the typed text is kept (stubbed response).], y0: 900)
#crop("submission/part-7-staff-detail/09-status-change-confirmation-dialog.png", 1440, 1770, [9 — *Permitted status change*: the "Close this ticket?" confirmation dialog.], y0: 1040, y1: 1400)
#crop("submission/part-7-staff-detail/10-status-change-result.png", 1440, 1770, [10 — Status change applied and "Saved".], y1: 900)
#crop("submission/part-7-staff-detail/11-requester-resolved-indication-seen-by-staff.png", 1440, 1634, [11 — *Requester resolution indication* seen by staff: "The requester reported this looks resolved on 27 Sep, 22:19."], y1: 900)
#crop("submission/part-7-staff-detail/12-role-restriction-requester-view.png", 1440, 1266, [12 — *Role restriction*: the Requester's view of a ticket has no Ticket Operations card, no Internal notes panel and no owner controls; only Comments and "Problem appears resolved".])

*Direct API authorization evidence* (`artifacts/lab-03/screenshots/submission/part-7-staff-detail/api-authz-evidence.json`,
captured by EV-03): Internal Notes are refused to a caller who is not IT Staff or Administrator.

```
GET /api/tickets/55/notes
  no session  -> 401 {"error":"UNAUTHENTICATED","message":"Sign in to continue."}
  Requester   -> 404 {"error":"NOT_FOUND","message":"Ticket not found."}
```

The full HTTP-level authorization suite (SEC-01..SEC-09, `server/tests/lab-03/authorization.api.test.ts`) is listed in Answer Part 3.

= Answer Part 8

== Working Administrator user management UI

Evidence: `artifacts/lab-03/screenshots/submission/part-8-user-management/` (EV-04).

#crop("submission/part-8-user-management/01-list-name-email-role-status-edit.png", 1440, 1088, [1 — *User list* with Name, Email, Role, Status and an Edit action.])
#crop("submission/part-8-user-management/02-search-by-name.png", 1440, 900, [2 — *Search by name*.])
#crop("submission/part-8-user-management/03-search-by-email.png", 1440, 900, [3 — *Search by email*.])
#crop("submission/part-8-user-management/04-role-filter-applied.png", 1440, 900, [4 — *Role filter* applied.])
#crop("submission/part-8-user-management/06-create-user-dialog.png", 1440, 900, [5 — *Create user* dialog: one permitted role and an initial password.])
#crop("submission/part-8-user-management/07-create-user-success.png", 1440, 900, [6 — User created and shown in the list.])
#crop("submission/part-8-user-management/08-duplicate-email-error.png", 1440, 900, [7 — *Duplicate-email* validation (BR-09, case-insensitive).])
#crop("submission/part-8-user-management/09-invalid-input-validation.png", 1440, 900, [8 — *Invalid-input* validation messages under the fields.])
#crop("submission/part-8-user-management/10-edit-name-email-role-active.png", 1440, 900, [9 — *Edit* name, email, role and activation state.])
#crop("submission/part-8-user-management/11-set-new-initial-password.png", 1440, 900, [10 — *Set a new initial password*.])
#crop("submission/part-8-user-management/12-forced-change-password-after-admin-reset.png", 1280, 720, [11 — *Required password change at next login* after the administrator reset (E2E-10).])
#crop("submission/part-8-user-management/13-self-deactivation-blocked.png", 1440, 900, [12 — *Self-deactivation prevented* (AC-53).])
#crop("submission/part-8-user-management/14-last-active-administrator-blocked.png", 1440, 900, [13 — *Removing the last active Administrator prevented* (AC-54).])
#crop("submission/part-8-user-management/15-non-admin-forbidden.png", 1440, 900, [14 — *Forbidden access for non-Administrators* (a Requester on `/admin/users`, AC-55; the API refusal is covered by SEC tests).])
#crop("submission/part-8-user-management/16-safe-api-failure.png", 1280, 720, [15 — *Safe failure feedback* (stubbed API failure).])
#align(center)[
  #crop("submission/part-8-user-management/05-mobile-layout.png", 390, 844, [16 — *Responsive Zen Green presentation* on mobile (390 px). Desktop and tablet in Answer Part 9.], w: 6.5cm)
]

= Answer Part 9

== Zen Green UI and responsive evidence

*Rendered / linked:* #doc("docs/lab-03/ui-spec.md") — what changes from Lab 2 (§1), new colour tokens (§2),
badges (§3), application shell and role navigation (§4), Login, Change Password, Requester Ticket Detail
additions, comment/note threads, IT Staff Ticket Queue, IT Staff Ticket Detail and Administrator User
Management screens (§5–§11), responsive (§12), accessibility (§13), screen-mode summary (§14) and the visual
inspection checklist (§15).

*New Lab 3 colour tokens* (`ui-spec.md` §2, in `client/src/styles/theme.css`; Lab 2's Zen Green tokens are unchanged):

#tbl((auto, auto, 1fr),
  [*Token*], [*Value*], [*Use*],
  [`--zen-private-bg` / `-border` / `-text`], [`#F4F1E8` / `#C9BFA3` / `#6B5A2E`], [Internal Note surface, border and label — warm, deliberately not green],
  [`--zen-unassigned` / `-bg`], [`#7A5D2B` / `#FBF3E4`], [Unassigned owner token (5.55:1, AA)],
  [`--zen-role-bg` / `-text`], [`#ECF1FA` / `#3A3F58`], [Role badge, kept distinct from the OPEN status badge],
)

*Screen modes and role navigation* (`ui-spec.md` §4, §14): the shell shows only the signed-in role's
destinations — My Tickets / Create Ticket for Requester, Ticket Queue for IT Staff, User Management for
Administrator, none while unauthenticated; every screen renders initial, loading, success and failure states.

*Desktop / tablet / mobile screenshots* (`artifacts/lab-03/screenshots/{screen}/{desktop,tablet,mobile}.png`;
1440×900, 820×1180, 390×844 viewports; tall pages are cropped to their top here, full images are committed).

#let trio(screen, label, dh, th, mh, dpx, tpx, mpx) = block(breakable: false, {
  crop(screen + "/desktop.png", 1440, dpx, [#label — desktop], y1: dh)
  grid(columns: (1.5fr, 1fr), gutter: 8pt,
    crop(screen + "/tablet.png", 820, tpx, [tablet], w: 9.6cm, y1: th),
    crop(screen + "/mobile.png", 390, mpx, [mobile], w: 6.6cm, y1: mh))
})
#trio("authentication", "Login", 900, 1180, 844, 900, 1180, 844)
#trio("change-password", "Change Password", 900, 1180, 844, 900, 1180, 844)
#trio("staff-queue", "IT Staff Ticket Queue", 1000, 1180, 1100, 1539, 1580, 4103)
#trio("staff-ticket-detail", "IT Staff Ticket Detail", 900, 1180, 1000, 1696, 1811, 2283)
#trio("user-management", "Administrator User Management", 900, 1180, 1000, 1088, 1180, 2346)
#trio("requester-ticket-detail", "Requester Ticket Detail (Lab 3 additions)", 1000, 1180, 1000, 1294, 1413, 1843)
#trio("forbidden", "Forbidden state (Requester on `/staff/tickets`)", 900, 1180, 844, 900, 1180, 844)

*Completed visual checklist* (`ui-spec.md` §15; results from `tests.md` §4 — automated rows proven by S-01..S-06 /
R-01..R-06, the rest by direct inspection of all 21 committed screenshots):

#tbl((auto, 1fr, auto), aligns: (center + horizon, left, left + horizon),
  [*\#*], [*Check*], [*Result*],
  [V-01], [Every colour from a token; no hard-coded hex outside `theme.css`], [Pass — S-01],
  [V-02], [New screens visually of a piece with Lab 2 (card, spacing, type scale)], [Pass — inspected],
  [V-03], [Nav shows only the authenticated role's destinations], [Pass — inspected],
  [V-04], [Status, Requested/IT Priority and Role badges consistent everywhere], [Pass — S-02],
  [V-05], [IT Priority never mistakable for Requested Priority], [Pass — S-03],
  [V-06], [Editable fields distinct from read-only on Staff Ticket Detail], [Pass — S-04 + inspected],
  [V-07], [Internal Notes unmistakably distinct from Public Comments], [Pass — S-06 + inspected],
  [V-08], [Validation messages directly below their field], [Pass — S-05],
  [V-09], [Focus visible on every interactive element], [Pass — R-05],
  [V-10], [No clipping, overlap or hidden primary action], [Pass — R-01..R-03c; two clipping bugs found in review of #pr(83)/#pr(84) and fixed],
  [V-11], [No horizontal page scroll], [Pass — R-01 at 390 / 820 / 1440 px],
  [V-12], [Empty, no-results, forbidden, not-found, conflict and failure states distinct], [Pass — C-09, C-11, C-15, E2E-12],
  [V-13], ["Unassigned" distinguishable without colour], [Pass — C-10 + inspected],
  [V-14], [Dialogs usable at mobile width and restore focus], [Pass — R-04],
)

_Note (V-11):_ the project's three-tier viewport matrix (390 / 820 / 1440, `tests.md` §1.5) is used instead of the
handout's four raw breakpoints; 991 / 992 / 1024 / 1079 / 1080 px boundaries are additionally asserted in R-02 / R-03b
(see `tests.md` §4 and §7).
