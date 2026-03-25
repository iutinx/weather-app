import * as THREE from "three";

/** Distant point stars on a thin spherical shell, centered on the globe. */
export function createStarfield(count = 3200, radius = 1000): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.sin(phi) * Math.sin(theta);
    const z = Math.cos(phi);
    const d = radius * (0.9 + Math.random() * 0.1);
    positions[i * 3] = x * d;
    positions[i * 3 + 1] = y * d;
    positions[i * 3 + 2] = z * d;

    const bright = 0.55 + Math.random() * 0.45;
    const cool = 0.9 + Math.random() * 0.1;
    colors[i * 3] = bright * cool;
    colors[i * 3 + 1] = bright * 0.97 * cool;
    colors[i * 3 + 2] = bright * Math.min(1, cool * 1.06);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 1.32,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    sizeAttenuation: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const stars = new THREE.Points(geometry, material);
  stars.name = "starfield";
  stars.frustumCulled = false;
  return stars;
}
