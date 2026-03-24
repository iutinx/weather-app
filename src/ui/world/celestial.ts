import * as THREE from "three";

function createSunTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, size * 0.08, c, c, size * 0.5);
  grad.addColorStop(0, "#fffde7");
  grad.addColorStop(0.35, "#ffe082");
  grad.addColorStop(0.7, "#ffb300");
  grad.addColorStop(1, "#ff6f00");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 160; i++) {
    const y = Math.random() * size;
    const h = 1 + Math.random() * 3;
    const a = 0.03 + Math.random() * 0.06;
    ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    ctx.fillRect(0, y, size, h);
  }

  return new THREE.CanvasTexture(canvas);
}

function createMoonTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const c = size / 2;
  const base = ctx.createRadialGradient(c, c, size * 0.1, c, c, size * 0.5);
  base.addColorStop(0, "#f3f5f9");
  base.addColorStop(0.7, "#c9d2df");
  base.addColorStop(1, "#8d99ab");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 28; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 8 + Math.random() * 26;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(120, 132, 150, ${0.12 + Math.random() * 0.18})`;
    ctx.fill();
  }

  return new THREE.CanvasTexture(canvas);
}

function getDayOfYearUTC(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const now = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
  return Math.floor((now - start) / 86400000);
}

export class CelestialSystem {
  private sunLight: THREE.DirectionalLight;
  private moonLight: THREE.DirectionalLight;
  private sunMesh: THREE.Mesh;
  private moonMesh: THREE.Mesh;
  private ambientLight: THREE.AmbientLight;
  private lastCelestialUpdateMs = 0;
  private readonly celestialUpdateIntervalMs = 15000;

  constructor(private scene: THREE.Scene) {
    this.ambientLight = new THREE.AmbientLight(0x8ea8ff, 0.25);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xfff3cf, 1.15);
    this.scene.add(this.sunLight);

    this.moonLight = new THREE.DirectionalLight(0x8fb8ff, 0.2);
    this.scene.add(this.moonLight);

    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 36, 36),
      new THREE.MeshStandardMaterial({
        map: createSunTexture(),
        emissive: 0xffb347,
        emissiveIntensity: 0.55,
        roughness: 0.9,
        metalness: 0,
      })
    );
    this.scene.add(this.sunMesh);

    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 32, 32),
      new THREE.MeshStandardMaterial({
        map: createMoonTexture(),
        roughness: 0.95,
        metalness: 0,
      })
    );
    this.scene.add(this.moonMesh);

    this.update(true);
  }

  update(force = false) {
    const now = Date.now();
    if (!force && now - this.lastCelestialUpdateMs < this.celestialUpdateIntervalMs) {
      return;
    }
    this.lastCelestialUpdateMs = now;

    const date = new Date();
    const secondsUTC =
      date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
    const dayOfYear = getDayOfYearUTC(date);

    const seasonalTiltDeg =
      23.44 * Math.sin(((2 * Math.PI) / 365.25) * (dayOfYear - 80));
    const sunDeclination = THREE.MathUtils.degToRad(seasonalTiltDeg);
    const sunHourAngle = (secondsUTC / 86400) * 2 * Math.PI - Math.PI;

    const sunOrbitRadius = 6;
    const sunPos = new THREE.Vector3(
      Math.cos(sunHourAngle) * sunOrbitRadius,
      Math.sin(sunDeclination) * sunOrbitRadius,
      Math.sin(sunHourAngle) * sunOrbitRadius
    );

    const moonPhaseShift = (dayOfYear * 0.0366) % (2 * Math.PI);
    const moonHourAngle = sunHourAngle - moonPhaseShift - THREE.MathUtils.degToRad(15);
    const moonDeclination = sunDeclination * 0.55 + THREE.MathUtils.degToRad(5);
    const moonRadius = 6.8;
    const moonPos = new THREE.Vector3(
      Math.cos(moonHourAngle) * moonRadius,
      Math.sin(moonDeclination) * moonRadius,
      Math.sin(moonHourAngle) * moonRadius
    );

    this.sunLight.position.copy(sunPos);
    this.sunMesh.position.copy(sunPos);
    this.moonLight.position.copy(moonPos);
    this.moonMesh.position.copy(moonPos);
  }
}
