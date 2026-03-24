import * as THREE from "three";

export type CountryPolygon = { name: string; rings: number[][][] };

export function latLonToVector3(
  lat: number,
  lon: number,
  radius: number
): THREE.Vector3 {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;

  const x = -radius * Math.cos(latRad) * Math.cos(lonRad);
  const z = radius * Math.cos(latRad) * Math.sin(lonRad);
  const y = radius * Math.sin(latRad);

  return new THREE.Vector3(x, y, z);
}

export function pointInPolygon(
  lon: number,
  lat: number,
  polygon: number[][]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

export function findCountryAtLatLon(
  countries: CountryPolygon[],
  lat: number,
  lon: number
): string | null {
  for (const country of countries) {
    for (const ring of country.rings) {
      if (ring.length === 0) continue;
      if (pointInPolygon(lon, lat, ring)) return country.name;
    }
  }
  return null;
}

export function getCountryCenter(
  countries: CountryPolygon[],
  countryName: string
): { lat: number; lon: number } | null {
  const poly = countries.find((c) => c.name === countryName);
  if (!poly) return null;

  let sumLat = 0;
  let sumLon = 0;
  let count = 0;

  for (const ring of poly.rings) {
    for (const [lon, lat] of ring) {
      sumLat += lat;
      sumLon += lon;
      count++;
    }
  }

  if (!count) return null;
  return { lat: sumLat / count, lon: sumLon / count };
}
