# Lab 1 — Peer Review Record

Repository: https://github.com/N0TAW00D/TokTickIT

## Author (me)

| Field | Value |
|---|---|
| Name | นัธทวัฒน์ ปริมสิริคุณาวุฒิ (Natthawat Primsirikunawut) |
| Student ID | 67070501027 |
| GitHub username | [N0TAW00D](https://github.com/N0TAW00D) |

## Peer Reviewer

| Field | Value |
|---|---|
| Name | Wisit Suwannao |
| Student ID | 67070501042 |
| GitHub username | [Palapluem](https://github.com/Palapluem) |
| Access granted on my repo | Read (collaborator) — enough to review and approve, not to push |

## Issues and Pull Requests Reviewed

All four Issues were implemented on their required feature branch and merged into `lab1-staging`
through a peer-reviewed Pull Request. Every PR was approved by `Palapluem` before merge.

| Issue | Feature branch | Pull Request | Target | Reviewer | Decision | Merged |
|---|---|---|---|---|---|---|
| [#1 Set up the TokTickIT project foundation](https://github.com/N0TAW00D/TokTickIT/issues/1) | `feature/1-project-foundation` | [PR #5](https://github.com/N0TAW00D/TokTickIT/pull/5) | `lab1-staging` | Palapluem | Approved (first pass) | 2026-08-06 |
| [#2 Implement the API health check](https://github.com/N0TAW00D/TokTickIT/issues/2) | `feature/2-health-check` | [PR #6](https://github.com/N0TAW00D/TokTickIT/pull/6) | `lab1-staging` | Palapluem | Commented → fixed → Approved | 2026-08-06 |
| [#3 Create and seed IT request categories](https://github.com/N0TAW00D/TokTickIT/issues/3) | `feature/3-category-seed` | [PR #7](https://github.com/N0TAW00D/TokTickIT/pull/7) | `lab1-staging` | Palapluem | Commented → clarified → Approved | 2026-08-06 |
| [#4 Display the IT request category list](https://github.com/N0TAW00D/TokTickIT/issues/4) | `feature/4-category-list` | [PR #8](https://github.com/N0TAW00D/TokTickIT/pull/8) | `lab1-staging` | Palapluem | Commented → fixed → Approved | 2026-08-07 |

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
