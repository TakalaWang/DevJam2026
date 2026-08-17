import { describe, expect, it } from "vitest";
import {
  ActivityDiscoveryAgentOutputSchema,
  AgentInputSchema,
  PlaceToolOutputSchema,
  RouteToolOutputSchema,
  TravelAgentOutputSchema,
} from "../src/contracts";
import { AdkAgentRuntime } from "../src/lib/workflow/adk";
import { TripStore } from "../src/lib/workflow/store";
import { runPlace, runRoute } from "../src/lib/workflow/tools";

const enabled = process.env.ROUTECRAFT_REAL_SMOKE === "1";
const hasGemini = Boolean(process.env.GEMINI_API_KEY);
const hasMapsKey = Boolean(process.env.GOOGLE_MAPS_API_KEY);

describe.skipIf(!enabled || !hasGemini)("real Google ADK smoke", () => {
  it("keeps a real Gemini Agent on the typed boundary", async () => {
    const store = new TripStore(":memory:");
    const trip = store.createTrip("real-smoke");
    const input = AgentInputSchema.parse({
      tripId: trip.id,
      userMessage: "我要安排台北旅遊，請先詢問我的抵達與離開時間。",
      snapshot: trip,
    });
    const output = await new AdkAgentRuntime(process.env.GEMINI_API_KEY!).run(
      "travel_boundary",
      input,
      TravelAgentOutputSchema,
    );
    expect(TravelAgentOutputSchema.parse(output).message).toBeTypeOf("string");
    store.close();
  }, 120_000);

  it("runs ADK Google Search research into the typed activity formatter", async () => {
    const store = new TripStore(":memory:");
    const trip = store.createTrip("real-activity-search");
    const input = AgentInputSchema.parse({
      tripId: trip.id,
      userMessage:
        "請使用 Google Search 查詢台北101官方網站，再推薦一個景點，並把來源放入 evidence。",
      snapshot: trip,
    });
    const output = await new AdkAgentRuntime(process.env.GEMINI_API_KEY!).run(
      "activity_discovery",
      input,
      ActivityDiscoveryAgentOutputSchema,
    );
    expect(
      ActivityDiscoveryAgentOutputSchema.parse(output).evidence.some(
        ({ kind }) => kind === "search",
      ),
    ).toBe(true);
    store.close();
  }, 120_000);
});

describe.skipIf(!enabled || !hasMapsKey)("real Google Maps tools smoke", () => {
  it("keeps Routes and Places on typed boundaries", async () => {
    const [route, place] = await Promise.all([
      runRoute({ origin: "台北車站", destination: "台北101" }),
      runPlace({ query: "台北101" }),
    ]);
    expect(RouteToolOutputSchema.parse(route).status).toBe("ok");
    expect(PlaceToolOutputSchema.parse(place).status).toBe("ok");
  });
});
