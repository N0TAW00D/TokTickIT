# Lab 1 — Peer Review Record

Repository: https://github.com/N0TAW00D/TokTickIT

## Author (me)

| Field | Value |
|---|---|
| Name | นัธทวัฒน์ ปริมสิริคุณาวุฒิ (Natthawat Primsirikunawut) |
| Student ID | 67070501027 |
| GitHub username | [N0TAW00D](https://github.com/N0TAW00D) |

## Peer Reviewer (primary — approving reviewer)

| Field | Value |
|---|---|
| Name | Wisit Suwannao |
| Student ID | 67070501042 |
| GitHub username | [Palapluem](https://github.com/Palapluem) |
| Access granted on my repo | Read (collaborator) — enough to review and approve, not to push |
| Role | Reviewed and **approved** all four PRs before merge; raised three findings that went through a Fixing cycle |

## Second Reviewer

| Field | Value |
|---|---|
| Name | Thanatip Nitinantakul |
| Student ID | 67070501023 |
| GitHub username | [ThnaChamp](https://github.com/ThnaChamp) |
| Access granted on my repo | Write (collaborator) |
| Role | Left a **Commented** review on all four PRs on 2026-08-07, confirming the work matched the lab-sheet requirements. These were submitted *after* each PR had already been merged, so they are a second opinion, not the gating approval. |

## Issues and Pull Requests Reviewed

All four Issues were implemented on their required feature branch and merged into `lab1-staging`
through a peer-reviewed Pull Request. Every PR was approved by `Palapluem` before merge, and later
independently confirmed by `ThnaChamp`.

| Issue | Feature branch | Pull Request | Target | Primary reviewer decision | Second reviewer | Merged |
|---|---|---|---|---|---|---|
| [#1 Set up the TokTickIT project foundation](https://github.com/N0TAW00D/TokTickIT/issues/1) | `feature/1-project-foundation` | [PR #5](https://github.com/N0TAW00D/TokTickIT/pull/5) | `lab1-staging` | Palapluem — Approved (first pass) | ThnaChamp — Commented | 2026-08-06 |
| [#2 Implement the API health check](https://github.com/N0TAW00D/TokTickIT/issues/2) | `feature/2-health-check` | [PR #6](https://github.com/N0TAW00D/TokTickIT/pull/6) | `lab1-staging` | Palapluem — Commented → fixed → Approved | ThnaChamp — Commented | 2026-08-06 |
| [#3 Create and seed IT request categories](https://github.com/N0TAW00D/TokTickIT/issues/3) | `feature/3-category-seed` | [PR #7](https://github.com/N0TAW00D/TokTickIT/pull/7) | `lab1-staging` | Palapluem — Commented → clarified → Approved | ThnaChamp — Commented | 2026-08-06 |
| [#4 Display the IT request category list](https://github.com/N0TAW00D/TokTickIT/issues/4) | `feature/4-category-list` | [PR #8](https://github.com/N0TAW00D/TokTickIT/pull/8) | `lab1-staging` | Palapluem — Commented → fixed → Approved | ThnaChamp — Commented | 2026-08-07 |

## Review Comments on My Pull Requests, and My Responses

### PR #5 — Project foundation

| | |
|---|---|
| Reviewer comment | "Well done Natthawat!, That's look good so far." |
| Decision | **Approved**, no changes requested |
| My response | No fix needed. Merged into `lab1-staging` via merge commit `43b2429`. |
| Evidence | https://github.com/N0TAW00D/TokTickIT/pull/5 |

### PR #6 — API health check (real Fixing cycle)

| | |
|---|---|
| Reviewer comment (inline, `client/src/App.tsx`) | "The lab sheet requires the exact phrase **Unable to connect to TokTickIT API** in the error state. Right now it says **Unable to connect to server**." |
| Why it was valid | Section 3.1 / Part 4 of the lab sheet specifies the literal failure-case string. My wording was close but not the contract wording. |
| My response | "Thanks for pointing my miss, I have fix it on `8341c8b`." — changed the fetch `catch` fallback to the exact required phrase on the same branch, then re-requested review. |
| Outcome | Reviewer re-reviewed and **Approved**: "You are doing it well so far!" |
| Evidence | https://github.com/N0TAW00D/TokTickIT/pull/6#discussion_r3727669588 |

### PR #7 — Category model, migration, and seed (clarification, no code change)

| | |
|---|---|
| Reviewer comment (inline, `server/prisma/seed.ts`) | "I saw `seed.ts` spins up its own Pool/PrismaClient instead of reusing the one from Issue 1's setup — two client instances floating around. Intentional (standalone script) or just missed the shared module?" |
| My response | "Not missed — we haven't touched the DB from the request path yet. This is a seeding script that runs separately from the request flow, and I followed the method Prisma itself recommends for seeding (https://www.prisma.io/docs/orm/prisma-migrate/workflows/seeding)." |
| Outcome | Reviewer accepted the reasoning — "Oh, sorry for my mistake. Your task overall in this issue is well done!" — and **Approved**. No code change was needed. |
| Evidence | https://github.com/N0TAW00D/TokTickIT/pull/7#discussion_r3729738573 |

### PR #8 — Category list endpoint and UI (two findings)

| | |
|---|---|
| Reviewer comment 1 (inline, `client/src/App.tsx`) | "The categories error message says *Unable to load categories from TokTickIT API*, but spec wants the literal *Unable to connect to TokTickIT API*." |
| Reviewer comment 2 (inline, test file) | "Nit: client test lives at `client/tests/App.test.tsx`, spec wants it under `client/tests/lab-01/` like the server one." |
| My response | "Nice catch, thanks for noticing — I have fixed it." Both were fixed on the same branch: the categories `catch` now sets the exact required phrase, and the Vitest suite was moved to `client/tests/lab-01/App.test.tsx` so it matches the required repository structure in Section 8. |
| Outcome | Reviewer re-reviewed and **Approved**: "Good job, Natthawat! It's nice to see your final product in this repo for now!" |
| Evidence | https://github.com/N0TAW00D/TokTickIT/pull/8#discussion_r3733369610 and https://github.com/N0TAW00D/TokTickIT/pull/8#discussion_r3733372579 |

## Second-Reviewer Comments (ThnaChamp)

`ThnaChamp` reviewed all four Pull Requests on 2026-08-07 and raised no findings — every review was
a top-level confirmation with no inline change requests. Because these were submitted after the
merges, they served as an independent check that the merged result matched the lab sheet rather
than as the gate for merging.

| Pull Request | Decision | Comment | Evidence |
|---|---|---|---|
| [PR #5 — Project foundation](https://github.com/N0TAW00D/TokTickIT/pull/5) | Commented, no changes requested | "Good job, everything is complete." | [pullrequestreview-4882935109](https://github.com/N0TAW00D/TokTickIT/pull/5#pullrequestreview-4882935109) |
| [PR #6 — API health check](https://github.com/N0TAW00D/TokTickIT/pull/6) | Commented, no changes requested | "Nice work! That matches the instructions well." | [pullrequestreview-4882931284](https://github.com/N0TAW00D/TokTickIT/pull/6#pullrequestreview-4882931284) |
| [PR #7 — Category model and seed](https://github.com/N0TAW00D/TokTickIT/pull/7) | Commented, no changes requested | "Looks good, exactly as required." | [pullrequestreview-4882692198](https://github.com/N0TAW00D/TokTickIT/pull/7#pullrequestreview-4882692198) |
| [PR #8 — Category list endpoint and UI](https://github.com/N0TAW00D/TokTickIT/pull/8) | Commented, no changes requested | "Well done! That final step is complete." | [pullrequestreview-4882924562](https://github.com/N0TAW00D/TokTickIT/pull/8#pullrequestreview-4882924562) |

**My response:** no code changes were required. I confirmed each comment against the acceptance
criteria on the matching Issue and left the merged branches as they were.

## Reviews I Gave to My Peer Partner

Reciprocal reviews were performed on my partner's own repository (`Palapluem/toktickit_cpe334`),
which is where their Lab 1 Pull Requests live.

| Partner PR | My decision | My review comment | Partner's response |
|---|---|---|---|
| [#5 Project foundation](https://github.com/Palapluem/toktickit_cpe334/pull/5) | **Approved** | "Ready to Merge!" — structure follows the required layout in Section 8. | Merged, no changes needed. |
| [#6 API health check](https://github.com/Palapluem/toktickit_cpe334/pull/6) | **Commented** → later Approved | Inline on `client/src/App.tsx`: "catch swallowing error bc it lacks off console or real error message." Follow-up: "also display a part of error onto the react display comp." | Fixed on the same branch: added `console.error` in the catch, plus an `errorDetail` state rendered as a muted "Details: …" line under the required phrase, with a test asserting both. I then approved. |
| [#7 Category model and seed](https://github.com/Palapluem/toktickit_cpe334/pull/7) | **Commented** → Approved | Inline on `server/prisma.config.ts`: "Does it create duplication of command like npx and tsx execution?" Follow-up: "If you have tested the migration script against a real DB, it's fine for me 👍🏻." | Explained both entry points delegate to one `prisma/seed.ts`, dropped the redundant `npx` prefix in `de2138c`, and confirmed the seed was run twice against real PostgreSQL with `SELECT COUNT(*), COUNT(DISTINCT name)` returning 4, 4. |
| [#9 Display category list](https://github.com/Palapluem/toktickit_cpe334/pull/9) | **Approved** | "These things look great." | Merged as-is. |
| [#12 Lab 1 release `lab1-staging` → `main`](https://github.com/Palapluem/toktickit_cpe334/pull/12) | **Approved** | "We have a great collaboration." | Merged to `main`. |

## Kanban Status

All four Issues reached **Done** on the *TokTickIT Individual Sprints* board:
Backlog → Specified → Started → PR Review → (Fixing for #2 and #4) → PR Review → Done.

Issues **#2** and **#4** passed through the **Fixing** column because the reviewer found real
contract violations (wrong error wording, wrong test location); both were corrected on the same
feature branch and re-reviewed before approval, exactly as Section 12 describes.
