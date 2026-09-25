# Lab 3 — Peer Review Record

Part 1 deliverable (`specification.md` §14 Part 1). Every Lab 3 change reaches `lab3-staging`
through a peer-reviewed pull request, and `lab3-staging` reaches `main` through one peer-reviewed
release PR — there are no direct commits to `main` or `lab3-staging`.

Current through PR #83 (Issue #74). The release PR (`lab3-staging` → `main`) is the only PR still
open at the time of writing — it is not yet reviewed, so its row and any review findings on it will
be appended once that review completes, the same way Lab 2's `reviewer.md` (PR #57) was itself
revised after its own review.

## 1. Reviewer identity

| Role | GitHub | Notes |
|---|---|---|
| Author | `N0TAW00D` | Authored every Lab 3 pull request (#75–#83). Real name: Natthawat Primsirikunawut. |
| Reviewer | `Palapluem` | Reviewed and merged every Lab 3 pull request. Real name: Wisit Suwannao. |
| Third collaborator | `THN4` | Real name: Thanatip Nitinantakul. Not a reviewer on Lab 3, matching Lab 2 (see `docs/lab-02/reviewer.md`). |

## 2. Pull requests and outcomes

All PRs target `lab3-staging` unless noted. "Rounds" counts review submissions by the reviewer (an
approval on the first pass is 1); a substantive `COMMENTED` review that raised a real finding before
an `APPROVED` follow-up counts the same as a `CHANGES_REQUESTED` round, per the same convention
Lab 2's record uses.

| PR | Title | Review outcome | Rounds |
|---|---|---|---|
| [#75](https://github.com/N0TAW00D/TokTickIT/pull/75) | Lab 3 specification, API spec, UI spec and test plan (#66) | Commented (1 real finding) → approved | 2 |
| [#76](https://github.com/N0TAW00D/TokTickIT/pull/76) | User model, Lab 2 migration & Lab 3 seed data (#67) | Commented (1 finding) → approved | 2 |
| [#77](https://github.com/N0TAW00D/TokTickIT/pull/77) | Authentication foundation — login/logout/me/change-password (#68) | **Changes requested** → approved | 2 |
| [#78](https://github.com/N0TAW00D/TokTickIT/pull/78) | Role-based authorization & role-aware shell (#69) | **Changes requested** → approved | 2 |
| [#79](https://github.com/N0TAW00D/TokTickIT/pull/79) | Requester regression, Public Comments & Problem Appears Resolved (#70) | **Changes requested** → approved | 2 |
| [#80](https://github.com/N0TAW00D/TokTickIT/pull/80) | IT Staff Ticket Queue — queue API & responsive UI (#71) | **Changes requested** → approved | 2 |
| [#81](https://github.com/N0TAW00D/TokTickIT/pull/81) | IT Staff Ticket Detail — ownership, priority, status & notes (#72) | **Changes requested** ×3 → approved | 4 |
| [#82](https://github.com/N0TAW00D/TokTickIT/pull/82) | Administrator User Management (#73) | **Changes requested** → approved | 2 |
| [#83](https://github.com/N0TAW00D/TokTickIT/pull/83) | E2E, responsive/visual inspection & release integration (#74) | **Changes requested** ×2 → approved | 3 |
| release PR | `lab3-staging` → `main` | _pending_ | — |

Notes:
- Every Lab 3 PR to date was approved and merged by `Palapluem`; none were closed unmerged (unlike
  Lab 2's #45/#55).
- #75 and #76's first review rounds were formally `COMMENTED`, not `CHANGES_REQUESTED`, but each
  raised a real, substantive finding that was fixed before the approving round — counted as a full
  round here rather than folded into "approved first pass", matching how Lab 2's record treats
  #38–#40.

## 3. Substantive review findings and responses

### #75 — Commented: BR-37's Lab 2 repeal list vs. `api-spec.md` §9

> One real snag: api-spec.md §9 says deleting `GET /api/requesters` "Repeals L2-BR-35", but
> specification.md §7.4 item 8 / BR-37's repeal list only names L2-BR-08/09/10/11/13/38 — BR-35
> isn't on it, and BR-37 says every other Lab 2 rule stays in force. Checked your Lab 2 spec too —
> BR-35 actually covers categories and related-systems as well, not just requesters, so even
> "repealed" isn't quite right for the whole rule.

**Response.** Accepted. This was the same class of citation-precision issue Lab 2's #26 review
raised — checked against the actual frozen document rather than assumed correct. The `api-spec.md`
§9 line was corrected to describe the real, narrower effect (the requester-selection *portion* of
L2-BR-35 no longer applies; the rule's category/related-system scope is untouched and stays in
force), reconciled against BR-37's own repeal list rather than adding BR-35 to it. Fixed before the
contract froze, so no later PR ever cited the wrong version.

### #76 — Commented: `DevPassword123!` vs. Issue #67's "no password value readable" criterion

> Before I approve, could you reconcile Issue #67's "no password value readable in the repository"
> criterion? This PR exposes `DevPassword123!` in `seedConstants.ts`, the migration SQL, and README.

**Response.** Accepted as a documentation gap, not a code defect — resolved by pointing at the
actual frozen contract rather than changing the credential. `specification.md`'s AC-58 explicitly
allows exactly one documented local-development-only credential that grants access to no
non-local system; the Issue body's paraphrase was narrower than the AC it summarized. The PR reply
quoted AC-58 verbatim alongside a fresh test-output re-run (the reviewer had also noted GitHub
reported no checks). Lesson carried forward through the rest of the sprint: an Issue body is a
paraphrase, not the contract — `specification.md`'s AC/BR text is authoritative when the two seem
to disagree.

### #77 — Changes requested: malformed cookie crash and a trapped forced-password-change user

> `session.ts:74`: safely handle malformed percent-encoded cookies and return the standard
> unauthenticated response instead of throwing. `ChangePasswordScreen.tsx:318`: forced mode
> currently removes the UserBadge and gives the user no Logout action.

**Response.** Both accepted and fixed. `readSessionCookie` now catches a `decodeURIComponent`
failure and returns `null` (surfacing as the normal 401 every other absent-session case gets,
per `api-spec.md` §1.2, rather than a 500) instead of throwing uncaught. Forced Change Password
mode gained a standalone Logout button reusing `UserBadge`'s exact logout pattern, so a user stuck
on a forced change is never without an escape route. Both fixes were sabotage-verified (revert →
confirm the matching regression test fails → restore) before pushing.

### #78 — Changes requested: forbidden-route test didn't actually prove no request was sent

> The AC-18/C-09 test only checks that the stand-in screen's `onMount` callback was not called. It
> does not intercept fetch, so the test could still pass if the forbidden screen issued a protected
> API request. Please add a fetch spy/interceptor.

**Response.** Accepted — a real gap in what the test actually proved, not just a style note. The
test was reworked to intercept `fetch` directly and assert zero calls to the protected route while
the forbidden state renders, rather than trusting a component-level mount callback as a proxy for
"no request was made." The `tests.md` C-09 file-column reference was also corrected to point at
`RequireRole.test.tsx`, where the coverage actually lives.

### #79 — Changes requested: two write routes missing the 415 Content-Type gate

> Please apply the same `requireJsonContentType` gate to `POST /api/tickets` and
> `DELETE /api/attachments/:id` … Lab 3 `api-spec.md` §1.6 / BR-40 requires every state-changing
> endpoint to return 415 for text/plain or missing Content-Type. The current `isPlainRequestBody`
> path returns 400 MALFORMED_BODY instead.

**Response.** Accepted — and the underlying inconsistency had already been flagged by the
implementing agent in a `tickets.ts` comment but left unfixed as out of the slice's declared scope.
Fixed directly (mechanical, matched the identical gate already used on the comment/resolution
routes elsewhere in the same file) rather than dispatched to an agent: mounted
`requireJsonContentType` ahead of `authenticate` on both routes (BR-40's CSRF rationale doesn't
depend on session state), confirmed the multer multipart upload route stays exempt as the reviewer
expected, updated the two tests that previously expected 400 to expect 415, and added four new
regression tests (missing Content-Type, wrong Content-Type, and pre-auth rejection on each route).
Sabotage-verified by reverting the gate on both routes: exactly those six assertions failed.

### #80 — Changes requested: Owner filter missing an option for each active IT Staff member

> The UI currently offers only Anyone, Unassigned, and Me … while the contract requires an option
> for each active IT Staff member. The server already supports `owner=<id>`, but the UI currently
> provides no way to select those staff IDs.

**Response.** Accepted as a real, previously-undiscovered contract gap: no IT-Staff-callable
endpoint existed to list staff at all (`GET /api/users` is Administrator-only). Rather than build
around the gap, the frozen `api-spec.md` was amended first — `GET /api/staff/assignable-users`
added to §4.2 (IT Staff only, returns active `IT_STAFF`+`ADMINISTRATOR` users as
`{id, name, role}`, infrastructure for the already-existing FR-19/BR-19/AC-35, no new AC minted) —
since amending a frozen contract is a controller-level decision, not something to leave to an
implementation agent. The endpoint and its tests were then implemented, and the Owner filter wired
to it (client-side restricted to `IT_STAFF` options per `ui-spec.md` §9's literal wording, even
though the endpoint itself returns both roles for Issue #72's later reuse as a ticket-owner
picker). One lower-severity gap was found and disclosed rather than silently fixed: the reviewer's
own targeted audit surfaced a missing 403 test for an Administrator calling the new endpoint,
fixed with one additional test; the client-side role filter itself has no regression test proving
`ADMINISTRATOR` rows stay excluded from the dropdown, accepted and disclosed in the PR reply as
cosmetic-only (the server independently validates `ownerId` on the real assignment endpoint).

### #81 — Changes requested ×3: attachment access, route scope, focus, layout, then four more rounds of findings

**Round 1** (commit `e65c1dd`) — two blocking findings: (1) `GET /api/attachments/:id/download`
still required Requester ownership, so IT Staff/Administrator always got 403 despite Staff Ticket
Detail rendering Download/Preview; (2) Administrator was wrongly admitted to
`/staff/tickets/:id`, contradicting the specification's API-level-only Administrator ticket
access. Two additional non-blocking findings: focus not restored after the status-confirm dialog,
and no two-column desktop layout.

**Response.** All four accepted and fixed: the download route's ownership check now recognizes
staff/admin access via the same `resolveTicketAccess` helper the rest of the sprint uses; the
staff detail route guard changed to `IT_STAFF`-only; focus restoration added to
`ConfirmStatusChangeDialog`; the two-column desktop grid layout implemented.

**Round 2** (commit `6eccccf`) — the four round-1 findings confirmed fixed (server 448/448, client
284/284, both independently re-run by the reviewer), plus four new findings: an int4-overflow
`ownerId` produced a 500 instead of `409 INVALID_OWNER`; `.thread--internal` was missing its
required private background/border tokens; the Internal Notes region had no `aria-label`; the
status-confirm dialog had no tablet/mobile responsive layout.

**Response.** All four accepted and fixed, each with a regression test: the owner-ID param parser
gained the same `PG_INT4_MAX` guard pattern already used elsewhere in the sprint; the private-token
CSS rule added; the `aria-label` added to the Internal Notes region; tablet full-width and mobile
full-screen layouts added to the confirm dialog.

**Round 3** (commit `97f3664`) — the four round-2 findings confirmed fixed (server 449/449, client
284/284), one new finding: the Internal Notes privacy badge used `--zen-warning` instead of the
`ui-spec.md` §8-required `--zen-private-text` token, plus a request for the missing regression
coverage on the round-2 fixes.

**Response.** Accepted; the badge's color rule switched to an internal-variant-specific override
using `--zen-private-text`, and the missing regression coverage (aria-label, private-token
contract, tablet/mobile dialog layout) was added. Approved on the fourth round.

### #82 — Changes requested: sessions not dropped on deactivation, unprotected LAST_ADMIN race

> 1. Deactivating a user does not remove all existing sessions. An unpresented session may remain
> stored and become usable again after the account is reactivated. This does not fully satisfy
> BR-12. 2. The `LAST_ADMIN` count-and-update sequence is not protected against concurrent
> requests. Two administrators could be demoted or deactivated concurrently, leaving the system
> with no active administrator.

**Response.** Both accepted as genuine correctness/security defects, both fixed with a regression
test proving the race each guards against. (1) `PATCH /api/users/:id` now deletes the target
user's existing sessions whenever the request deactivates them, not only on the separate
initial-password-reset path that already did this. (2) The active-Administrator count and the
row(s) being changed are now locked and evaluated inside one `prisma.$transaction`
(`SELECT … FOR UPDATE` on the active-Administrator rows before the count), closing the
check-then-act window a concurrent second request could otherwise race through.

### #83 — Changes requested ×2: nine Planned tests, login redirect bypass, E2E-08 continuity, V-10 clipping, e2e `tsc` gap, then a missed 992px breakpoint

**Round 1** (submitted 2026-09-22, reviewing commit `3ee14a5`) — reviewer verified server 507/507,
client 349/349 (three consecutive runs), E2E 131/131, and a clean client build / server type-check
locally, then raised five blocking findings before treating the PR as the completed Lab 3 release:

> 1. docs/lab-03/tests.md still contains 9 Planned rows, so the final matrix is 111/120 rather than
> 120/120, while Issue #74 requires the full suite to pass. 2. IT Staff and Administrator login
> flows bypass the real post-login landing with direct page.goto calls. The normal login currently
> redirects to the Requester-only /tickets route. 3. E2E-08 uploads a new attachment during the
> test, so it does not prove continuity of an existing Lab 2 attachment after migration. 4. V-10 is
> marked Pass despite the documented Ticket No./Requester clipping. 5. A clean e2e install cannot
> pass npx tsc --noEmit because @types/node and @types/pg are not declared.

**Response.** All five accepted and fixed, not just reworded. (1) The nine `Planned` rows were each
backfilled with real, exhaustive coverage matching their own literal claim (e.g. API-16 now covers
all 21 real `passwordChangeGate`-mounted routes × exempt paths across all 3 roles; SEC-01 now
verifies "no write" with a real DB read after the 401, not just the status code), closing
`tests.md` to 120/120 (server 591/591, client 349/349, e2e 131/131). (2) The root redirect bug was
real, not just a test workaround: `/` unconditionally `Navigate`d to `/tickets` (Requester-only),
so any non-Requester login landed on the forbidden state instead of `ui-spec.md` §5's required
role-landing redirect — fixed with a new `RoleLandingRedirect` reusing `AppShell.tsx`'s existing
nav-link source of truth. (3) Added `seedPreExistingAttachment`, which writes real bytes to
`server/uploads/` and inserts the Attachment row via direct SQL before either E2E-08 session logs
in, so the attachment genuinely pre-dates the test's own actions; sabotage-verified by temporarily
restricting the download route back to Requester-only. (4) The Ticket No./Requester clipping (and
an IT Priority "High" label clipping found while fixing it) was a real `.zen-staff-detail__grid`
column-width bug, corrected by re-weighting the column ratios rather than re-disclosing the same
Pass. (5) `@types/node` and `@types/pg` were added to `e2e/package.json`, pinned to the versions
`server/package.json` already uses, and verified clean on a fresh `rm -rf node_modules && npm
install`. Also disclosed, unprompted: `prisma/seed.ts`'s `upsertUser()` doesn't reset
`passwordHash`/`mustChangePassword` on an update path, flagged as a possible follow-up issue rather
than a release blocker.

**Round 2** (submitted 2026-09-24, reviewing commit `dc7f892`) — the five round-1 findings accepted
as addressed; one new finding, left as an inline comment on `StaffTicketQueueScreen.css`:

> At 992px, this rule enables min-width: max-content for the filter row (about 967px, according to
> the CSS comment), but .zen-app-shell__content is only 992px wide including its 24px desktop
> gutters, leaving 944px for content before the controls panel's own padding. The filter row can
> therefore exceed its available space, while body hides horizontal overflow. The current R-01
> viewport checks at 390/820/1440px miss this 992px breakpoint. Please keep the filters wrapping
> until they fit, or use a container-aware rule, and add assertions at 991px and 992px that all
> five filters remain visible within the panel and the page has no horizontal overflow.

**Response.** Accepted. The controls panel at 992px has 992 − 48 (gutters) − 2 (border) − 32
(padding) = 910px available, less than the ~967px unwrapped filter row, so the single-line rule's
old `min-width: 992px` breakpoint was moved up to **1080px** (fits from ~1049px; ~30px headroom);
below it the filters wrap inside the panel. New R-02 cases at 991, 992, 1079 and 1080px assert all
five filters stay visible and fully inside the controls panel with no document horizontal overflow;
sabotage-checked against the old 992px rule (the 992px case fails, right edge 1008px vs. panel
limit 968.5px; the other three pass). Full e2e re-run: 135/135; `tests.md` updated (R-02 row, e2e
count 135).

**Round 3** (submitted 2026-09-24, reviewing commit `3d4f32b`) — the 992px finding confirmed fixed;
approved and merged. Reviewer's own words: "The 992px overflow finding is addressed: the
single-line filter rule now starts at 1080px, and R-02 adds boundary coverage at 991, 992, 1079,
and 1080px to keep all five filters inside the panel without document overflow. … I found no
remaining issue in the requested change and approved it."

## 4. Corrections issued by the author

No claim made to the reviewer during Lab 3 has needed retraction so far (unlike Lab 2's #32/#33/#44
— see `docs/lab-02/reviewer.md` §4). This section will be updated if that changes on the release
PR.

## 5. Direction of review

Every Lab 3 pull request (#75–#83, and the release PR once opened) is authored by
`N0TAW00D` and reviewed by `Palapluem`. Review within Lab 3 therefore flows in one direction, the
same as Lab 2 (see `docs/lab-02/reviewer.md` §5): this record holds the comments the author
**received** and the author's **responses**, not comments given by the author on a teammate's PR.
