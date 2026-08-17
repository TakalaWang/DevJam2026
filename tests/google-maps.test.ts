import { describe, expect, it } from "vitest";
import { buildGoogleMapsScriptUrl, hasGoogleMapsKey } from "../src/lib/google-maps";

describe("Google Maps browser loader", () => {
  it("builds the async weekly Maps JavaScript API URL", () => {
    expect(buildGoogleMapsScriptUrl("browser key")).toBe(
      "https://maps.googleapis.com/maps/api/js?key=browser%20key&v=weekly&loading=async&libraries=core,maps,marker&callback=__routaGoogleMapsReady",
    );
  });

  it("only treats a non-empty public key as configured", () => {
    expect(hasGoogleMapsKey(undefined)).toBe(false);
    expect(hasGoogleMapsKey("  ")).toBe(false);
    expect(hasGoogleMapsKey("browser-key")).toBe(true);
  });
});
