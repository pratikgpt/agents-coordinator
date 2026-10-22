# Operations Coordinator — three connected mini-agents

Mudita AI Generalist hiring assignment 02. Three distinct LLM agents turn a fictional meeting transcript and
company rules into a reviewed action plan:

```
            transcript + rules
                    │
             ┌──────▼──────┐   facts w/ line refs,      ┌──────────────┐   plan (tasks, owners,     ┌─────────────┐
             │ Intake Agent│── missing/conflict flags ─▶│Planning Agent│── deadlines, deps) ───────▶│ Review Agent│
             └─────────────┘   (handoff, validated)     └──────▲───────┘   (handoff, validated)     └──────┬──────┘
                                                               │      corrections (handoff)              │
                                                               └─────────────────────────────────────────┤
              user corrects a fact ─▶ new context version ─▶ Planning + Review rerun     approved or     │
                                                                                         unresolved ◀────┘
                                                                                         after N rounds
```

**Live URL:** https://agents-coordinator.vercel.app · **Demo:** open the URL; no login needed. A demo checklist in the
sidebar walks through every required case.

## How to demo the required cases

| Case | Steps in the UI |
|---|---|
| Complete three-agent run | **New run** → **Standard run** → **Start run** (sample input is preloaded). The run header shows the verdict and what is still undecided; the **Plan** tab shows the plan. |
| Rule violation sent back for correction | **New run** → **Rule violation** (simulated). **Agent exchange** shows Review's blocking corrections for draft 1 and the changes Planning made in draft 2. |
| Changed source fact propagates | On a finished run: **Source facts** → **Correct** the release-date fact (F2), e.g. to `2026-11-06` → **Save and rerun**. Context goes to v2, Planning and Review rerun automatically, Intake is reused; deadlines move. |
| Recovery after simulated model failure | **New run** → **Model failure** (simulated). Planning fails with a labelled simulated fault; **Retry Planning** reruns only Planning (attempt 2). The failed attempt stays visible in **Agent exchange**. |
| Sessions don't share private context | Open the app in a private window: different session id, no runs visible, and other sessions' run URLs return 404. |

Simulated faults are opt-in (a scenario on **New run**, or **Simulate failure** on an unfinished run) and are tagged
**Simulated** everywhere they appear: the scenario card, the run header, the failure message, the timeline and the log.

### UI design

The run view leads with the outcome (status, verdict, how many tasks still need an owner or date) and keeps detail
one step away: selecting an agent shows what it **received** and **produced** in plain language, with the raw JSON
behind a disclosure. Owners and dates carry a coloured marker for where they came from (meeting, company rule, agent
proposal, open question), and missing ones read "Needs owner" / "Needs date" instead of being guessed. The open run
is kept in the URL, so a refresh returns to it.

## Architecture

- **Next.js 15 (App Router) + TypeScript**, server-side API routes; the OpenRouter key never reaches the browser.
- **Postgres** (local Docker / Neon in production) via `postgres.js`. Schema is created on first request (`src/lib/db.ts`).
- **OpenRouter** (OpenAI-compatible API) with `anthropic/claude-sonnet-5.5` by default; each agent's model is configurable.
- **Zod** schemas for every agent output and every handoff (`src/lib/schemas.ts`).

### The agents (`src/lib/agents.ts`)

Each agent is a separate model call with its own system prompt, input type and output schema. They share nothing
except persisted handoff messages.

| Agent | Sees | Produces | Extra guards |
|---|---|---|---|
| **Intake** | Numbered transcript, calendar/roster (to spot conflicts) | `facts[]` (decision / requirement / constraint, each with line numbers + verbatim quote), `issues[]` (missing / conflict) | Code verifies every quote exists on the cited lines; ungrounded output gets one repair attempt, then the step fails. |
| **Planning** | Intake's facts + issues and the rules — **not the raw transcript** | `tasks[]` with owner/deadline **basis** (`transcript` / `rule` / `recommendation` / `unresolved`), `recommendations[]`, `open_questions[]`, `changes_made[]` | Must cite existing fact ids; on later rounds receives its previous plan + Review's blocking corrections. |
| **Review** | Original transcript, rules, current facts, the plan | `approved`, `issues[]` each with a concrete `correction` | Deterministic rule checks (`src/lib/checks.ts`: roster, holidays, working days, capacity, dependency cycles/order, fact citations, owner grounding) are merged with the LLM's findings. A plan is approved only if neither finds a blocking issue. |

The Planning ⇄ Review loop is bounded by `MAX_REVIEW_ROUNDS` (default 3). If issues remain, the run ends as
**needs attention** and the unresolved issues are surfaced to the user.

### Shared context and orchestration (`src/lib/orchestrator.ts`)

Persisted per run: run id, transcript, rules, **context versions** (fact snapshots), every **step** (agent, context
version, round, status, attempts, input, output, token usage/cost, error), every **handoff message**, and an event log.

