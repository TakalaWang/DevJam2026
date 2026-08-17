# Local Day Workbench Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn Routecraft into a local-only web workbench where users create dated day plans, discuss a complete leave-home-to-return-home itinerary with Gemini, then run a demo live-monitor workflow that updates transport and routes with notifications until completion.

**Architecture:** SQLite owns dated day-plan snapshots, conversation runs, history listing, and deletion. Gemini Interactions API emits typed planning commands and readiness; deterministic GraphHopper planning creates every travel leg, including the return-home leg. A local demo monitor submits typed city events through the same refresh path used by future polling or webhooks.

**Tech Stack:** Next.js local app, React, Gemini Interactions API, Zod 4, SQLite, GraphHopper, Vitest.

---

### Task 1: Extend typed day-plan contracts

Modify `src/contracts/itinerary.ts`, `src/contracts/conversation.ts`, and `src/contracts/itinerary-api.ts`.

Add required plan date, `returnHome`, typed planning readiness, `complete_navigation`, history summaries, list/delete responses, and demo event requests. Keep all route and notification payloads Zod-validated.

Update contract tests for date creation, readiness, return-home legs, completion, invalid payloads, and list/delete envelopes.

### Task 2: Persist history and conversation runs

Modify `src/lib/itinerary/store.ts` and `src/lib/itinerary/orchestrator.ts`.

Create dated sessions, list sessions for a local user, delete a session and its runs, and return all typed runs for restoring the center conversation. Apply LLM readiness to snapshot status, preserve active plans when users continue discussing, and support completion.

### Task 3: Plan the complete day and demo monitor

Modify `src/lib/itinerary/planner.ts` and `src/lib/conversation/fixtures.ts`.

Build origin → every stop → origin legs when `returnHome` is true. Add a fixture command for completion and a deterministic local event sequence for flood/closure/service disruption demos. Fixed activities remain fixed; flexible stops and future legs can update.

### Task 4: Add local history and lifecycle APIs

Modify `src/app/api/day-plans/route.ts` and add the delete, complete, and demo-monitor handlers.

Expose typed GET list, POST create-with-date, GET detail-with-runs, DELETE, message, start, demo refresh, complete, and notification endpoints. No public deployment or auth layer is added.

### Task 5: Replace the page with a local three-pane workbench

Modify `src/app/page.tsx` and `src/app/globals.css`.

Use a desktop web layout for local development: left history sidebar, center Gemini discussion, right current detailed itinerary. Require date creation before chat, show a readiness message and Start button only when the typed plan is ready, render every transport leg including return home, allow discussion after start, show live monitor status, and expose demo update/complete controls. Collapse to a usable one-column layout on small screens.

### Task 6: Verify the complete demo workflow

Add/update tests for list/delete, dated creation, conversation readiness, all travel legs, start, disruption notification, route change, and completion. Run `pnpm test -- --run`, `pnpm run lint`, `pnpm run format:check`, `pnpm run build`, and local browser checks for create → discuss → start → demo update → complete.
