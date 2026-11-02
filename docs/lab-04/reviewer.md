# Lab 4 Review Log — TokTickIT

Part 1 deliverable (Lab 4 handout §14, Part 1). Every Lab 4 change reaches `lab4-staging` through a
peer-reviewed pull request, and `lab4-staging` reaches `main` through one release pull request.
There are no direct commits to `main` or `lab4-staging`.

Complete through #113, the last pull request into `lab4-staging`. The release pull request
(`lab4-staging` → `main`) is added to §2 when it is opened. This record was compiled from the GitHub
review, comment and merge data of each pull request (`gh pr view`, `gh api repos/N0TAW00D/TokTickIT/pulls/N/…`).

## 1. Reviewer identity

| Role | GitHub | Notes |
|---|---|---|
| Author | `N0TAW00D` | Authored every Lab 4 pull request (#101–#113). Real name: Natthawat Primsirikunawut. |
| Reviewer | `Palapluem` | Reviewed and merged every Lab 4 pull request. Real name: Wisit Suwannao. |
| Third collaborator | `THN4` | Real name: Thanatip Nitinantakul. Not a reviewer on Lab 4, matching Labs 2 and 3. |

## 2. Pull requests and outcomes

All pull requests target `lab4-staging`. "Rounds" counts review cycles: each `CHANGES_REQUESTED`
review (or a `COMMENTED` review that raised a finding to fix) plus the final `APPROVED` review. An
approval on the first pass is 1. Two `COMMENTED` reviews on #109 carried only inline comments and
are counted with the `CHANGES_REQUESTED` review submitted with them.

| PR | Issue | Branch → Base | Reviewer | Comments | Responses | Approval / Merge |
|---|---|---|---|---|---|---|
| [#101](https://github.com/N0TAW00D/TokTickIT/pull/101) | #92 | `docs/92-lab-04-spec` → `lab4-staging` | Palapluem | Changes requested: the resolution gate (BR-17(b)) broke an earlier status test and an earlier e2e check while §4.2 claimed the full list of edits | Strict gate kept (D-27); both re-pointings listed in `tests.md` §4.2; 5 suggestions adopted (result required only to complete, V-checklist Evidence column, lock → read → compare → check → write, numeric ordering, 409 `IDEMPOTENCY_CONFLICT`) | Approved 2026-10-12 09:05, merged `a7c9f92`. 2 rounds |
| [#102](https://github.com/N0TAW00D/TokTickIT/pull/102) | #92 | `docs/92-spec-numeric-order` → `lab4-staging` | Palapluem | None: all 41 BRs and 52 ACs keep their IDs and wording, in strict order | — | Approved 2026-10-13, merged `89c2a7b`. 1 round |
| [#103](https://github.com/N0TAW00D/TokTickIT/pull/103) | #93 | `feat/93-actions-taken-model` → `lab4-staging` | Palapluem | Changes requested, 4 findings: reseed after an application status change restored status without bumping `version`; seeded Actions had no `clientRequestHash` (BR-35); `Ticket.updatedAt` earlier than a seeded Action (BR-15); Administrator named as a status-history actor | The pull request was merged by the reviewer **before** the four findings were fixed. All four were fixed in #104 against `lab4-staging` | Merged `ef80e88` with the review still at "changes requested". 1 round |
| [#104](https://github.com/N0TAW00D/TokTickIT/pull/104) | #93 | `fix/93-seed-review` → `lab4-staging` | Palapluem | Changes requested ×3, then approval. Round 1: reseed after an attachment upload moved `updatedAt` back about 290 h; the upgrade path left 900008/900020 unrepaired; one cancelled Action hashed the wrong body. Round 2: `POST /requester-resolved` then reseed moved `updatedAt` back; comment/note guard treated a duplicate of a seeded pair as fixture data. Round 3: `tests.md` lacked MIG-06b–06e and a wrong UNIT-10 path, red-phase evidence, technique labels | Each round fixed with a regression test (MIG-06b–06e) and the earlier-lab e2e re-run (210/210). Round 4 was docs only: rows added, `Technique:` notes, limitation recorded instead of rewriting pushed history | Approved 2026-10-13 17:28 at `4bf6668`, merged `d748eb6`. 4 rounds |
| [#105](https://github.com/N0TAW00D/TokTickIT/pull/105) | #94 | `feat/94-actions-taken-api` → `lab4-staging` | Palapluem | Changes requested ×2, then approval. Round 1: POST checked access before field validity, PATCH returned `STALE_UPDATE` before rejecting invalid fields (BR-34); concurrent idempotency test accepted 200 for different bodies; `clientRequestId` not restricted to UUID v4; out-of-range assignee id. Round 2: malformed-JSON order, calendar dates rolling over, UUID case canonicalisation, JSON content type with no body, attachment-note text | Round 1 at `7afe760`, round 2 at `7e733eb`. Each fix has a regression test | Approved 2026-10-15 at `7e733eb` after the reviewer undid each fix and watched its test fail; server suite 704/704; merged `d0a797c`. 3 rounds |
| [#106](https://github.com/N0TAW00D/TokTickIT/pull/106) | #97 | `feat/97-dashboard-api` → `lab4-staging` | Palapluem | Approved at `a0c36c2` (server 640/640). After #105 merged the branch conflicted in `authorization.api.test.ts`; the reviewer supplied the resolution (two top-level `describe` groups). Three non-blocking notes: BR-23 edge-case tests, unused `resolutionTime()`, unspecified order of `recentlyResolved.items` | Merged `lab4-staging` into the branch (`ebd0cd5`) as described. The reviewer asked for the three notes to be folded into related work, not a separate pull request, so they were done in #111 | Approved again at `ebd0cd5` 2026-10-17, merged `732a058`. 2 rounds |
| [#107](https://github.com/N0TAW00D/TokTickIT/pull/107) | #94 | `fix/94-review-followups` → `lab4-staging` | Palapluem | Changes requested: the idempotency rules in `api-spec.md` §1.4 and BR-35 said text is trimmed, but `attachmentNotes` is stored and hashed verbatim | `d22dccf` states the exception in `api-spec.md` §§1.4 and 2.3, `specification.md` BR-35 and `tests.md` UNIT-10 | Approved 2026-10-29, merged `4759377`. 2 rounds |
| [#108](https://github.com/N0TAW00D/TokTickIT/pull/108) | #95 | `feat/95-ticket-workflow` → `lab4-staging` | Palapluem | Changes requested ×2, then approval. Round 1: only a small subset of the role × status combinations was tested for Administrator and Requester; stale updates dropped the user's attempted value. Round 2: BR-36 unsaved input lost after validation, network failure and stale Refresh; Resolve behaviour inconsistent across code, tests and UI contract | Round 1: parameterized HTTP tests for every (current, target, role) combination. Round 2 at `b7ac442`: drafts kept after failures and Refresh without auto-resubmit; Resolve saves immediately | Approved 2026-10-29 at `b7ac442` (reviewer ran client 377/377), merged `bfce69f`. 3 rounds |
| [#109](https://github.com/N0TAW00D/TokTickIT/pull/109) | #98 | `feat/98-dashboard-ui` → `lab4-staging` | Palapluem | 2 inline findings, then changes requested: User Management role filter not backed by the URL (ui-spec §2, browser Back); drill-down chip remove button was only "×" and 28 px on mobile | Replied inline: role filter in the URL, replacing history like My Tickets (C-33); visible "Remove" label and a 44 × 44 px target below 768 px (R-06). Client 458, e2e 211 | Approved 2026-10-30 at `9ce063c`, merged `12f921e`. 2 rounds |
| [#110](https://github.com/N0TAW00D/TokTickIT/pull/110) | #96 | `feat/96-actions-taken-ui` → `lab4-staging` | Palapluem | Changes requested, 6 inline findings plus a summary: late Actions/history reads from a previous ticket; field pairs (ui-spec §8); latest-version panel without the Action date; Save below Cancel on mobile; loading/failure roles; focus order; warning colours on error callouts (STY-004); surface tokens (STY-005); test-first order not visible in the history | All fixed in `d564c30`…`f34578f` with inline replies and new rows C-34–C-37 and S-07–S-09; each fix was checked by reverting it. Test-first order recorded as a known deviation in `tests.md` §1.4; pushed history left as is | Approved 2026-10-31 at `f34578f`, merged `78b6ba7`. 2 rounds |
| [#111](https://github.com/N0TAW00D/TokTickIT/pull/111) | #99 | `feat/99-hardening` → `lab4-staging` | Palapluem | No blocking findings at `6d879aa`; noted the full e2e run was not repeated after the A11Y-05 test change | — | Approved 2026-11-02, merged `f4ec16d`. 1 round |
| [#112](https://github.com/N0TAW00D/TokTickIT/pull/112) | #100 | `feat/100-integration` → `lab4-staging` | Palapluem | Commented, then changes requested: the full server suite timed out in both reported runs (1172/1175, 1174/1175), including a 10 s `beforeEach` hook in WF-11; asked for one clean run or a fix to the slow setup | Cause found: `ticket-workflow.api.test.ts` hashed four bcrypt users in `beforeEach` for each of its 401 tests (627 s alone). `d8aed9d` creates the four users once in `beforeAll`; no timeout was changed. Full server suite 1175/1175 in 512 s; results posted | Approved 2026-11-02 at `d8aed9d`, merged `55dcf3c`. 3 rounds |
| [#113](https://github.com/N0TAW00D/TokTickIT/pull/113) | #100 | `docs/100-final-results` → `lab4-staging` | Palapluem | None: results traceable to the runs at `55dcf3c` | — | Approved 2026-11-02, merged `4ccb5a2`. 1 round |

## 3. Representative findings and resolutions

| PR | Finding | Resolution |
|---|---|---|
| #101 | The strict resolution gate would break two earlier tests, but the plan said it listed every edit to earlier tests. | The reviewer searched the earlier suites for every status change into Resolved and confirmed "exactly two" after the list was corrected (D-27, `tests.md` §4.2). |
| #103 / #104 | Reseeding after real application activity (status change, upload, requester-resolved) rewrote Ticket state. | The seed now treats any activity as non-pristine and leaves the Ticket alone; each case is a regression row, MIG-06b–06e. |
| #105 | Validation order (BR-34): access and `STALE_UPDATE` were checked before field validity. | Body shape first, then access, then merged-state validation, then the version compare; five follow-up cases in round 2. |
| #108 | Unsaved workflow input was lost after failures and Refresh (BR-36). | Drafts for status, owner and IT Priority survive stale, validation and network failures and are never resubmitted automatically. |
| #109 | Role filter not in the URL; "×" chip button too small on mobile. | URL-backed role filter (C-33); labelled 44 × 44 px remove target (R-06). |
| #110 | A late response for ticket A could replace ticket B's rows. | Both detail screens drop reads for a ticket that is no longer current (C-36). |
| #112 | Full server suite timed out under load. | Fixture users created once per file; 627 s → 102 s for the file, suite 1363 s → 512 s, all 1175 passing. |

## 4. Process notes

- #103 was merged by the reviewer while its `CHANGES_REQUESTED` review was open. The four findings were fixed on a new branch (#104) and re-reviewed through four rounds; the record above shows both.
- Where the reviewer asked for red-phase (test-first) evidence that the history did not show (#104, #110), the limitation was recorded in `tests.md` §1.4 and the pushed history was not rewritten.
- Test results quoted in the pull requests were produced by the author; the reviewer re-ran suites in #105 (704/704), #106 (640/640), #108 (client 377/377) and sabotage-checked #105. GitHub Actions status checks are not attached to these pull requests.
