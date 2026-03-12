// File: src/ui/App.ts
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export class App {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private globe: THREE.Mesh | null = null;

  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private mouse: THREE.Vector2 = new THREE.Vector2();
  private countryMeshes: THREE.Object3D[] = [];
  private hoveredCountry: THREE.Object3D | null = null;
  // hit testing pe glob

  private countryPolygons: { name: string; rings: number[][][] }[] = [];
  private countryBaseMaterial: THREE.LineBasicMaterial;
  private countryHoverMaterial: THREE.LineBasicMaterial;
  private selectedCountryName: string | null = null;
  private selectedCountryGroup: THREE.Group | null = null;
  private isDetailView = false;
  private detailCountryGroup: THREE.Group | null = null;

  // Camera focus animation state
  private cameraDefaultPosition = new THREE.Vector3(0, 0, 2.5);
  private cameraDefaultTarget = new THREE.Vector3(0, 0, 0);
  private cameraAnimation:
    | {
        fromPos: THREE.Vector3;
        toPos: THREE.Vector3;
        fromTarget: THREE.Vector3;
        toTarget: THREE.Vector3;
        startTime: number;
        duration: number;
      }
    | null = null;

  private tooltipEl: HTMLDivElement | null = null;
  private countryPanelEl: HTMLDivElement | null = null;

  private latLonToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
    const latRad = (lat * Math.PI) / 180;
    const lonRad = (lon * Math.PI) / 180;
  
    const x = -radius * Math.cos(latRad) * Math.cos(lonRad);
    const z =  radius * Math.cos(latRad) * Math.sin(lonRad);
    const y =  radius * Math.sin(latRad);
  
    return new THREE.Vector3(x, y, z);
  }
  
  private onPointerMove(event: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();

    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    if (!this.globe) {
      this.hoveredCountry = null;
      this.hideTooltip();
      return;
    }

    // Intersect only with the globe so we always hit the front-facing surface
    const globeIntersects = this.raycaster.intersectObject(this.globe, false);

    if (globeIntersects.length === 0) {
      this.setHoveredCountry(null);
      this.hideTooltip();
      return;
    }

    const hitPoint = globeIntersects[0].point.clone().normalize(); // point on unit sphere

    // convert 3D point back to lat/lon
    const lat = Math.asin(hitPoint.y);
    const lon = Math.atan2(hitPoint.z, -hitPoint.x);
    const latDeg = THREE.MathUtils.radToDeg(lat);
    const lonDeg = THREE.MathUtils.radToDeg(lon);

    const countryName = this.findCountryAtLatLon(latDeg, lonDeg);

    if (countryName) {
      this.setHoveredCountry(countryName);
      this.updateTooltip(event.clientX, event.clientY, countryName);
    } else {
      this.setHoveredCountry(null);
      this.hideTooltip();
    }
  }

  private onClick(event: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();

    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    if (!this.globe) {
      this.selectedCountryName = null;
      this.hideCountryPanel();
      return;
    }

    const globeIntersects = this.raycaster.intersectObject(this.globe, false);

    if (globeIntersects.length === 0) {
      this.selectedCountryName = null;
      this.hideCountryPanel();
      return;
    }

    const hitPoint = globeIntersects[0].point.clone().normalize();

    const lat = Math.asin(hitPoint.y);
    const lon = Math.atan2(hitPoint.z, -hitPoint.x);
    const latDeg = THREE.MathUtils.radToDeg(lat);
    const lonDeg = THREE.MathUtils.radToDeg(lon);

    const countryName = this.findCountryAtLatLon(latDeg, lonDeg);

    if (countryName) {
      this.selectedCountryName = countryName;
      this.enterDetailView(countryName);
    } else {
      this.selectedCountryName = null;
      this.hideCountryPanel();
    }
  }

  private updateTooltip(x: number, y: number, text: string) {
    if (!this.tooltipEl) return;
    this.tooltipEl.textContent = text;
    this.tooltipEl.style.left = `${x + 10}px`;
    this.tooltipEl.style.top = `${y + 10}px`;
    this.tooltipEl.style.display = "block";
  }

  private hideTooltip() {
    if (!this.tooltipEl) return;
    this.tooltipEl.style.display = "none";
  }
  
  private showCountryPanel(countryName: string) {
    if (!this.countryPanelEl) return;
    this.countryPanelEl.style.display = "block";
    this.countryPanelEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h2 style="margin:0; font-size:16px;">${countryName}</h2>
        <button id="country-panel-close"
          style="
            border:none;
            background:rgba(15,23,42,0.8);
            color:#9ca3af;
            padding:4px 8px;
            border-radius:999px;
            font-size:11px;
            cursor:pointer;
          "
        >
          Back to globe
        </button>
      </div>
      <div style="font-size:13px; opacity:0.9;">
        <p style="margin: 0 0 4px;">Current weather: <strong>--</strong></p>
        <p style="margin: 0 0 4px;">Temperature: <strong>-- °C</strong></p>
        <p style="margin: 0 0 4px;">Humidity: <strong>-- %</strong></p>
        <p style="margin: 0;">Wind: <strong>-- km/h</strong></p>
      </div>
    `;

    const closeBtn = this.countryPanelEl.querySelector(
      "#country-panel-close"
    ) as HTMLButtonElement | null;
    if (closeBtn) {
      closeBtn.onclick = () => this.exitDetailView();
    }
  }

  private hideCountryPanel() {
    if (!this.countryPanelEl) return;
    this.countryPanelEl.style.display = "none";
  }
  
  constructor(private container: HTMLElement) {
    // Initialize Three.js components
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.appendChild(this.renderer.domElement);

    // Country line materials (base + glossy hover)
    this.countryBaseMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 1,
    });
    this.countryHoverMaterial = new THREE.LineBasicMaterial({
      color: 0xff0000,
      linewidth: 2,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // linie raycasting
    this.raycaster.params.Line!.threshold = 0.03;

    // CReate tool tip element

    this.tooltipEl = document.createElement("div");
    this.tooltipEl.style.position = "fixed";
    this.tooltipEl.style.pointerEvents = "none";
    this.tooltipEl.style.padding = "4px 8px";
    this.tooltipEl.style.borderRadius = "4px";
    this.tooltipEl.style.background = "rgba(0, 0, 0, 0.8)";
    this.tooltipEl.style.color = "#ffffff";
    this.tooltipEl.style.fontSize = "12px";
    this.tooltipEl.style.whiteSpace = "nowrap";
    this.tooltipEl.style.display = "none";

    document.body.appendChild(this.tooltipEl);

    // Country weather/detail panel (click)
    this.countryPanelEl = document.createElement("div");
    this.countryPanelEl.style.position = "fixed";
    this.countryPanelEl.style.top = "50%";
    this.countryPanelEl.style.left = "50%";
    this.countryPanelEl.style.transform = "translate(-50%, -50%)";
    // Responsive sizing so the panel is never too small or huge
    this.countryPanelEl.style.width = "min(420px, 80vw)";
    this.countryPanelEl.style.maxWidth = "420px";
    this.countryPanelEl.style.minWidth = "260px";
    this.countryPanelEl.style.maxHeight = "80vh";
    this.countryPanelEl.style.overflowY = "auto";
    this.countryPanelEl.style.padding = "14px 18px";
    this.countryPanelEl.style.borderRadius = "16px";
    // Glassmorphism: translucent gradient, strong blur, and soft border
    this.countryPanelEl.style.background =
      "linear-gradient(135deg, rgba(15,23,42,0.55), rgba(15,23,42,0.25))";
    this.countryPanelEl.style.backdropFilter = "blur(20px)";
    (this.countryPanelEl.style as any).WebkitBackdropFilter = "blur(20px)";
    this.countryPanelEl.style.border =
      "1px solid rgba(148, 163, 184, 0.45)";
    this.countryPanelEl.style.boxShadow =
      "0 24px 60px rgba(15, 23, 42, 0.72)";
    this.countryPanelEl.style.color = "#e5e7eb";
    this.countryPanelEl.style.fontFamily =
      "-apple-system, system-ui, BlinkMacSystemFont, 'SF Pro Text', sans-serif";
    this.countryPanelEl.style.fontSize = "15px";
    this.countryPanelEl.style.zIndex = "20";
    this.countryPanelEl.style.display = "none";

    document.body.appendChild(this.countryPanelEl);

    // camera
    this.camera.position.set(0, 0, 2.5);

    // orbit controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 5;

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    // Add directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 3, 5);
    this.scene.add(directionalLight);

    // Load the globe texture and create the globe
    this.loadGlobeTexture();

    // Handle mouse move
    this.renderer.domElement.addEventListener("mousemove", (event) => {
      this.onPointerMove(event);
    });

    // Handle click (select country + show weather template)
    this.renderer.domElement.addEventListener("click", (event) => {
      this.onClick(event);
    });

    // Handle window resize
    window.addEventListener("resize", () => this.onWindowResize());

    // Start animation loop
    this.animate();
  }

  private async loadGlobeTexture() {
    // Try to load image file first (PNG/JPG - recommended)
    // Falls back to SVG if image not found
    const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"];
    const texturePath = "/image";

    // Try loading as image file first
    for (const ext of imageExtensions) {
      try {
        const texture = await new Promise<THREE.Texture | null>((resolve) => {
          const loader = new THREE.TextureLoader();
          loader.load(
            `${texturePath}${ext}`,
            (texture) => {
              texture.wrapS = THREE.RepeatWrapping;
              texture.wrapT = THREE.ClampToEdgeWrapping;
              resolve(texture);
            },
            undefined,
            () => resolve(null) // On error, try next format
          );
        });

        if (texture) {
          this.createGlobe(texture);
          return;
        }
      } catch (error) {
        // Continue to next format
      }
    }

    // Fallback: Try loading as SVG
    try {
      let response = await fetch("/image.svg");
      if (!response.ok) {
        // Try mapchart.svg as fallback
        response = await fetch("/mapchart.svg");
        if (!response.ok) throw new Error("SVG not found");
      }

      const svgText = await response.text();

      // Create an image from the SVG
      const img = new Image();
      const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      img.onload = () => {
        // Create a canvas to render the SVG at high resolution
        const canvas = document.createElement("canvas");
        const size = 2048; // High resolution for better quality
        canvas.width = size;
        canvas.height = size / 2; // 2/1 aspect

        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;

        this.createGlobe(texture);

        URL.revokeObjectURL(url);
      };

      img.onerror = () => {
        console.error("Failed to load SVG texture");
        // daca crapa
        this.createGlobe(null);
      };

      img.src = url;
    } catch (error) {
      console.error("Error loading globe texture:", error);
      // daca crapa x2
      this.createGlobe(null);
    }
  }

  private createGlobe(texture: THREE.Texture | null) {
    const geometry = new THREE.SphereGeometry(1, 64, 32);

    // in caz de merge
    let material: THREE.MeshStandardMaterial;
    if (texture) {
      material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.8,
        metalness: 0.1,
      });
    } else {
      // in caz ca se crapa
      material = new THREE.MeshStandardMaterial({
        color: 0x4a90e2,
        roughness: 0.8,
        metalness: 0.1,
      });
    }

    // create mesh
    this.globe = new THREE.Mesh(geometry, material);
    this.scene.add(this.globe);

    this.loadCountryBorders();
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private animate() {
    requestAnimationFrame(() => this.animate());

    // Pulse effect for hover borders
    const t = performance.now() * 0.005;
    this.countryHoverMaterial.opacity = 0.8 + 0.5 * Math.sin(t);

    // Smooth camera animation when focusing on a country or returning to globe
    if (this.cameraAnimation) {
      const now = performance.now();
      const t =
        (now - this.cameraAnimation.startTime) / this.cameraAnimation.duration;
      const clampedT = Math.min(Math.max(t, 0), 1);

      this.camera.position.lerpVectors(
        this.cameraAnimation.fromPos,
        this.cameraAnimation.toPos,
        clampedT
      );
      this.controls.target.lerpVectors(
        this.cameraAnimation.fromTarget,
        this.cameraAnimation.toTarget,
        clampedT
      );
      this.controls.update();

      if (clampedT >= 1) {
        this.cameraAnimation = null;
      }
    } else {
      // Normal orbit controls behaviour
      this.controls.update();
    }

    // Render the scene
    this.renderer.render(this.scene, this.camera);
  }

  private setHoveredCountry(countryName: string | null) {
    // Reset previously hovered country's raised/hover group, if any
    if (this.hoveredCountry) {
      const prevHoverGroup = (this.hoveredCountry as any).userData
        ?.hoverGroup as THREE.Group | undefined;
      if (prevHoverGroup) {
        prevHoverGroup.visible = false;
      }
      this.hoveredCountry = null;
    }

    if (!countryName) return;

    const group = this.countryMeshes.find(
      (obj) => (obj as any).userData?.countryName === countryName
    ) as THREE.Group | undefined;

    if (!group) return;

    const hoverGroup = group.userData?.hoverGroup as
      | THREE.Group
      | undefined;
    if (hoverGroup) {
      hoverGroup.visible = true;
    }

    this.hoveredCountry = group;
  }

  private enterDetailView(countryName: string) {
    this.isDetailView = true;
    this.selectedCountryName = countryName;

    // Hide tooltip while focused on a selected country
    this.hideTooltip();

    // Show the existing info panel
    this.showCountryPanel(countryName);

    // Compute the geographic center of the country from its polygons
    const center = this.getCountryCenter(countryName);
    if (center) {
      this.startCameraAnimationToLatLon(center.lat, center.lon);
    }
  }

  private exitDetailView() {
    if (!this.isDetailView) {
      this.hideCountryPanel();
      return;
    }

    this.isDetailView = false;

    this.selectedCountryGroup = null;
    this.selectedCountryName = null;

    // Clear hover highlight
    this.setHoveredCountry(null);

    this.hideCountryPanel();
  }

  // Compute an approximate geographic center for a country in degrees.
  private getCountryCenter(
    countryName: string
  ): { lat: number; lon: number } | null {
    const poly = this.countryPolygons.find((c) => c.name === countryName);
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

    return {
      lat: sumLat / count,
      lon: sumLon / count,
    };
  }

  private startCameraAnimationToLatLon(lat: number, lon: number) {
    // Convert country center to a point on the globe surface
    const surfacePoint = this.latLonToVector3(lat, lon, 1.0);
    const dir = surfacePoint.clone().normalize();

    // Place camera slightly away from the surface, looking at the country
    const distance = 2.1;
    const targetPos = dir.multiplyScalar(distance);
    // Keep the orbit center at the middle of the globe so rotation still feels natural
    const targetTarget = this.cameraDefaultTarget.clone();

    this.cameraAnimation = {
      fromPos: this.camera.position.clone(),
      toPos: targetPos,
      fromTarget: this.controls.target.clone(),
      toTarget: targetTarget,
      startTime: performance.now(),
      duration: 600, // ms
    };
  }

  private startCameraAnimationToDefault() {
    this.cameraAnimation = {
      fromPos: this.camera.position.clone(),
      toPos: this.cameraDefaultPosition.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: this.cameraDefaultTarget.clone(),
      startTime: performance.now(),
      duration: 900, // ms
    };
  }

  private pointInPolygon(lon: number, lat: number, polygon: number[][]): boolean {
    // Ray casting algorithm in 2D (lon, lat)
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0];
      const yi = polygon[i][1];
      const xj = polygon[j][0];
      const yj = polygon[j][1];

      const intersect =
        yi > lat !== yj > lat &&
        lon <
          ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;

      if (intersect) inside = !inside;
    }
    return inside;
  }

  private findCountryAtLatLon(lat: number, lon: number): string | null {
    // GeoJSON uses [lon, lat]
    for (const country of this.countryPolygons) {
      for (const ring of country.rings) {
        if (ring.length === 0) continue;
        if (this.pointInPolygon(lon, lat, ring)) {
          return country.name;
        }
      }
    }
    return null;
  }

  private async loadCountryBorders() {
    try {
      const res = await fetch("/mediumcountries.geojson");
      if (!res.ok) throw new Error("Failed to load countries.geojson");
      const geojson = await res.json();

      for (const feature of geojson.features) {
        const name =
          feature.properties?.ADMIN ||
          feature.properties?.name ||
          "Unknown country";

        const geomType = feature.geometry.type;
        const coords = feature.geometry.coordinates;

        const group = new THREE.Group();
        group.userData.countryName = name;

        // Raised hover group for glossy border effect
        const hoverGroup = new THREE.Group();
        hoverGroup.visible = false;
        group.userData.hoverGroup = hoverGroup;
        group.add(hoverGroup);

        const rings: number[][][] = [];

        const addPolygon = (polygonCoords: number[][]) => {
          const basePoints: THREE.Vector3[] = [];
          const hoverPoints: THREE.Vector3[] = [];
          for (const [lon, lat] of polygonCoords) {
            basePoints.push(this.latLonToVector3(lat, lon, 1.01)); // just above globe surface
            hoverPoints.push(
              this.latLonToVector3(lat, lon, 1.02) // slightly higher for raised/gloss effect
            );
          }

          const baseGeometry = new THREE.BufferGeometry().setFromPoints(
            basePoints
          );
          const baseLine = new THREE.Line(
            baseGeometry,
            this.countryBaseMaterial
          );
          baseLine.userData.countryName = name;
          group.add(baseLine);

          const hoverGeometry = new THREE.BufferGeometry().setFromPoints(
            hoverPoints
          );
          const hoverLine = new THREE.Line(
            hoverGeometry,
            this.countryHoverMaterial
          );
          hoverLine.userData.countryName = name;
          hoverGroup.add(hoverLine);
        };

        if (geomType === "Polygon") {
          const polygonCoords = coords as number[][][]; // [ring][vertex][lon/lat]
          for (const ring of polygonCoords) {
            rings.push(ring);
            addPolygon(ring);
          }
        } else if (geomType === "MultiPolygon") {
          const multiPolygonCoords = coords as number[][][][]; // [poly][ring][vertex][lon/lat]
          for (const poly of multiPolygonCoords) {
            for (const ring of poly) {
              rings.push(ring);
              addPolygon(ring);
            }
          }
        }
        this.scene.add(group);
        this.countryMeshes.push(group);
        this.countryPolygons.push({ name, rings });
      }
    } catch (e) {
      console.error("Error loading country borders", e);
    }
  }
}