- **One step per request.** `POST /api/runs/:id/advance` runs exactly the next step, so requests stay short and a
  crashed or closed browser just pauses the run.
- **Next step is derived from state.** `nextAction()` is a pure function of succeeded steps for the current
  context version, so resuming never repeats completed work.
- **Idempotent claiming.** Steps have a unique `(run_id, step_key)` such as `planning:v2:r1`. A step is claimed with
  `INSERT … ON CONFLICT DO UPDATE … WHERE status = 'failed'`; concurrent clicks get `busy`, never a duplicate call.
  A step stuck in `running` for over 5 minutes (crashed request) can be reclaimed.
- **Validated handoffs.** Every handoff (`intake->planning`, `planning->review`, `review->planning`, `review->user`,
  `user->planning`) is parsed against its schema inside the same transaction that marks the step succeeded; an
  invalid handoff rolls back and fails the step.
- **No stale context.** Correcting a fact creates context version _n+1_. Planning and Review rerun against it;
  Intake output is reused because only the fact changed. A step that finishes after the version moved is stored
  as `superseded` and its output is never handed on.
- **Session isolation.** Each browser gets a random httpOnly cookie. Every query filters by session id, and agents
  only receive data loaded from their own run, so there is no shared in-memory conversation state.

## Setup

Requirements: Node 20+, Docker (or any Postgres 14+), an [OpenRouter](https://openrouter.ai/keys) API key.

```bash
docker run -d --name mudita-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=agents -p 5433:5432 postgres:16
npm install
cp .env.example .env.local   # then fill in OPENROUTER_API_KEY
npm run dev                  # http://localhost:3000
```

### Environment variables

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `OPENROUTER_API_KEY` | yes | Server-side OpenRouter key |
| `OPENROUTER_MODEL` | no | Model for all agents (default `anthropic/claude-sonnet-5.5`) |
| `INTAKE_MODEL`, `PLANNING_MODEL`, `REVIEW_MODEL` | no | Per-agent model override |
| `MAX_REVIEW_ROUNDS` | no | Planning ⇄ Review round limit (default 3, max 5) |

### Deployment

Vercel + Neon: import the repo in Vercel, set the variables above (use Neon's pooled connection string for
`DATABASE_URL`). The advance route sets `maxDuration = 300` because one step can take 15–40 s.

## Tests

```bash
npm test          # vitest; integration tests need the Postgres from Setup
npm run typecheck
```

- `tests/checks.test.ts` — deterministic rule checks and Intake grounding.
- `tests/next-action.test.ts` — step selection: retries, correction loop, round limit, version reruns.
- `tests/orchestrator.db.test.ts` — against real Postgres with stubbed agents: full run with validated handoffs,
  correction loop and round limit, resume after simulated failure without repeating Intake, no duplicate execution
  under concurrent advances, fact-correction propagation, stale-result discarding, and cross-session access returning
  not found.

The agents themselves were verified end to end against the real model (results below).

## Model cost per run

Measured with `anthropic/claude-sonnet-5.5` via OpenRouter ($2 / $10 per million input / output tokens) on the sample input:

| Scenario | Model calls | Cost |
|---|---|---|
| Plan approved in round 1 | 3 | $0.117 |
| Rule violation → corrected in round 2 | 5 | $0.174 – $0.189 |
| Simulated failure + resume (approved round 1) | 3 billed | $0.108 |
| Fact correction rerun (Planning + Review only) | 2 | +$0.088 |

**Typical: ~$0.10–0.20 per run.** Per-step token counts and cost are shown in the UI and stored on each step.

## Known limitations

- Fact correction edits existing facts only; you cannot add a new fact or answer an Intake issue directly. A changed
  transcript needs a new run.
- Intake is not rerun on a fact correction by design; facts are the shared context and the user's correction overrides them.
- Some rules (R2 security review, R4 sign-off, R6 PII) are judged by the LLM Review Agent; only structural rules are
  enforced in code, so review quality depends on the model.
- Token cost of a call that ultimately fails (e.g. invalid output after the repair attempt) is not recorded.
- No authentication or rate limiting: sessions are anonymous cookies, so anyone with the URL can spend model credits.
- The browser drives the run one step at a time; closing the tab pauses it (it resumes from the same step).
- Dates are plain ISO dates with no timezone handling.

## A bug I diagnosed

While walking through the UI with a headless browser, clicking a simulated-fault checkbox appeared to do
nothing. The checkbox was controlled by the run state from the server, so it only flipped after the
`/faults` request returned, and the automated `check()` failed. The fix was an optimistic update: set the faults
locally on click, then reconcile with the server's response (`src/app/page.tsx`).

## AI tool disclosure

Built with Claude Code (Anthropic) as a coding assistant. I reviewed the design and code and can explain every part.
