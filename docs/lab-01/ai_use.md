# AI Use and Reflection — Lab 1

## Which agent and model I used

I used **Claude Code**, Anthropic's coding agent, running inside VS Code, with **Claude Sonnet 5**
as the LLM at its default thinking level. Section 5 of the lab sheet says the course will most
likely use Antigravity, but that was not available to me; the lab sheet also allows a VS Code–based
IDE with an integrated AI coding assistant more generally, so I used that.

I used the agent for planning, scaffolding, implementation, Prisma migrations and seeding, test
writing, Git/GitHub operations, and documentation. I reviewed and approved every file, command,
and dependency it produced, and I fixed everything my peer reviewer flagged myself before merging.

## Selected Key Prompts

| Prompt Name | Actual Prompt Text | My Reflection |
|---|---|---|
| Plan Lab 1 implementation | "Read the attached TokTickIT Lab 1 lab sheet. Summarize the four GitHub Issues, their acceptance criteria, their dependency order, and the required automated tests. Propose an implementation order. Do not write any code yet." | Worked in one shot. Forcing a plan-only pass was worth it — the agent surfaced the Issue 4 → Issue 3 dependency before I started branching, so I never had to unwind a branch. |
| Set up the full-stack project | "Set up the TokTickIT project foundation for Lab 1: React + TypeScript + Vite + Bootstrap in `client/`, Node.js + Express + TypeScript in `server/`, PostgreSQL + Prisma, and Vitest + Supertest configured on both sides. Use the required repository structure. Add `.gitignore` and `.env.example`. Do not add any functionality beyond Lab 1 scope." | This needed several follow-ups. "Do not add functionality beyond scope" stopped it from inventing ticket models, but I still had to send a separate prompt to reorganize the server into `src/` + `tests/lab-01/` and wire the test scripts, because my first prompt described the stack but never described the folder layout. Naming the exact directory tree up front would have saved a round trip. |
| Run Postgres locally with Docker | "Add a `docker-compose.yml` that runs PostgreSQL locally, and npm scripts on the server for starting the database and applying the Prisma schema. Keep the real connection string out of Git — only `.env.example` gets committed." | One shot, and the constraint about `.env` mattered: it shaped `.gitignore` from the very first commit, so I never had to scrub a secret out of history later. |
| Implement the health check | "Add `GET /api/health` to the Express backend. It must return HTTP 200 with exactly `{ \"status\": \"ok\", \"service\": \"TokTickIT API\" }`. Add a Supertest test under `server/tests/lab-01/` that asserts the status code and both JSON fields." | My first version of this prompt paraphrased the response shape instead of pasting it, and I had to correct the structure afterwards (commit `c9f71a0`, "fix: api structure to follow the instruct"). Lesson I kept using for the rest of the lab: **paste the literal contract from the lab sheet, do not describe it.** |
| Wire the frontend to the real API | "Make the React page call the real backend for `/` and `/api/health` and render the result. Add CORS on the server so the Vite dev server can reach it. When the request fails, show a useful message instead of a raw browser network error." | The vague part here was "a useful message" — the agent chose "Unable to connect to server", which is reasonable English but not the string the lab sheet requires. My reviewer caught it, and I fixed it in `8341c8b`. Same lesson as above, learned the hard way a second time. |
| Create the Category model and idempotent seed | "Add a Prisma `Category` model with `id` (autoincrement), unique `name`, and `createdAt`. Generate a migration that creates the table. Write `prisma/seed.ts` that inserts Account and Access, Hardware, Software, and Network, and make it safe to run more than once — no duplicates." | The "safe to run more than once" phrasing is what produced `upsert` inside a `$transaction` rather than plain `create` calls, which is exactly the acceptance criterion. It was not perfect though: the generated model had a typo in the `createdAt` field that I only caught by reading the migration SQL myself (fixed in `a599cb7`). Generated migrations still need a human read. |
| Expose the category list endpoint | "Add `GET /api/categories` that reads categories from PostgreSQL through Prisma and returns `[{ id, name }]` ordered by id — only those two fields. Add a Supertest test asserting 200 and the four seeded categories in order. Extract the PrismaClient into a shared module instead of creating one per route." | The explicit "only those two fields" and "ordered by id" stopped `createdAt` leaking into the response and made the test deterministic. Asking for the shared client in the *same* prompt as the endpoint was better than cleaning it up afterwards. |
| Build the category list UI with real states | "Render the categories returned by `/api/categories` in the React page — no hard-coded values. Show an explicit loading state while the request is in flight and an error state when it fails, using `role=\"status\"` and `role=\"alert\"`. Add Vitest + Testing Library tests covering: the fetch fires on mount, loading shows then resolves, one row per category, empty list, non-ok response, and rejected request." | My best prompt of the lab. Listing the six test cases explicitly meant I got exactly the coverage the acceptance criteria asked for instead of one happy-path test, and the accessible roles made the tests query by meaning rather than by CSS class. |
| Respond to peer review findings | "My reviewer commented that the error text must be the literal 'Unable to connect to TokTickIT API' and that the client test belongs under `client/tests/lab-01/`. Fix both on this branch, and explain why each one was actually a spec violation before you change anything." | Asking for the *reasoning first* was the point. It confirmed the reviewer was right against a specific line of the lab sheet rather than me just accepting a change I could not defend, and it kept both fixes scoped to what was asked instead of an opportunistic refactor mid-review. |

## Reflection on improving my prompts

Two things changed how I wrote prompts over this lab.

The first is that **paraphrasing a contract is not good enough**. Every real defect in this lab came
from the same root cause: I described a required string or shape in my own words, the agent produced
something reasonable but different, and either I caught it (`c9f71a0`, the health response shape) or
my reviewer did (the "Unable to connect to TokTickIT API" wording, twice). Once I started pasting the
literal JSON and literal error strings from the lab sheet into the prompt, that class of rework
stopped.

The second is that **stating the tests inside the implementation prompt produces better code than
asking for tests afterwards**. When I listed the six UI cases up front, the agent designed the
component around observable states — accessible roles, a real loading flag — instead of writing a
component and then bolting tests onto whatever it happened to render.

What I did *not* delegate: the acceptance-criteria checklist on each Issue, reading the generated
migration SQL (which is where I found the `createdAt` typo), the decision to keep the seed script's
own PrismaClient after my reviewer questioned it, and every Git/PR operation into `lab1-staging`.
The agent executed; the judgement about whether the output actually satisfied the contract stayed
mine.
