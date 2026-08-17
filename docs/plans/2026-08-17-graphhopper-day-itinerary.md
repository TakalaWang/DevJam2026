# GraphHopper Day Itinerary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a mobile-first Routecraft app that creates a one-day itinerary through Gemini conversation, then tracks and updates its GraphHopper travel legs when city conditions change.

**Architecture:** GraphHopper remains the deterministic route engine for every travel leg. Gemini is the only way to create or edit itinerary content: it converts user messages into typed `ItineraryCommand` values and drafts typed update notifications. A day-itinerary orchestrator owns revisions, fixed/flexible stops, active navigation state, and refresh events. City signals are detected outside the LLM and never allow the LLM to override safety decisions.

**Tech Stack:** TypeScript, Zod 4, Gemini Interactions API, GraphHopper Routing API, SQLite, Next.js route handlers, Vitest, mobile-first React/CSS.

---

### Task 1: Keep and verify the route engine

**Files:** `src/contracts/route.ts`, `src/lib/routing/*`, `tests/route-*`

Keep the existing typed GraphHopper provider, polygon geometry, deterministic route planner, fixture provider, and route-level tests. They are the lower-level engine used by every itinerary travel leg.

Run: `pnpm exec vitest run tests/route-contracts.test.ts tests/graphhopper.test.ts tests/route-planner.test.ts`

Expected: 12 tests pass without network access.

### Task 2: Add day-itinerary and conversation contracts

**Files:**

- Create: `src/contracts/itinerary.ts`
- Create: `src/contracts/conversation.ts`
- Create: `src/contracts/itinerary-api.ts`
- Modify: `src/contracts/index.ts`

Define typed `ItineraryStop`, `TravelLeg`, `DayItinerarySnapshot`, `ItineraryCommand`, `ConversationAgentOutput`, `ItineraryNotification`, `ItineraryUpdate`, `ConversationRun`, and API envelopes. Commands cover proposing a day, adding/removing/moving stops, starting the day, acknowledging an update, and asking for clarification. Do not preserve the former multi-day flight/lodging/slot hierarchy.

Test valid/invalid command unions, fixed versus flexible stops, active snapshots, notification payloads, and stale revision rejection.

### Task 3: Add Gemini conversation and notification agents

**Files:**

- Create: `src/lib/conversation/gemini.ts`
- Create: `src/lib/conversation/agent.ts`
- Create: `src/lib/conversation/fixtures.ts`
- Test: `tests/conversation.test.ts`

Use Gemini Interactions API `response_format.schema` for `ConversationAgentOutput` and `ItineraryNotification`. Gemini interprets natural-language user messages; it never directly produces routes. Fixture agents are test-only dependencies so deterministic e2e tests do not require a Gemini key. Schema failures are typed run failures and cannot mutate the itinerary.

### Task 4: Build the day-itinerary orchestrator and store

**Files:**

- Create: `src/lib/itinerary/planner.ts`
- Create: `src/lib/itinerary/store.ts`
- Create: `src/lib/itinerary/orchestrator.ts`
- Test: `tests/day-itinerary.test.ts`

Implement the flow: conversation command → typed snapshot mutation → GraphHopper route calculation for each adjacent stop pair → deterministic time/risk validation → revisioned snapshot. Fixed stops are never silently removed; flexible stops can be moved or marked for review. `start_navigation` changes the session to `active`.

### Task 5: Add conversation, live refresh, and notification APIs

**Files:**

- Create: `src/app/api/day-plans/route.ts`
- Create: `src/app/api/day-plans/[id]/route.ts`
- Create: `src/app/api/day-plans/[id]/messages/route.ts`
- Create: `src/app/api/day-plans/[id]/start/route.ts`
- Create: `src/app/api/day-plans/[id]/refresh/route.ts`
- Create: `src/app/api/day-plans/[id]/notifications/route.ts`
- Test: `tests/day-itinerary-api.test.ts`, `tests/day-itinerary-e2e.test.ts`

All itinerary creation and edits go through the message endpoint. `refresh` represents a polling/webhook/cron event and accepts typed simulated city signals for the MVP. A hard disruption immediately recalculates affected legs and produces a notification; fixed activities remain visible and impossible changes require confirmation. Persist notification content and evidence.

### Task 6: Replace the web surface with a mobile app simulation

**Files:**

- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/lib/itinerary.ts`
- Test: `tests/itinerary.test.ts`

Build a narrow mobile-first app shell with two phases:

- `DISCUSS`: conversation composer, Gemini messages, proposed stops, fixed/flexible labels, and `建立今日行程`.
- `LIVE`: `開始行程` state, current/next stop, leg status, city-condition notice, and `更新路線` action.

Use synthetic fixture data only for the demo display, but drive the state through the day-plan API. Preserve accessibility, loading, error, and notification states. Do not build a separate desktop dashboard.

### Task 7: Remove obsolete itinerary backend and verify

Delete the former Trip/Planner/Scheduler workflow, public trip APIs, and unused SSE chat path. Keep only the day-plan conversation API as the user-facing natural-language boundary. Remove Google Routes/old agent environment variables.

Run:

```bash
pnpm test -- --run
pnpm run lint
pnpm run build
```

The final deterministic e2e must prove: conversation creates a concert-day itinerary, Start activates it, a simulated flood/closure changes a later travel leg, and a typed notification plus new revision is returned.
