# Lab 2 — Peer Review Record

Part 2 deliverable (`specification.md` §10.2). Every Lab 2 change reached `lab2-staging`
through a peer-reviewed pull request; there were no direct commits to `main` or
`lab2-staging`.

> **Draft — not final.** Current through **PR #59**. PRs #21–#53 are merged; #54, #56–#59 are
> open at the time of writing (#45 and #55 closed). Sections 2 and 3 track the open PRs' latest
> state; both, and §5, need a final pass once the remaining PRs and the release PR merge and the
> author's reflection is settled with the team.

## 1. Reviewer identity

| Role | GitHub | Notes |
|---|---|---|
| Author | `N0TAW00D` | Authored every Lab 2 pull request (#21–#59). Real name: Natthawat Primsirikunawut. |
| Reviewer | `Palapluem` | Reviewed the Lab 2 pull requests and merged them; the exceptions are #45 (closed, superseded by #50) and #55 (closed without review as out of scope). Real name: Wisit Suwannao. |
| Third collaborator | `THN4` | Real name: Thanatip Nitinantakul. Reviewed in Lab 1 (#5–#12); not a reviewer on Lab 2. |

## 2. Pull requests and outcomes

All PRs target `lab2-staging` unless noted. "Rounds" counts review submissions by the
reviewer (an approval on the first pass is 1).

| PR | Title | Review outcome | Rounds |
|---|---|---|---|
| [#21](https://github.com/N0TAW00D/TokTickIT/pull/21) | Sprint specification, API, UI and test-plan contract | Approved | 13 |
| [#22](https://github.com/N0TAW00D/TokTickIT/pull/22) | Database schema, idempotent seed & test database (#14) | Approved | 5 |
| [#23](https://github.com/N0TAW00D/TokTickIT/pull/23) | Zen Green theme tokens & reusable components (#15, 1/3) | Approved | 7 |
| [#24](https://github.com/N0TAW00D/TokTickIT/pull/24) | Requesters endpoint & `X-Requester-Id` middleware (#15, 2/3) | Approved first pass | 1 |
| [#25](https://github.com/N0TAW00D/TokTickIT/pull/25) | Requester selection, app shell & client routing (#15, 3/3) | **Changes requested** → approved | 2 |
| [#26](https://github.com/N0TAW00D/TokTickIT/pull/26) | Reference-data endpoints & categories conformance (#16, 1/4) | Approved | 2 |
| [#27](https://github.com/N0TAW00D/TokTickIT/pull/27) | Ticket Number generation & field validators (#16, 2/4) | Approved first pass | 1 |
| [#28](https://github.com/N0TAW00D/TokTickIT/pull/28) | `POST /api/tickets` with atomic Ticket Number allocation (#16, 3/4) | Approved first pass | 1 |
| [#29](https://github.com/N0TAW00D/TokTickIT/pull/29) | Create Ticket form with validation and submit states (#16, 4/4) | Approved | 3 |
| [#30](https://github.com/N0TAW00D/TokTickIT/pull/30) | My Tickets list API — scoping, filters, sort, pagination (#18) | Approved | 2 |
| [#31](https://github.com/N0TAW00D/TokTickIT/pull/31) | Attachment upload — type, size & storage safety (#17, 1/2) | **Changes requested** → approved | 3 |
| [#32](https://github.com/N0TAW00D/TokTickIT/pull/32) | Attachment metadata, download & soft removal (#17, 2/2) | Approved | 2 |
| [#33](https://github.com/N0TAW00D/TokTickIT/pull/33) | Ticket Detail API with ownership & attachment listing (#19) | Approved first pass | 1 |
| [#34](https://github.com/N0TAW00D/TokTickIT/pull/34) | Fix intermittent suite failures from supertest ephemeral servers | Approved first pass | 1 |
| [#35](https://github.com/N0TAW00D/TokTickIT/pull/35) | Priority and Status badge components (#18/#19) | Approved first pass | 1 |
| [#36](https://github.com/N0TAW00D/TokTickIT/pull/36) | My Tickets list — fetch, responsive table/cards, states (#18, client 1/2) | Approved first pass | 1 |
| [#37](https://github.com/N0TAW00D/TokTickIT/pull/37) | My Tickets controls — search, filters, sort & clear (#18, client 2/3) | Approved first pass | 1 |
| [#38](https://github.com/N0TAW00D/TokTickIT/pull/38) | My Tickets pagination & empty/no-results/over-page states (#18, client 3/3) | Commented (2 blocking findings) → fixed, merged | 1 |
| [#39](https://github.com/N0TAW00D/TokTickIT/pull/39) | Requester Ticket Detail read-only view (#19, client slice) | Commented (1 blocking finding) → fixed, merged | 1 |
| [#40](https://github.com/N0TAW00D/TokTickIT/pull/40) | Shared AttachmentUploader & Create Ticket attachment flow (#17, client 1/3) | Commented (2 inline findings) → fixed, merged | 1 |
| [#41](https://github.com/N0TAW00D/TokTickIT/pull/41) | Badge consistency & icon-only control labelling (S-06, S-07) | Approved first pass | 1 |
| [#42](https://github.com/N0TAW00D/TokTickIT/pull/42) | Playwright E2E harness, dedicated E2E database & root `test:all` (#20, 1) | **Changes requested** ×2 (E2E determinism; then npm-toolchain reproducibility) → approved | 3 |
| [#43](https://github.com/N0TAW00D/TokTickIT/pull/43) | Record verified test results in `tests.md` Final column (#20) | Approved first pass (reviewer asked for a later refresh) | 1 |
| [#44](https://github.com/N0TAW00D/TokTickIT/pull/44) | Responsive checks R-01..R-06 and screenshot evidence (#20, 2) — base `feat/20a-e2e-harness` | **Changes requested** → approved, **then merged into `feat/20a-e2e-harness` by mistake** — content stranded, re-landed as #48 | 2 |
| [#45](https://github.com/N0TAW00D/TokTickIT/pull/45) | Submission evidence captures for Answer Parts 6 and 7 (#20, 3) — base `feat/20b-screenshots` | **Changes requested** → **CLOSED**, superseded by #50 | 1 |
| [#46](https://github.com/N0TAW00D/TokTickIT/pull/46) | Attachment list on Ticket Detail (#17, client 2/3) | Approved first pass | 1 |
| [#47](https://github.com/N0TAW00D/TokTickIT/pull/47) | Remove attachment confirmation dialog (#17, client 3/4) — base `feat/14a-attachment-list` | **Changes requested** (inert Download/Preview; no Add-Attachment control) → PR re-scoped to C-18/C-19 with a 14d follow-up → approved | 2 |
| [#48](https://github.com/N0TAW00D/TokTickIT/pull/48) | Responsive checks R-01..R-06 and screenshot evidence — **re-land of #44's reviewed commits** onto `lab2-staging` | Approved first pass | 1 |
| [#49](https://github.com/N0TAW00D/TokTickIT/pull/49) | E2E-04 / E2E-05: create-failure input preservation & empty vs no-results (#20) | Approved first pass | 1 |
| [#50](https://github.com/N0TAW00D/TokTickIT/pull/50) | Submission evidence for Answer Parts 6 & 7 — self-contained fixtures + Demo 4 (#20) — **supersedes #45** | Approved first pass | 1 |
| [#51](https://github.com/N0TAW00D/TokTickIT/pull/51) | Attachment download, image preview & Add Attachment on Ticket Detail (#17, client 4/4 — slice 14d) | Approved first pass | 1 |
| [#52](https://github.com/N0TAW00D/TokTickIT/pull/52) | Refresh `tests.md` Final column after the #40–#49 merges (#20) | Approved first pass (reviewer noted a further refresh is still due) | 1 |
| [#53](https://github.com/N0TAW00D/TokTickIT/pull/53) | E2E-03 cross-requester isolation spec (#20) | **Changes requested** (passed only in one execution order) → reworked (E2E-04's check made a before/after delta) → approved, merged | 2 |
| [#54](https://github.com/N0TAW00D/TokTickIT/pull/54) | E2E-01 full attachment journey & E2E-02 failure / soft-removal (#20) | **Changes requested** (E2E-02's "Upload failed — retry" affordance not implemented) → fix in #59 | 1+ |
| [#55](https://github.com/N0TAW00D/TokTickIT/pull/55) | Add `@types/node` and `@types/pg` to the `e2e/` workspace (#20) | **Closed** without review — workspace hygiene only, not on any rubric path | — |
| [#56](https://github.com/N0TAW00D/TokTickIT/pull/56) | Answer Part 8 evidence: Ticket Detail & attachment lifecycle (#20) | Approved first pass | 1 |
| [#57](https://github.com/N0TAW00D/TokTickIT/pull/57) | Add `docs/lab-02/reviewer.md` and `ai-use.md` (this record) (#20) | **Changes requested** (stale outcomes; reflection still a TODO) → updating | 1+ |
| [#58](https://github.com/N0TAW00D/TokTickIT/pull/58) | Refresh README e2e section and root `.gitignore` (#20) | **Changes requested** (README implied unmerged specs were on staging) → reworded | 1+ |
| [#59](https://github.com/N0TAW00D/TokTickIT/pull/59) | Ticket Detail "Upload failed — retry" row with Retry and Dismiss (#17) — the affordance #54's E2E-02 needs | Review pending | — |

Notes:
- **Formal `Changes requested` vs `Commented`.** Only #25, #31, #42, #44, #45, #47 and #53 carry a
  formal `CHANGES_REQUESTED` review event. #38, #39 and #40 were `COMMENTED` reviews that
  nonetheless carried blocking findings; the author fixed them and Palapluem merged on his judgment
  as merger (posting a plain "Approved." / "LGTM" comment, not a second formal review). The table
  above describes what the review events actually say, not a uniform "changes requested → approved".
- #33 was based on `feat/9b-attachment-lifecycle` rather than `lab2-staging`, so it reached the
  integration branch when #32 merged. #47 was based on `feat/14a-attachment-list` (#46) and
  auto-retargeted to `lab2-staging` when #46 merged.
- **#44 merge error.** #44 was approved but merged into its own base `feat/20a-e2e-harness`, which
  had already delivered that base's content to `lab2-staging` via #42 minutes earlier. R-01..R-06
  and the responsive screenshots were therefore stranded and never reached the integration branch.
  The fix was a fresh PR, **#48**, carrying #44's reviewed commits rebased onto `lab2-staging` plus
  one screenshot regeneration; #48 was reviewed and merged normally.
- **#45 → #50.** Force-pushing the `feat/20c-submission-evidence` branch was not possible in the
  working environment, so the rebased-and-fixed work was pushed to a new branch and opened as #50;
  #45 was closed as superseded.
- Issue #20 (E2E / responsive / visual) was delivered as a stack — #42 → #44/#48 → #45/#50, plus
  the independent #43, #49, #52, #53, #54, #55. Palapluem merges each stack bottom-up.

## 3. Substantive review findings and responses

### #25 — Changes requested (3 points)

> Keep the Lab 1 screen reachable at `/system-check` […] change `toktickit.requesterId` from
> `localStorage` to `sessionStorage` per specification §11.20 […] restyle the Lab 1 screen
> without Bootstrap `btn-primary` as required by STY-003.

**Response.** The routing point was accepted and fixed — the Lab 1 screen was relocated to
`/system-check` with its test kept green. The other two were **contested with evidence**:
this repository's `specification.md` has no §11.20 and no `STY-003`; both citations came
from a different team's contract. The reviewer verified this and withdrew them:

> You're right — my previous review used the contract from our repository instead of your
> repository's current contract.

### #31 — Changes requested (2 points)

> the active attachment limit must be enforced safely for concurrent uploads, with a
> regression test, and the temporary upload directory should be cleared in `afterEach`.

**Response.** Both accepted and fixed. The BR-23 limit check was made atomic with a
`SELECT … FOR UPDATE` row lock plus a regression test proving the race; the temp uploads
directory is now cleared in `afterEach`, not only `afterAll`.

### #26 — Ordering of `GET /api/categories`

The reviewer initially read the endpoint as mis-ordered. Re-checked against this
repository's `api-spec.md` §2.1 and `tests.md` API-01, which specify ordering by `id`;
no change was needed and the point was withdrawn.

### #29 — `VALIDATION_FAILED.fields[]` dropped by the client

Accepted. The client discarded the server's per-field errors and showed a generic message.
Fixed by raising a typed error carrying `fields[]` and mapping each entry onto the matching
form field, with focus moved to the first invalid one.

### #30 — Blank query parameters silently defaulted

Accepted, and the underlying reasoning was wrong, not just the code: `?page=`, `?pageSize=`
and `?priority=` were being treated as omitted. Only blank `search` is ignored (BR-16);
every other blank parameter must be a `400`, per FR-29. Fixed and re-verified.

### #32 — `Content-Disposition` filename not escaped

Accepted. A filename containing `"` produced a malformed header, and one containing CR/LF
produced a **500**. Fixed with RFC 6266 / RFC 5987 encoding. Auditing that fix surfaced a
second, unreported bug: multer's default `latin1` parameter charset was corrupting non-ASCII
filenames on the way in (`résumé.pdf` stored as `rÃ©sumÃ©.pdf`). The existing test asserted
only that the header was well-formed, never that the name was correct, so it passed over
real data corruption; it was replaced with an exact round-trip assertion against the
persisted row.

### #38 — Changes requested (2 points): pagination

> Avoid resetting the page from the initial debounce […] Treat whitespace-only search as
> inactive.

**Response.** Both accepted and fixed. (1) The search debounce ran its `setPage(1)` on the
mount tick even with an empty box, so paginating within 300 ms of mount bounced the user
back to page 1 — this also explained an intermittent test failure. The debounce now tracks
the last committed normalized search in a ref and only resets the page when that value
actually changes. (2) `hasActiveQuery` tested `debouncedSearch !== ""` while `api.ts` trims
per BR-16, so a whitespace-only search classified as no-results instead of the required
empty state; fixed to test the trimmed value. Both sabotaged in both directions during the
audit (a guard that never fires is as wrong as one that always fires).

### #39 — Changes requested: Ticket Date not in Asia/Bangkok time

> The API returns UTC timestamps, while BR-04/A-11 require the client to display Ticket Date
> in Asia/Bangkok time.

**Response.** Accepted; the defect was wider than the report. `TicketDetailScreen` rolled
its own `getUTC*()` formatter and never imported the already-merged
`client/src/tickets/formatDateTime.ts`. Removing the duplicate exposed that the shared
helper was **also** wrong — `en-GB` renders September as "Sept", which no contractual
format uses. The formatter now derives parts via `Intl.DateTimeFormat(…, { timeZone:
"Asia/Bangkok" })` plus a 3-letter month table (never a hand-rolled +7 h), and exports both
`formatDateTime` (`1 Sep, 09:14`) and `formatDateTimeWithYear` (`1 Sep 2026, 15:14`) for the
two contractual formats. A companion smell was fixed too: `MyTickets.test.tsx` built its
expected strings by calling `formatDateTime` itself, so it passed however wrong the helper
was; expectations are now hardcoded, including a case that crosses midnight and the year.

### #40 — Changes requested (2 points): attachment validation & warning role

> validate the attachment extension, not just the MIME type […] use `role="note"` for the
> partial-upload warning callout.

**Response.** Both accepted and fixed. The `accept=".jpg,…"` attribute is a file-picker
hint only — it does not constrain drag-and-drop or a programmatic `File`, so `virus.exe`
carrying `image/png` was queued; a case-insensitive extension allowlist was added. The
warning callout used `role="alert"`; ui-spec.md §5.4 assigns Warning → `role="note"`
(`role="alert"` is for errors only). Auditing the extension fix surfaced **gate shadowing**:
every pre-existing MIME fixture also fails the new extension check, so it short-circuited
ahead of them and the MIME gate went untested — the mirror case (allowed extension, banned
MIME) was added so both gates are independently guarded.

### #42 — Changes requested ×2: E2E determinism, then toolchain reproducibility

**Round 1** — "prevent stale local servers from being reused, reset
Ticket/Attachment/TicketCounter between runs, use a reproducible install-script setup,
document the new E2E workspace in tests.md." All four accepted: both `webServer` entries
set `reuseExistingServer: false`; `reset-e2e-db.ts` runs the same
`TRUNCATE … RESTART IDENTITY CASCADE` the server suite uses; a root `npm run bootstrap`
one-liner; `tests.md` §1.3/§5 updated (flagged as a frozen-doc edit — reviewer-requested,
and §5's old text was factually stale). Verified independently of the implementing agent
(probe rows inserted via `psql`, both port guards tested separately).

**Round 2** — "`npm install-scripts` is unavailable on npm 11.6.2; pin the required npm
version or document a fallback, then rerun from a clean checkout." Accepted. The
`allowScripts` approvals in the package manifests are managed by `npm install-scripts`,
which first ships in **npm 11.18.0** (confirmed against npm's `release/v11` CHANGELOG). The
root and all three package manifests now declare `engines` (`node >=20.19.0`,
`npm >=11.18.0`) and commit `.npmrc` with `engine-strict=true`, so an older npm fails fast.
Re-verified end to end from a wiped `node_modules`: clean `bootstrap`, `test:all`
(187 / 114 / 1), `test:e2e`. Flagged to the reviewer that `engine-strict` is now a hard
toolchain requirement for all collaborators.

### #44 — Changes requested: clipped My Tickets table + unfalsifiable responsive check

> `my-tickets/desktop.png` visibly clips the Status badge and hides Last Updated. Fix the
> table layout or evidence capture, and strengthen R-04 to verify viewport containment.

**Response.** Accepted; two further defects of the same class were found while verifying.
The eight columns exceeded the scroll container's width, so `overflow-x: auto` absorbed the
excess silently — Summary and Related System now truncate with an ellipsis **and** a
`title` (ui-spec.md:409; widening the container or dropping a column would both breach
frozen text). Beyond that: (1) **R-01 was structurally unfalsifiable** — it measured
`document.body.scrollWidth` while this PR's own `body { overflow-x: hidden }` backstop pins
that value by construction; it now measures `documentElement` and reports the overflow
amount, which exposed a real 105 px tablet overflow (visually-hidden spans escaping the
scroll container). (2) All four filter selects were ~17 px too narrow for their longest
option ("Created (newe…"). A note was also posted retracting an earlier claim that the
`overflow-x: hidden` backstop had been "verified not a mask" — it was masking exactly this.

### #47 — Changes requested: inert Download/Preview buttons, no Add-Attachment control

> `TicketDetailScreen` does not pass `onDownload` or `onPreview`, so the rendered buttons are
> currently inert. It also still has no Add Attachment control/uploader, although Issue #17 requires
> both and this PR says it completes the client work. Please wire these behaviors or clearly split
> them into a follow-up PR before merging.

**Response.** Accepted. The finding was correct and the PR body over-claimed ("Completes #17's
client work") — there is no `tests.md` C-row for the Ticket Detail download / preview / add wiring
(C-21 tests only that the buttons are present). The PR was **re-scoped** to the Remove flow
(C-18 / C-19), with an explicit "not in this slice" section, and a follow-up slice (14d, later
PR #51) was opened for `downloadAttachment` + the `410` case, the image-preview lightbox, and the
Add-Attachment control with the AC-20 disabled-at-5 limit. Palapluem approved the re-scoped PR.

### #53 — Changes requested: E2E-03 / E2E-04 shared-state coupling

> E2E-03 creates a ticket for David Lee, while E2E-04 asserts that David owns zero tickets. The
> suite therefore passes only in this specific execution order. Please remove this shared-state
> dependency by isolating the requester/fixture or asserting that the failed create leaves the
> pre-test count unchanged, then verify both tests independently.

**Response.** Accepted; fixed at the source. The coupling was in **E2E-04**, not E2E-03: its
"nothing was persisted" check asserted the Requester owned *exactly zero* tickets. It now captures
that Requester's own ticket count immediately before the failed submit and asserts it is
**unchanged** afterwards — an order-independent before/after delta, and a truer BR-26 test. E2E-03
was moved back into numeric position. E2E-04 was then verified to pass both standalone and with
E2E-03 running first. Approved and merged.

### #54 — Changes requested: the "Upload failed — retry" affordance was never implemented

> E2E-02 currently verifies only a generic upload error alert and re-selects the file through the
> Add attachment control. However, `ui-spec.md` §10 and `tests.md` require an "Upload failed —
> retry" row with explicit `Retry` and `Dismiss` actions. Please implement and assert those
> controls, or resolve and update the specification before marking E2E-02 as covered.

**Response.** Accepted — a real implementation gap in slice 14d (#51). `ui-spec.md` §10's
attachment row table specifies an "Upload failed" state (`name + "Upload failed — retry" + Retry +
Dismiss`); the immediate-upload path on Ticket Detail rendered only a `role="alert"` string. The
gap was noted when 14d was built but was not treated as a #51 blocker, which it should have been.
The affordance is implemented in **#59** (`AttachmentSection` renders a per-file failed-upload row
with those exact controls; `Retry` re-uploads, `Dismiss` drops the row; five component tests,
sabotage-checked). #54's E2E-02 is being reworked to drive and assert it once #59 merges.

## 4. Corrections issued by the author

Claims made to the reviewer that were wrong were retracted in writing on the PRs rather than
left standing:

- **#32 / #33** — the intermittent test failures were described as pre-existing and possibly
  caused by parallel agents. Both were false; the cause was supertest opening a fresh
  ephemeral server per request. Corrected on both PRs and fixed in #34.
- **#34** — the residual flakiness was described as blocking. A 30-run stress of the merged
  integration branch produced 0 failures, so the rate was materially lower than claimed;
  the correction was posted with the measurement.
- **#44** — an earlier audit note (on an earlier PR) had stated the `body { overflow-x:
  hidden }` AC-39 backstop was "verified not a mask" for the responsive overflow checks.
  That was wrong; it was masking a real 105 px overflow. Retracted on #44 with the disproof.

## 5. Direction of review

Every Lab 2 pull request (#21–#59) was authored by `N0TAW00D` and reviewed by `Palapluem`.
Review within Lab 2 therefore flowed in one direction: this record holds the comments the
author **received** and the author's **responses** to them, and no comments **given** by the
author on a teammate's Lab 2 pull request. In Lab 1, review was reciprocal — `N0TAW00D`
reviewed and commented on `Palapluem`'s and `THN4`'s pull requests #6, #7, #8, #10 and #12.
This is the situation as it stands for the Git Use assessment.
