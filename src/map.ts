export type LatLng = [number, number];

export const DEMO_POINTS: Record<string, LatLng> = {
  "台北車站": [25.0478, 121.517],
  "台北 101": [25.0339, 121.5645],
  "大稻埕": [25.0567, 121.5101],
  "內湖科技園區": [25.0806, 121.572],
};

export function pointFor(name: string): LatLng {
  return DEMO_POINTS[name] ?? [25.0478, 121.5319];
}

export function decodePolyline(encoded?: string): LatLng[] {
  if (!encoded) return [];
  const points: LatLng[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const values: number[] = [];
    for (let axis = 0; axis < 2; axis += 1) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      values.push((result & 1) ? ~(result >> 1) : result >> 1);
    }
    latitude += values[0];
    longitude += values[1];
    points.push([latitude / 1e5, longitude / 1e5]);
  }
  return points;
}
