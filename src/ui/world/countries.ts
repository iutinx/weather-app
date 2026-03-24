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

  const latStep = 2.25;
  const lonStep = 1.75;
  const stripeRadius = 1.011;

  for (let lat = minLat; lat <= maxLat; lat += latStep) {
    const stripePoints: THREE.Vector3[] = [];
    let hasSegment = false;

    for (let lon = -180; lon <= 180; lon += lonStep) {
      if (isInsideCountryRings(lat, lon, rings)) {
        stripePoints.push(latLonToVector3(lat, lon, stripeRadius));
        hasSegment = true;
      } else if (hasSegment && stripePoints.length >= 2) {
        group.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(stripePoints),
            stripeMaterial
          )
        );
        stripePoints.length = 0;
        hasSegment = false;
      } else {
        stripePoints.length = 0;
        hasSegment = false;
      }
    }

    if (hasSegment && stripePoints.length >= 2) {
      group.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(stripePoints),
          stripeMaterial
        )
      );
    }
  }
}

export async function loadCountryOverlays(
  scene: THREE.Scene,
  materials: BorderMaterials
): Promise<CountryOverlayAssets> {
  const countryMeshes: THREE.Object3D[] = [];
  const countryPolygons: CountryPolygon[] = [];

  const res = await fetch("/geojsons/mediumcountries.geojson");
  if (!res.ok) throw new Error("Failed to load countries.geojson");
  const geojson = await res.json();

  for (const feature of geojson.features) {
    const name =
      feature.properties?.ADMIN || feature.properties?.name || "Unknown country";
    const geomType = feature.geometry.type;
    const coords = feature.geometry.coordinates;

    const group = new THREE.Group();
    group.userData.countryName = name;

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
      baseLine.userData.countryName = name;
      group.add(baseLine);

      const hoverLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(hoverPoints),
        materials.hover
      );
      hoverLine.userData.countryName = name;
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
    scene.add(group);
    countryMeshes.push(group);
    countryPolygons.push({ name, rings });
  }

  return { countryMeshes, countryPolygons };
}
