import type { Coordinate, RiskPolygon } from "../../contracts";

function orientation(a: Coordinate, b: Coordinate, c: Coordinate): number {
  return (
    (b.longitude - a.longitude) * (c.latitude - a.latitude) -
    (b.latitude - a.latitude) * (c.longitude - a.longitude)
  );
}

function onSegment(a: Coordinate, b: Coordinate, c: Coordinate): boolean {
  return (
    Math.min(a.longitude, c.longitude) <= b.longitude &&
    b.longitude <= Math.max(a.longitude, c.longitude) &&
    Math.min(a.latitude, c.latitude) <= b.latitude &&
    b.latitude <= Math.max(a.latitude, c.latitude)
  );
}

function segmentsIntersect(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  const epsilon = 1e-10;

  if (
    ((first > epsilon && second < -epsilon) || (first < -epsilon && second > epsilon)) &&
    ((third > epsilon && fourth < -epsilon) || (third < -epsilon && fourth > epsilon))
  )
    return true;
  if (Math.abs(first) <= epsilon && onSegment(a, c, b)) return true;
  if (Math.abs(second) <= epsilon && onSegment(a, d, b)) return true;
  if (Math.abs(third) <= epsilon && onSegment(c, a, d)) return true;
  return Math.abs(fourth) <= epsilon && onSegment(c, b, d);
}

export function pointInPolygon(point: Coordinate, polygon: RiskPolygon): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index];
    const prior = polygon[previous];
    if (!current || !prior) continue;
    const crosses =
      current.latitude > point.latitude !== prior.latitude > point.latitude &&
      point.longitude <
        ((prior.longitude - current.longitude) * (point.latitude - current.latitude)) /
          (prior.latitude - current.latitude) +
          current.longitude;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function routeIntersectsPolygon(route: Coordinate[], polygon: RiskPolygon): boolean {
  if (route.some((point) => pointInPolygon(point, polygon))) return true;
  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    if (!start || !end) continue;
    for (let edge = 1; edge < polygon.length; edge += 1) {
      const polygonStart = polygon[edge - 1];
      const polygonEnd = polygon[edge];
      if (polygonStart && polygonEnd && segmentsIntersect(start, end, polygonStart, polygonEnd)) {
        return true;
      }
    }
  }
  return false;
}

function bounds(polygon: RiskPolygon) {
  return polygon.reduce(
    (result, point) => ({
      minLatitude: Math.min(result.minLatitude, point.latitude),
      maxLatitude: Math.max(result.maxLatitude, point.latitude),
      minLongitude: Math.min(result.minLongitude, point.longitude),
      maxLongitude: Math.max(result.maxLongitude, point.longitude),
    }),
    {
      minLatitude: Number.POSITIVE_INFINITY,
      maxLatitude: Number.NEGATIVE_INFINITY,
      minLongitude: Number.POSITIVE_INFINITY,
      maxLongitude: Number.NEGATIVE_INFINITY,
    },
  );
}

export function createDetourWaypointPairs(
  polygon: RiskPolygon,
  origin: Coordinate,
  destination: Coordinate,
): Coordinate[][] {
  if (pointInPolygon(origin, polygon) || pointInPolygon(destination, polygon)) return [];
  const box = bounds(polygon);
  const span = Math.max(
    box.maxLatitude - box.minLatitude,
    box.maxLongitude - box.minLongitude,
    0.001,
  );
  const pairsForMargin = (factor: number): Coordinate[][] => {
    const margin = span * factor;
    const north = box.maxLatitude + margin;
    const south = box.minLatitude - margin;
    const west = box.minLongitude - margin;
    const east = box.maxLongitude + margin;
    return [
      [
        { latitude: south, longitude: west },
        { latitude: south, longitude: east },
      ],
      [
        { latitude: north, longitude: east },
        { latitude: north, longitude: west },
      ],
      [
        { latitude: north, longitude: west },
        { latitude: south, longitude: west },
      ],
      [
        { latitude: south, longitude: east },
        { latitude: north, longitude: east },
      ],
    ];
  };
  const inner = pairsForMargin(0.25);
  const outer = pairsForMargin(0.75);
  return [
    inner[0] ?? [],
    outer[0] ?? [],
    inner[1] ?? [],
    outer[1] ?? [],
    inner[2] ?? [],
    outer[2] ?? [],
    inner[3] ?? [],
    outer[3] ?? [],
  ].filter((pair) => pair.length > 0);
}

export function createCombinedDetourWaypointPairs(
  polygons: RiskPolygon[],
  origin: Coordinate,
  destination: Coordinate,
): Coordinate[][] {
  const points = polygons.flat();
  if (!points.length) return [];
  const box = points.reduce(
    (result, point) => ({
      minLatitude: Math.min(result.minLatitude, point.latitude),
      maxLatitude: Math.max(result.maxLatitude, point.latitude),
      minLongitude: Math.min(result.minLongitude, point.longitude),
      maxLongitude: Math.max(result.maxLongitude, point.longitude),
    }),
    {
      minLatitude: Number.POSITIVE_INFINITY,
      maxLatitude: Number.NEGATIVE_INFINITY,
      minLongitude: Number.POSITIVE_INFINITY,
      maxLongitude: Number.NEGATIVE_INFINITY,
    },
  );
  const envelope: RiskPolygon = [
    { latitude: box.minLatitude, longitude: box.minLongitude },
    { latitude: box.minLatitude, longitude: box.maxLongitude },
    { latitude: box.maxLatitude, longitude: box.maxLongitude },
    { latitude: box.maxLatitude, longitude: box.minLongitude },
    { latitude: box.minLatitude, longitude: box.minLongitude },
  ];
  return createDetourWaypointPairs(envelope, origin, destination);
}
