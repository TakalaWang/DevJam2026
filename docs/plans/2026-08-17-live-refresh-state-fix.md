# Live Refresh State Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep live refresh bounded when feeds have no actionable signals and resume active navigation only after a safe route update is acknowledged.

**Architecture:** The orchestrator treats an empty city-feed signal set as an observation-only check, preserving the current itinerary without invoking Google Routes again. Acknowledging a confirmation-required update changes `update_pending` to `active` only when no leg remains blocked.

**Tech Stack:** TypeScript, Zod, Vitest, SQLite-backed itinerary store.

---

### Task 1: Add regression coverage

**Files:**
- Modify: `tests/day-itinerary.test.ts`

Add tests for safe notification acknowledgement and empty-feed live refresh. Run the focused tests and confirm they fail before implementation.

### Task 2: Fix orchestrator state transitions

**Files:**
- Modify: `src/lib/itinerary/orchestrator.ts`

Validate live refresh state before fetching, record an observation-only run when no new signals exist, and acknowledge notifications into `active` only when the itinerary has no blocked legs.

### Task 3: Verify the full system

Run the complete test suite, lint, TypeScript, build, and local UI/API smoke checks. Confirm the working tree and remote state before reporting.
