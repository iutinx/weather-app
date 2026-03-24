import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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
  private sunObject: THREE.Group;
  private sunCoreMesh: THREE.Mesh;
  private sunFlare: THREE.Sprite;
  private moonObject: THREE.Group;
  private moonCoreMesh: THREE.Mesh;
  private moonFlare: THREE.Sprite;
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

    this.sunCoreMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 36, 36),
      new THREE.MeshStandardMaterial({
        map: createSunTexture(),
        emissive: 0xffb347,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.28,
        roughness: 0.9,
        metalness: 0,
      })
    );
    this.sunObject = new THREE.Group();
    this.sunObject.add(this.sunCoreMesh);

    const flareCanvas = document.createElement("canvas");
    flareCanvas.width = 512;
    flareCanvas.height = 512;
    const flareCtx = flareCanvas.getContext("2d")!;
    const c = flareCanvas.width / 2;
    const flareGrad = flareCtx.createRadialGradient(c, c, 0, c, c, c);
    flareGrad.addColorStop(0, "rgba(255, 245, 200, 0.95)");
    flareGrad.addColorStop(0.28, "rgba(255, 190, 90, 0.55)");
    flareGrad.addColorStop(0.55, "rgba(255, 120, 30, 0.24)");
    flareGrad.addColorStop(1, "rgba(255, 80, 20, 0)");
    flareCtx.fillStyle = flareGrad;
    flareCtx.fillRect(0, 0, flareCanvas.width, flareCanvas.height);

    const flareTexture = new THREE.CanvasTexture(flareCanvas);
    const flareMaterial = new THREE.SpriteMaterial({
      map: flareTexture,
      color: 0xffc37a,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.sunFlare = new THREE.Sprite(flareMaterial);
    this.sunFlare.scale.set(2.9, 2.9, 1);
    this.sunObject.add(this.sunFlare);

    this.scene.add(this.sunObject);

    this.moonCoreMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 32, 32),
      new THREE.MeshStandardMaterial({
        map: createMoonTexture(),
        roughness: 0.95,
        metalness: 0,
        transparent: true,
        opacity: 0.35,
      })
    );
    this.moonObject = new THREE.Group();
    this.moonObject.add(this.moonCoreMesh);

    const moonFlareCanvas = document.createElement("canvas");
    moonFlareCanvas.width = 512;
    moonFlareCanvas.height = 512;
    const moonFlareCtx = moonFlareCanvas.getContext("2d")!;
    const mc = moonFlareCanvas.width / 2;
    const moonFlareGrad = moonFlareCtx.createRadialGradient(mc, mc, 0, mc, mc, mc);
    // Keep most energy in the outer ring so the center doesn’t veil albedo.
    moonFlareGrad.addColorStop(0, "rgba(240, 248, 255, 0)");
    moonFlareGrad.addColorStop(0.42, "rgba(200, 220, 245, 0.12)");
    moonFlareGrad.addColorStop(0.72, "rgba(140, 170, 210, 0.2)");
    moonFlareGrad.addColorStop(1, "rgba(100, 130, 180, 0)");
    moonFlareCtx.fillStyle = moonFlareGrad;
    moonFlareCtx.fillRect(0, 0, moonFlareCanvas.width, moonFlareCanvas.height);

    const moonFlareTex = new THREE.CanvasTexture(moonFlareCanvas);
    const moonFlareMat = new THREE.SpriteMaterial({
      map: moonFlareTex,
      color: 0xd8e6ff,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.moonFlare = new THREE.Sprite(moonFlareMat);
    this.moonFlare.scale.set(1.45, 1.45, 1);
    this.moonObject.add(this.moonFlare);

    this.scene.add(this.moonObject);

    this.loadSunModel();
    this.loadMoonModel();
    this.update(true);
  }

  private loadSunModel() {
    const loader = new GLTFLoader();
    const candidateUrls = [
      "/models/sun/scene.gltf",
      "/models/sun.glb",
      "/models/stroming_sun.glb",
      "/models/scene.gltf",
      "/assets/sun.glb",
      "/assets/stroming_sun.glb",
      "/sun.glb",
      "/stroming_sun.glb",
    ];
    let tryIndex = 0;

    const tryNext = () => {
      if (tryIndex >= candidateUrls.length) {
        console.warn(
          "Failed to load stroming_sun.glb from all candidate paths, using fallback sun mesh."
        );
        return;
      }

      const modelUrl = candidateUrls[tryIndex++];
      loader.load(
        modelUrl,
        (gltf) => {
          const sunModel = gltf.scene;
          sunModel.updateMatrixWorld(true);
          const meshBounds = new THREE.Box3();
          let meshCount = 0;
          let materialsWithMap = 0;
          let meshesWithVertexColors = 0;

          sunModel.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              meshCount++;
              meshBounds.expandByObject(mesh);
              mesh.castShadow = false;
              mesh.receiveShadow = false;
              mesh.frustumCulled = false;
              const materials = Array.isArray(mesh.material)
                ? mesh.material
                : [mesh.material];
              materials.forEach((mat) => {
                mat.side = THREE.DoubleSide;
                if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                  const std = mat as THREE.MeshStandardMaterial;
                  if (std.map) materialsWithMap++;
                  if (mesh.geometry.getAttribute("color")) {
                    std.vertexColors = true;
                    meshesWithVertexColors++;
                  }
                  std.emissive = new THREE.Color(0xffa733);
                  std.emissiveIntensity = 1.15;
                  std.transparent = true;
                  std.opacity = 0.72;
                  std.blending = THREE.AdditiveBlending;
                  std.depthWrite = false;
                  std.toneMapped = false;
                }
              });
            }
          });

          if (meshCount === 0 || meshBounds.isEmpty()) {
            console.warn(
              `Sun model loaded from ${modelUrl} but had no renderable meshes; keeping fallback sphere.`
            );
            return;
          }

          const center = meshBounds.getCenter(new THREE.Vector3());
          const size = meshBounds.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const targetDiameter = 2.35;
          const scaleFactor = maxDim > 0 ? targetDiameter / maxDim : 1;

          sunModel.position.set(0, 0, 0);
          sunModel.scale.multiplyScalar(scaleFactor);
          sunModel.updateMatrixWorld(true);
          const centeredBox = new THREE.Box3().setFromObject(sunModel);
          const centeredCenter = centeredBox.getCenter(new THREE.Vector3());
          sunModel.position.sub(centeredCenter);

          this.sunObject.add(sunModel);
          // Always hide fallback once a GLB mesh is present so we can inspect
          // the model's real appearance (maps or vertex-color driven).
          this.sunCoreMesh.visible = false;
          console.info(
            `Sun model visible from: ${modelUrl} (meshes=${meshCount}, materialsWithMap=${materialsWithMap}, meshesWithVertexColors=${meshesWithVertexColors}, maxDim=${maxDim.toFixed(3)}, scale=${scaleFactor.toFixed(4)})`
          );

          if (materialsWithMap === 0) {
            console.warn(
              "Loaded sun model has no texture maps. Prefer /models/sun/scene.gltf with textures folder, or re-export with embedded textures."
            );
          }
        },
        undefined,
        (error) => {
          console.warn(`Failed to load sun model from ${modelUrl}`, error);
          tryNext();
        }
      );
    };

    tryNext();
  }

  private loadMoonModel() {
    const loader = new GLTFLoader();
    const candidateUrls = [
      "/models/moon/scene.gltf",
      "/models/moon.glb",
    ];
    let tryIndex = 0;

    const tryNextMoon = () => {
      if (tryIndex >= candidateUrls.length) {
        console.warn(
          "Failed to load moon model from all candidate paths, using fallback moon sphere."
        );
        return;
      }

      const modelUrl = candidateUrls[tryIndex++];
      loader.load(
        modelUrl,
        (gltf) => {
          const moonModel = gltf.scene;
          moonModel.updateMatrixWorld(true);
          const meshBounds = new THREE.Box3();
          let meshCount = 0;

          const tuneMoonMaterials = (mesh: THREE.Mesh) => {
            const materials = Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material];
            materials.forEach((mat) => {
              mat.side = THREE.DoubleSide;
              if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                const std = mat as THREE.MeshStandardMaterial;
                if (mesh.geometry.getAttribute("color")) {
                  std.vertexColors = true;
                }
                std.emissive = new THREE.Color(0x000000);
                std.emissiveIntensity = 0;
                std.transparent = false;
                std.opacity = 1;
                std.blending = THREE.NormalBlending;
                std.depthWrite = true;
                std.toneMapped = true;
                std.roughness = 0.92;
                std.metalness = 0;
              } else if ((mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
                const phy = mat as THREE.MeshPhysicalMaterial;
                phy.emissive = new THREE.Color(0x000000);
                phy.emissiveIntensity = 0;
                phy.transparent = false;
                phy.opacity = 1;
                phy.depthWrite = true;
                phy.toneMapped = true;
                phy.roughness = 0.92;
                phy.metalness = 0;
              }
            });
          };

          moonModel.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              meshCount++;
              meshBounds.expandByObject(mesh);
              mesh.castShadow = false;
              mesh.receiveShadow = false;
              mesh.frustumCulled = false;
              tuneMoonMaterials(mesh);
            }
          });

          if (meshCount === 0 || meshBounds.isEmpty()) {
            console.warn(
              `Moon model loaded from ${modelUrl} but had no renderable meshes; keeping fallback sphere.`
            );
            return;
          }

          const finishMoonPlacement = () => {
            const size = meshBounds.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const targetDiameter = 1.05;
            const scaleFactor = maxDim > 0 ? targetDiameter / maxDim : 1;

            moonModel.position.set(0, 0, 0);
            moonModel.scale.multiplyScalar(scaleFactor);
            moonModel.updateMatrixWorld(true);
            const centeredBox = new THREE.Box3().setFromObject(moonModel);
            const centeredCenter = centeredBox.getCenter(new THREE.Vector3());
            moonModel.position.sub(centeredCenter);

            this.moonObject.add(moonModel);
            this.moonCoreMesh.visible = false;
            console.info(
              `Moon model visible from: ${modelUrl} (meshes=${meshCount}, maxDim=${maxDim.toFixed(3)}, scale=${scaleFactor.toFixed(4)})`
            );
          };

          // Sketchfab moon uses KHR_materials_pbrSpecularGlossiness; Three's GLTFLoader
          // no longer translates that extension, so diffuseTexture is never wired up.
          const moonDiffusePath = "/models/moon/textures/Material.002_diffuse.jpeg";
          new THREE.TextureLoader().load(
            moonDiffusePath,
            (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.flipY = false;
              tex.needsUpdate = true;
              moonModel.traverse((child) => {
                if (!(child as THREE.Mesh).isMesh) return;
                const mesh = child as THREE.Mesh;
                const materials = Array.isArray(mesh.material)
                  ? mesh.material
                  : [mesh.material];
                for (const mat of materials) {
                  if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                    (mat as THREE.MeshStandardMaterial).map = tex;
                    mat.needsUpdate = true;
                  } else if ((mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
                    (mat as THREE.MeshPhysicalMaterial).map = tex;
                    mat.needsUpdate = true;
                  }
                }
                tuneMoonMaterials(mesh);
              });
              finishMoonPlacement();
            },
            undefined,
            () => {
              console.warn(
                `Moon diffuse not found at ${moonDiffusePath}; model may appear untextured (spec/gloss extension unsupported).`
              );
              finishMoonPlacement();
            }
          );
        },
        undefined,
        (error) => {
          console.warn(`Failed to load moon model from ${modelUrl}`, error);
          tryNextMoon();
        }
      );
    };

    tryNextMoon();
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
    const moonRadius = 5.8;
    const moonPos = new THREE.Vector3(
      Math.cos(moonHourAngle) * moonRadius,
      Math.sin(moonDeclination) * moonRadius,
      Math.sin(moonHourAngle) * moonRadius
    );

    this.sunLight.position.copy(sunPos);
    this.sunObject.position.copy(sunPos);
    this.moonLight.position.copy(moonPos);
    this.moonObject.position.copy(moonPos);

    const pulseT = performance.now() * 0.0018;
    const flarePulse = 0.88 + 0.18 * Math.sin(pulseT);
    this.sunFlare.scale.setScalar(2.9 * flarePulse);
    (this.sunFlare.material as THREE.SpriteMaterial).opacity =
      0.34 + 0.18 * (0.5 + 0.5 * Math.sin(pulseT * 1.35));

    const moonT = performance.now() * 0.00115;
    const moonPulse = 0.9 + 0.1 * Math.sin(moonT);
    this.moonFlare.scale.setScalar(1.35 * moonPulse);
    (this.moonFlare.material as THREE.SpriteMaterial).opacity =
      0.14 + 0.1 * (0.5 + 0.5 * Math.sin(moonT * 0.9));
  }
}
