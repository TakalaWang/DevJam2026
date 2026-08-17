import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  AgentRunSchema,
  type AgentRun,
  TripSnapshotSchema,
  type TripSnapshot,
} from "../../contracts";

type TripRow = { state_json: string };
type RunRow = { state_json: string };

export class TripStore {
  private readonly database: DatabaseSync;

  constructor(path = process.env.ROUTECRAFT_DB_PATH ?? ".data/routecraft.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS trips (
        id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (trip_id) REFERENCES trips(id)
      );
    `);
  }

  createTrip(userId: string): TripSnapshot {
    const now = new Date().toISOString();
    const snapshot = TripSnapshotSchema.parse({
      id: randomUUID(),
      userId,
      status: "intake",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      profile: {},
      travelCandidates: [],
      days: [],
      currentDayIndex: 0,
      evidence: [],
    });
    this.database
      .prepare("INSERT INTO trips (id, state_json, revision, updated_at) VALUES (?, ?, ?, ?)")
      .run(snapshot.id, JSON.stringify(snapshot), snapshot.revision, snapshot.updatedAt);
    return snapshot;
  }

  getTrip(id: string): TripSnapshot | undefined {
    const row = this.database.prepare("SELECT state_json FROM trips WHERE id = ?").get(id) as
      TripRow | undefined;
    return row ? TripSnapshotSchema.parse(JSON.parse(row.state_json)) : undefined;
  }

  saveTrip(snapshot: TripSnapshot): TripSnapshot {
    const current = this.getTrip(snapshot.id);
    if (!current) throw new Error("找不到旅程");
    if (current.revision !== snapshot.revision) throw new Error("旅程已被其他執行修改，請重新載入");

    const next = TripSnapshotSchema.parse({
      ...snapshot,
      revision: snapshot.revision + 1,
      updatedAt: new Date().toISOString(),
    });
    const result = this.database
      .prepare(
        "UPDATE trips SET state_json = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?",
      )
      .run(JSON.stringify(next), next.revision, next.updatedAt, next.id, snapshot.revision);
    if (Number(result.changes) !== 1) throw new Error("旅程更新失敗");
    return next;
  }

  createRun(tripId: string, inputType: string): AgentRun {
    const run = AgentRunSchema.parse({
      id: randomUUID(),
      tripId,
      status: "queued",
      inputType,
      createdAt: new Date().toISOString(),
    });
    this.database
      .prepare("INSERT INTO runs (id, trip_id, state_json, created_at) VALUES (?, ?, ?, ?)")
      .run(run.id, run.tripId, JSON.stringify(run), run.createdAt);
    return run;
  }

  saveRun(run: AgentRun): AgentRun {
    const parsed = AgentRunSchema.parse(run);
    this.database
      .prepare("UPDATE runs SET state_json = ? WHERE id = ?")
      .run(JSON.stringify(parsed), parsed.id);
    return parsed;
  }

  getRun(id: string): AgentRun | undefined {
    const row = this.database.prepare("SELECT state_json FROM runs WHERE id = ?").get(id) as
      RunRow | undefined;
    return row ? AgentRunSchema.parse(JSON.parse(row.state_json)) : undefined;
  }

  getLatestRun(tripId: string): AgentRun | undefined {
    const row = this.database
      .prepare("SELECT state_json FROM runs WHERE trip_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(tripId) as RunRow | undefined;
    return row ? AgentRunSchema.parse(JSON.parse(row.state_json)) : undefined;
  }

  close(): void {
    this.database.close();
  }
}

export const tripStore = new TripStore();
