import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  ConversationRunSchema,
  DayItinerarySnapshotSchema,
  type ConversationRun,
  type DayItinerarySnapshot,
} from "../../contracts";

type SnapshotRow = { state_json: string };
type RunRow = { state_json: string };

function parseStoredSnapshot(stateJson: string): DayItinerarySnapshot {
  const raw = JSON.parse(stateJson) as {
    legs?: Array<{ route?: { provider?: string } }>;
  };

  // Older local databases used `google_routes` before the route contract was
  // simplified to the single Google provider. Keep those local sessions
  // readable after an app update instead of failing the entire plan listing.
  if (Array.isArray(raw.legs)) {
    for (const leg of raw.legs) {
      if (leg.route?.provider === "google_routes" || leg.route?.provider === "graphhopper") {
        leg.route.provider = "google";
      }
    }
  }

  return DayItinerarySnapshotSchema.parse(raw);
}

export class ItineraryStore {
  private readonly database: DatabaseSync;

  constructor(path = process.env.ROUTECRAFT_DB_PATH ?? ".data/routecraft-local.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS day_itineraries (
        id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS itinerary_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES day_itineraries(id)
      );
    `);
  }

  createSession(userId: string, date: string): DayItinerarySnapshot {
    const now = new Date().toISOString();
    const snapshot = DayItinerarySnapshotSchema.parse({
      id: randomUUID(),
      userId,
      status: "discussing",
      revision: 0,
      date,
      profiles: ["car", "bike", "foot"],
      returnHome: true,
      stops: [],
      legs: [],
      signals: [],
      notifications: [],
      createdAt: now,
      updatedAt: now,
    });
    this.database
      .prepare(
        "INSERT INTO day_itineraries (id, state_json, revision, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(snapshot.id, JSON.stringify(snapshot), snapshot.revision, snapshot.updatedAt);
    return snapshot;
  }

  getSession(id: string): DayItinerarySnapshot | undefined {
    const row = this.database
      .prepare("SELECT state_json FROM day_itineraries WHERE id = ?")
      .get(id) as SnapshotRow | undefined;
    return row ? parseStoredSnapshot(row.state_json) : undefined;
  }

  listSessions(userId: string): DayItinerarySnapshot[] {
    const rows = this.database
      .prepare(
        "SELECT state_json FROM day_itineraries WHERE json_extract(state_json, '$.userId') = ? ORDER BY updated_at DESC",
      )
      .all(userId) as SnapshotRow[];
    return rows.map((row) => parseStoredSnapshot(row.state_json));
  }

  deleteSession(id: string): boolean {
    this.database.prepare("DELETE FROM itinerary_runs WHERE session_id = ?").run(id);
    const result = this.database.prepare("DELETE FROM day_itineraries WHERE id = ?").run(id);
    return Number(result.changes) === 1;
  }

  saveSession(rawSnapshot: DayItinerarySnapshot): DayItinerarySnapshot {
    const snapshot = DayItinerarySnapshotSchema.parse(rawSnapshot);
    const current = this.getSession(snapshot.id);
    if (!current) throw new Error("找不到一天行程 session");
    if (current.revision !== snapshot.revision) throw new Error("一天行程已被其他執行修改");
    const next = DayItinerarySnapshotSchema.parse({
      ...snapshot,
      revision: snapshot.revision + 1,
      updatedAt: new Date().toISOString(),
    });
    const result = this.database
      .prepare(
        "UPDATE day_itineraries SET state_json = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?",
      )
      .run(JSON.stringify(next), next.revision, next.updatedAt, next.id, snapshot.revision);
    if (Number(result.changes) !== 1) throw new Error("一天行程更新失敗");
    return next;
  }

  createRun(sessionId: string, userMessage: string): ConversationRun {
    const run = ConversationRunSchema.parse({
      id: randomUUID(),
      sessionId,
      userMessage,
      status: "queued",
      createdAt: new Date().toISOString(),
    });
    this.database
      .prepare(
        "INSERT INTO itinerary_runs (id, session_id, state_json, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(run.id, run.sessionId, JSON.stringify(run), run.createdAt);
    return run;
  }

  saveRun(rawRun: ConversationRun): ConversationRun {
    const run = ConversationRunSchema.parse(rawRun);
    this.database
      .prepare("UPDATE itinerary_runs SET state_json = ? WHERE id = ?")
      .run(JSON.stringify(run), run.id);
    return run;
  }

  getLatestRun(sessionId: string): ConversationRun | undefined {
    const row = this.database
      .prepare(
        "SELECT state_json FROM itinerary_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(sessionId) as RunRow | undefined;
    return row ? ConversationRunSchema.parse(JSON.parse(row.state_json)) : undefined;
  }

  getRuns(sessionId: string): ConversationRun[] {
    const rows = this.database
      .prepare("SELECT state_json FROM itinerary_runs WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as RunRow[];
    return rows.map((row) => ConversationRunSchema.parse(JSON.parse(row.state_json)));
  }

  close(): void {
    this.database.close();
  }
}
