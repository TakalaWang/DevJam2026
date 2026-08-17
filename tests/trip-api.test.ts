import { describe, expect, it } from "vitest";
import { POST as createTrip } from "../src/app/api/trips/route";
import { GET as getTrip } from "../src/app/api/trips/[id]/route";
import { POST as inputTrip } from "../src/app/api/trips/[id]/input/route";
import { TripResponseSchema } from "../src/contracts";

function request(body: unknown): Request {
  return new Request("http://localhost/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("typed trip API", () => {
  it("creates and reads a Zod-validated trip snapshot", async () => {
    const created = await createTrip(request({ userId: "api-test" }));
    expect(created.status).toBe(200);
    const body = TripResponseSchema.parse(await created.json());

    const read = await getTrip(new Request("http://localhost/api/trips/test"), {
      params: Promise.resolve({ id: body.trip.id }),
    });
    expect(read.status).toBe(200);
    expect(TripResponseSchema.parse(await read.json()).trip.id).toBe(body.trip.id);
  });

  it("rejects malformed internal workflow commands before execution", async () => {
    const response = await inputTrip(request({ type: "message", message: "" }), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "旅程輸入格式錯誤" });
  });
});
