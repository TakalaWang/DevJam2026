export type GoogleLatLngLiteral = { lat: number; lng: number };

export interface GoogleMapInstance {
  fitBounds(bounds: GoogleLatLngBoundsInstance, padding?: number): void;
}

export interface GooglePolylineInstance {
  setMap(map: GoogleMapInstance | null): void;
}

export interface GoogleMarkerInstance {
  setMap(map: GoogleMapInstance | null): void;
  setPosition(position: GoogleLatLngLiteral): void;
}

export interface GoogleLatLngBoundsInstance {
  extend(point: GoogleLatLngLiteral): void;
}

export interface GoogleMapsNamespace {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
  Polyline: new (options: Record<string, unknown>) => GooglePolylineInstance;
  Marker: new (options: Record<string, unknown>) => GoogleMarkerInstance;
  LatLngBounds: new () => GoogleLatLngBoundsInstance;
}

type GoogleMapsLibraryName = "core" | "maps" | "marker";

type GoogleMapsLibraryExports = {
  Map?: GoogleMapsNamespace["Map"];
  Polyline?: GoogleMapsNamespace["Polyline"];
  Marker?: GoogleMapsNamespace["Marker"];
  AdvancedMarkerElement?: new (options: Record<string, unknown>) => {
    map?: GoogleMapInstance | null;
    position?: GoogleLatLngLiteral;
  };
  LatLngBounds?: GoogleMapsNamespace["LatLngBounds"];
};

type GoogleMapsRawNamespace = GoogleMapsLibraryExports & {
  importLibrary?: (libraryName: GoogleMapsLibraryName) => Promise<GoogleMapsLibraryExports>;
};

type GoogleMapsGlobal = {
  google?: { maps?: GoogleMapsRawNamespace };
  __routaGoogleMapsReady?: () => void;
};

let googleMapsPromise: Promise<GoogleMapsNamespace> | undefined;

export function hasGoogleMapsKey(apiKey: string | undefined): apiKey is string {
  return Boolean(apiKey?.trim());
}

export function buildGoogleMapsScriptUrl(apiKey: string): string {
  if (!hasGoogleMapsKey(apiKey)) throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 未設定");
  return `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&libraries=core,maps,marker&callback=__routaGoogleMapsReady`;
}

function loadedGoogleMaps(): GoogleMapsRawNamespace | undefined {
  return (globalThis as GoogleMapsGlobal).google?.maps;
}

async function hydrateGoogleMaps(rawMaps: GoogleMapsRawNamespace): Promise<GoogleMapsNamespace> {
  if (rawMaps.Map && rawMaps.Polyline && rawMaps.Marker && rawMaps.LatLngBounds) {
    return rawMaps as GoogleMapsNamespace;
  }

  const [mapsLibrary, coreLibrary, markerLibrary] = rawMaps.importLibrary
    ? await Promise.all([
        rawMaps.importLibrary("maps"),
        rawMaps.importLibrary("core"),
        rawMaps.importLibrary("marker"),
      ])
    : [{}, {}, {}];
  const markerConstructor =
    markerLibrary.Marker ??
    rawMaps.Marker ??
    (markerLibrary.AdvancedMarkerElement
      ? class AdvancedMarkerAdapter implements GoogleMarkerInstance {
          private readonly marker: {
            map?: GoogleMapInstance | null;
            position?: GoogleLatLngLiteral;
          };

          constructor(options: Record<string, unknown>) {
            this.marker = new markerLibrary.AdvancedMarkerElement!(options);
          }

          setMap(map: GoogleMapInstance | null) {
            this.marker.map = map;
          }

          setPosition(position: GoogleLatLngLiteral) {
            this.marker.position = position;
          }
        }
      : undefined);
  const maps = {
    Map: mapsLibrary.Map ?? rawMaps.Map,
    Polyline: mapsLibrary.Polyline ?? rawMaps.Polyline,
    Marker: markerConstructor,
    LatLngBounds: coreLibrary.LatLngBounds ?? rawMaps.LatLngBounds,
  };

  if (!maps.Map || !maps.Polyline || !maps.Marker || !maps.LatLngBounds) {
    throw new Error("Google Maps libraries 載入不完整，請確認 Maps JavaScript API 已啟用");
  }
  return maps as GoogleMapsNamespace;
}

export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsNamespace> {
  if (!hasGoogleMapsKey(apiKey)) {
    return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 未設定"));
  }

  const loaded = loadedGoogleMaps();
  if (loaded) return hydrateGoogleMaps(loaded);
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Google Maps 只能在瀏覽器載入"));
  }
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise<GoogleMapsNamespace>((resolve, reject) => {
    const existing = document.getElementById(
      "google-maps-javascript-api",
    ) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const maps = loadedGoogleMaps();
      if (!maps) {
        reject(new Error("Google Maps JavaScript API 載入後找不到 maps namespace"));
        return;
      }
      void hydrateGoogleMaps(maps).then(resolve, reject);
    };
    (globalThis as GoogleMapsGlobal).__routaGoogleMapsReady = finish;

    script.addEventListener(
      "error",
      () => reject(new Error("Google Maps JavaScript API 載入失敗，請檢查 key、限制與 billing")),
      { once: true },
    );
    if (!existing) {
      script.id = "google-maps-javascript-api";
      script.async = true;
      script.defer = true;
      script.src = buildGoogleMapsScriptUrl(apiKey);
      document.head.appendChild(script);
    }
  }).catch((error) => {
    googleMapsPromise = undefined;
    throw error;
  });

  return googleMapsPromise;
}
