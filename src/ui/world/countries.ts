import * as THREE from "three";
import { latLonToVector3, pointInPolygon, type CountryPolygon } from "./geo";

export type CountryOverlayAssets = {
  countryMeshes: THREE.Object3D[];
  countryPolygons: CountryPolygon[];
};

type BorderMaterials = {
  base: THREE.LineBasicMaterial;
  hover: THREE.LineBasicMaterial;
  stripe: THREE.LineBasicMaterial;
};

function isInsideCountryRings(lat: number, lon: number, rings: number[][][]): boolean {
  for (const ring of rings) {
    if (ring.length === 0) continue;
    if (pointInPolygon(lon, lat, ring)) return true;
  }
  return false;
}

function refineCrossingLon(
  lat: number,
  lonA: number,
  lonB: number,
  rings: number[][][],
  maxIterations = 12
): number {
  // Preconditions: isInsideCountryRings(lat, lonA) !== isInsideCountryRings(lat, lonB)
  let left = Math.min(lonA, lonB);
  let right = Math.max(lonA, lonB);
  let insideLeft = isInsideCountryRings(lat, left, rings);

  for (let i = 0; i < maxIterations; i++) {
    const mid = (left + right) / 2;
    const insideMid = isInsideCountryRings(lat, mid, rings);
    if (insideMid === insideLeft) left = mid;
    else right = mid;
  }

  return (left + right) / 2;
}

function addCountryStripes(
  rings: number[][][],
  group: THREE.Group,
  stripeMaterial: THREE.LineBasicMaterial
) {
  let minLat = 90;
  let maxLat = -90;

  for (const ring of rings) {
    for (const [, lat] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  if (minLat > maxLat) return;

  // Slightly denser sampling + refined endpoints so stripes meet the border.
  const latStep = 2.0;
  const lonStep = 1.6;
  // Match base border radius closely to reduce visible gaps.
  const stripeRadius = 1.01;
  const EPS = 1e-6;
  const LON_START = -180;
  const LON_END = 180;

  for (let lat = minLat; lat <= maxLat + EPS; lat += latStep) {
    let segmentPoints: THREE.Vector3[] = [];

    let prevLon = LON_START;
    let prevInside = isInsideCountryRings(lat, prevLon, rings);
    if (prevInside) {
      segmentPoints.push(latLonToVector3(lat, prevLon, stripeRadius));
    }

    for (
      let lon = LON_START + lonStep;
      lon <= LON_END + EPS;
      lon += lonStep
    ) {
      const inside = isInsideCountryRings(lat, lon, rings);

      if (inside && !prevInside) {
        // Entering: start the stripe at a refined border point.
        segmentPoints = [];
        const crossLon = refineCrossingLon(lat, prevLon, lon, rings);
        segmentPoints.push(latLonToVector3(lat, crossLon, stripeRadius));
        segmentPoints.push(latLonToVector3(lat, lon, stripeRadius));
      } else if (inside && prevInside) {
        // Continuing inside: extend with the sampled point.
        segmentPoints.push(latLonToVector3(lat, lon, stripeRadius));
      } else if (!inside && prevInside) {
        // Exiting: close stripe at a refined border point.
        const crossLon = refineCrossingLon(lat, prevLon, lon, rings);
        segmentPoints.push(latLonToVector3(lat, crossLon, stripeRadius));

        if (segmentPoints.length >= 2) {
          group.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(segmentPoints),
              stripeMaterial
            )
          );
        }
        segmentPoints = [];
      } // else: outside && outside => do nothing

      prevLon = lon;
      prevInside = inside;
    }

    // Handle a stripe that reaches the end of the scan.
    if (prevInside && segmentPoints.length >= 2) {
      group.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(segmentPoints),
          stripeMaterial
        )
      );
    }
  }
}

export async function loadCountryOverlays(
  container: THREE.Object3D,
  materials: BorderMaterials
): Promise<CountryOverlayAssets> {
  const countryMeshes: THREE.Object3D[] = [];
  const countryPolygons: CountryPolygon[] = [];

  const res = await fetch("/geojsons/admin1.geojson");
  if (!res.ok) throw new Error("Failed to load countries.geojson");
  const geojson = await res.json();

  for (const feature of geojson.features) {
    const regionName = feature.properties?.name || "Unknown region";
    const parentCountry =
      feature.properties?.admin ||
      feature.properties?.ADMIN ||
      "Unknown country";
    const displayName =
      regionName === parentCountry
        ? regionName
        : `${regionName} (${parentCountry})`;
    const polygonId = `${parentCountry}::${regionName}`;
    const geomType = feature.geometry.type;
    const coords = feature.geometry.coordinates;

    const group = new THREE.Group();
    group.userData.countryName = displayName;
    group.userData.polygonId = polygonId;

    const hoverGroup = new THREE.Group();
    hoverGroup.visible = false;
    group.userData.hoverGroup = hoverGroup;
    group.add(hoverGroup);

    const rings: number[][][] = [];

    const addPolygon = (polygonCoords: number[][]) => {
      const basePoints: THREE.Vector3[] = [];
      const hoverPoints: THREE.Vector3[] = [];
      for (const [lon, lat] of polygonCoords) {
        basePoints.push(latLonToVector3(lat, lon, 1.01));
        hoverPoints.push(latLonToVector3(lat, lon, 1.02));
      }

      const baseLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(basePoints),
        materials.base
      );
      baseLine.userData.countryName = displayName;
      group.add(baseLine);

      const hoverLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(hoverPoints),
        materials.hover
      );
      hoverLine.userData.countryName = displayName;
      hoverGroup.add(hoverLine);
    };

    if (geomType === "Polygon") {
      const polygonCoords = coords as number[][][];
      for (const ring of polygonCoords) {
        rings.push(ring);
        addPolygon(ring);
      }
    } else if (geomType === "MultiPolygon") {
      const multiPolygonCoords = coords as number[][][][];
      for (const poly of multiPolygonCoords) {
        for (const ring of poly) {
          rings.push(ring);
          addPolygon(ring);
        }
      }
    }

    addCountryStripes(rings, group, materials.stripe);
    container.add(group);
    countryMeshes.push(group);
    countryPolygons.push({
      id: polygonId,
      name: regionName,
      countryName: parentCountry,
      displayName,
      rings,
    });
  }

  return { countryMeshes, countryPolygons };
}
