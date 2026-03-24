import * as THREE from "three";

export type GlobeAssets = {
  globe: THREE.Mesh;
  glow: THREE.Mesh;
};

async function loadTextureFromImage(
  texturePath: string
): Promise<THREE.Texture | null> {
  const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"];
  for (const ext of imageExtensions) {
    const texture = await new Promise<THREE.Texture | null>((resolve) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        `${texturePath}${ext}`,
        (loadedTexture) => {
          loadedTexture.wrapS = THREE.RepeatWrapping;
          loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
          resolve(loadedTexture);
        },
        undefined,
        () => resolve(null)
      );
    });

    if (texture) return texture;
  }

  return null;
}

async function loadTextureFromSvg(): Promise<THREE.Texture | null> {
  let response = await fetch("/image.svg");
  if (!response.ok) {
    response = await fetch("/mapchart.svg");
    if (!response.ok) return null;
  }

  const svgText = await response.text();
  return await new Promise<THREE.Texture | null>((resolve) => {
    const img = new Image();
    const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 2048;
      canvas.width = size;
      canvas.height = size / 2;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      URL.revokeObjectURL(url);
      resolve(texture);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

export async function createGlobe(scene: THREE.Scene): Promise<GlobeAssets> {
  const texturePath = "/image";
  const texture =
    (await loadTextureFromImage(texturePath)) ?? (await loadTextureFromSvg());

  const geometry = new THREE.SphereGeometry(1, 64, 32);
  const material = new THREE.MeshStandardMaterial({
    map: texture ?? undefined,
    transparent: true,
    opacity: 0,
    roughness: 1,
    metalness: 0,
    depthWrite: false,
  });
  const globe = new THREE.Mesh(geometry, material);
  scene.add(globe);

  const glowGeometry = new THREE.SphereGeometry(1.04, 64, 32);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  scene.add(glow);

  return { globe, glow };
}
