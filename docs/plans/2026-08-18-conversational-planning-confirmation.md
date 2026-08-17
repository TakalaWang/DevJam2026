# Conversational Planning Confirmation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent incomplete or assumed travel requirements from becoming a ready itinerary, and make the first phase behave like a conversational trip assistant.

**Architecture:** Gemini extracts typed trip facts and asks for missing information. A deterministic readiness validator checks required facts and explicit user confirmation before allowing scheduling. The existing planner then creates or refines the itinerary from confirmed facts; route calculation remains downstream of confirmation.

**Tech Stack:** TypeScript, Zod, Gemini Interactions API, SQLite snapshots, Vitest, Next.js UI.

---

### Task 1: Add typed planning facts and readiness contracts

**Files:**
- Create: `src/contracts/planning.ts`
- Modify: `src/contracts/conversation.ts`
- Modify: `src/contracts/index.ts`
- Test: `tests/planning-contracts.test.ts`

Add schemas for required trip facts, fact status (`missing`, `provided`, `confirmed`, `assumed`), transport preference, confirmation state, and a discriminated conversation action for collecting facts, asking for confirmation, scheduling, and refining. Preserve existing command schemas for navigation and completed-plan updates.

Write invalid/valid schema tests first, then run `pnpm exec vitest run tests/planning-contracts.test.ts`.

### Task 2: Implement deterministic readiness validation

**Files:**
- Create: `src/lib/itinerary/readiness.ts`
- Modify: `src/lib/itinerary/orchestrator.ts`
- Test: `tests/itinerary-readiness.test.ts`

Validate origin, destinations, departure window, fixed activity windows, transport preference, return plan, and explicit confirmation. A missing or assumed required fact must keep the snapshot in `discussing` and prevent route scheduling. Only confirmed facts can produce `ready`.

Write failing tests for missing transport, missing return plan, assumed departure time, and confirmed complete facts. Then implement the smallest validator and run the focused tests.

### Task 3: Make Gemini collect and confirm before scheduling

**Files:**
- Modify: `src/lib/conversation/gemini.ts`
- Modify: `src/lib/conversation/fixtures.ts`
- Modify: `src/lib/itinerary/orchestrator.ts`
- Modify: `tests/conversation.test.ts`
- Modify: `tests/day-itinerary.test.ts`

Update the conversation prompt and typed output so the agent asks targeted questions, summarizes facts for confirmation, and does not propose a complete day until the user confirms. The orchestrator must reject or downgrade premature `ready` output instead of trusting the model status. Keep updates after planning incremental: changed facts trigger only the affected schedule rebuild.

Add a vague multi-turn fixture covering missing transport and return plan, then explicit confirmation before `ready`.

### Task 4: Show the assistant phase and missing facts in the local UI

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/contracts/api.ts` if the response envelope needs typed facts
- Test: `tests/workbench-layout.test.ts` or a focused UI contract test

Display collecting/confirmation state and missing questions in the conversation area. Keep the current itinerary as a draft while hiding the start button until readiness passes. Label draft assumptions clearly and keep the existing schedule/refinement view after confirmation.

### Task 5: Verify the complete flow

Run:

```bash
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm run format:check
pnpm build
```

Run the local UI flow with Playwright for: vague request → assistant questions → confirmation summary → confirmed schedule → start. Confirm an incomplete request cannot start and a confirmed request can still refresh and complete.
