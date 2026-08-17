import { describe, expect, it, vi } from "vitest";
import {
  buildGoogleMapsScriptUrl,
  hasGoogleMapsKey,
  loadGoogleMaps,
} from "../src/lib/google-maps";

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

  it("waits for the API callback after the script load event", async () => {
    const listeners = new Map<string, () => void>();
    const MapConstructor = class {};
    const PolylineConstructor = class {};
    const MarkerConstructor = class {};
    const LatLngBoundsConstructor = class {};
    const script = {
      addEventListener(type: string, listener: () => void) {
        listeners.set(type, listener);
      },
    } as unknown as HTMLScriptElement;
    const document = {
      createElement: () => script,
      getElementById: () => null,
      head: {
        appendChild: () => {
          listeners.get("load")?.();
          vi.stubGlobal("google", {
            maps: {
              Map: MapConstructor,
              Polyline: PolylineConstructor,
              Marker: MarkerConstructor,
              LatLngBounds: LatLngBoundsConstructor,
            },
          });
          (globalThis as { __routaGoogleMapsReady?: () => void }).__routaGoogleMapsReady?.();
        },
      },
    };

    vi.stubGlobal("document", document);
    try {
      const maps = await loadGoogleMaps("browser-key");
      expect(maps.Map).toBe(MapConstructor);
      expect(maps.Polyline).toBe(PolylineConstructor);
      expect(maps.Marker).toBe(MarkerConstructor);
      expect(maps.LatLngBounds).toBe(LatLngBoundsConstructor);
    } finally {
      delete (globalThis as { __routaGoogleMapsReady?: () => void }).__routaGoogleMapsReady;
      vi.unstubAllGlobals();
    }
  });
});
