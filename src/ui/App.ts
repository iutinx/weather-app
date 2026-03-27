import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CelestialSystem } from "./world/celestial";
import { loadCountryOverlays } from "./world/countries";
import {
  findCountryAtLatLon,
  getCountryCenter,
  latLonToVector3,
  type CountryPolygon,
} from "./world/geo";
import { createGlobe } from "./world/globe";
import { createStarfield } from "./world/stars";

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class App {
  private scene: THREE.Scene;
  private worldGroup: THREE.Group;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;

  private globe: THREE.Mesh | null = null;
  private globeGlow: THREE.Mesh | null = null;
  private celestialSystem: CelestialSystem;

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private countryMeshes: THREE.Object3D[] = [];
  private countryPolygons: CountryPolygon[] = [];
  private hoveredCountry: THREE.Object3D | null = null;

  private countryBaseMaterial: THREE.LineBasicMaterial;
  private countryHoverMaterial: THREE.LineBasicMaterial;
  private countryStripeMaterial: THREE.LineBasicMaterial;

  private selectedCountryName: string | null = null;
  private isDetailView = false;
  private lastFrameTime = 0;
  // ~2 degrees per minute; subtle enough to read but noticeable.
  private earthRotationRateRadPerSec = (20 * Math.PI) / 180 / 60;

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

  constructor(private container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this.scene.add(createStarfield());
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
    this.countryStripeMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 1,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });

    this.raycaster.params.Line!.threshold = 0.03;
    this.setupOverlayElements();

    this.camera.position.copy(this.cameraDefaultPosition);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enablePan = false;
    this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 5;

    this.celestialSystem = new CelestialSystem(this.scene);

    this.loadSceneAssets();
    this.bindEvents();
    this.animate();
  }

  private setupOverlayElements() {
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

    this.countryPanelEl = document.createElement("div");
    this.countryPanelEl.style.position = "fixed";
    this.countryPanelEl.style.top = "50%";
    this.countryPanelEl.style.left = "50%";
    this.countryPanelEl.style.transform = "translate(-50%, -50%)";
    this.countryPanelEl.style.width = "min(420px, 80vw)";
    this.countryPanelEl.style.maxWidth = "420px";
    this.countryPanelEl.style.minWidth = "260px";
    this.countryPanelEl.style.maxHeight = "80vh";
    this.countryPanelEl.style.overflowY = "auto";
    this.countryPanelEl.style.padding = "14px 18px";
    this.countryPanelEl.style.borderRadius = "16px";
    this.countryPanelEl.style.background =
      "linear-gradient(135deg, rgba(15,23,42,0.55), rgba(15,23,42,0.25))";
    this.countryPanelEl.style.backdropFilter = "blur(20px)";
    (
      this.countryPanelEl.style as CSSStyleDeclaration & {
        WebkitBackdropFilter?: string;
      }
    ).WebkitBackdropFilter = "blur(20px)";
    this.countryPanelEl.style.border = "1px solid rgba(148, 163, 184, 0.45)";
    this.countryPanelEl.style.boxShadow = "0 24px 60px rgba(15, 23, 42, 0.72)";
    this.countryPanelEl.style.color = "#e5e7eb";
    this.countryPanelEl.style.fontFamily =
      "-apple-system, system-ui, BlinkMacSystemFont, 'SF Pro Text', sans-serif";
    this.countryPanelEl.style.fontSize = "15px";
    this.countryPanelEl.style.zIndex = "20";
    this.countryPanelEl.style.display = "none";
    document.body.appendChild(this.countryPanelEl);
  }

  private bindEvents() {
    this.renderer.domElement.addEventListener("mousemove", (event) => {
      this.onPointerMove(event);
    });
    this.renderer.domElement.addEventListener("click", (event) => {
      this.onClick(event);
    });
    window.addEventListener("resize", () => this.onWindowResize());
  }

  private async loadSceneAssets() {
    try {
      const globeAssets = await createGlobe(this.worldGroup);
      this.globe = globeAssets.globe;
      this.globeGlow = globeAssets.glow;
    } catch (error) {
      console.error("Error creating globe", error);
    }

    try {
      const overlays = await loadCountryOverlays(this.worldGroup, {
        base: this.countryBaseMaterial,
        hover: this.countryHoverMaterial,
        stripe: this.countryStripeMaterial,
      });
      this.countryMeshes = overlays.countryMeshes;
      this.countryPolygons = overlays.countryPolygons;
    } catch (error) {
      console.error("Error loading country borders", error);
    }
  }

  private onPointerMove(event: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    if (!this.globe) {
      this.hideTooltip();
      this.setHoveredCountry(null);
      return;
    }

    const hit = this.raycaster.intersectObject(this.globe, false);
    if (hit.length === 0) {
      this.hideTooltip();
      this.setHoveredCountry(null);
      return;
    }

    const latLon = this.getLatLonFromGlobeHit(hit[0].point);
    if (!latLon) {
      this.hideTooltip();
      this.setHoveredCountry(null);
      return;
    }
    const { lat, lon } = latLon;
    const country = findCountryAtLatLon(this.countryPolygons, lat, lon);

    if (!country) {
      this.hideTooltip();
      this.setHoveredCountry(null);
      return;
    }

    this.setHoveredCountry(country.id);
    this.updateTooltip(event.clientX, event.clientY, country.displayName);
  }

  private onClick(event: MouseEvent) {
    if (event.button !== 0) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    if (!this.globe) {
      this.selectedCountryName = null;
      this.hideCountryPanel();
      return;
    }

    const hit = this.raycaster.intersectObject(this.globe, false);
    if (hit.length === 0) {
      this.selectedCountryName = null;
      this.hideCountryPanel();
      return;
    }

    const latLon = this.getLatLonFromGlobeHit(hit[0].point);
    if (!latLon) {
      this.selectedCountryName = null;
      this.hideCountryPanel();
      return;
    }
    const { lat, lon } = latLon;
    const country = findCountryAtLatLon(this.countryPolygons, lat, lon);

    if (!country) {
      this.selectedCountryName = null;
      this.hideCountryPanel();
      return;
    }

    this.enterDetailView(country.id);
  }

  private getLatLonFromGlobeHit(
    worldPoint: THREE.Vector3
  ): { lat: number; lon: number } | null {
    if (!this.globe) return null;

    // Convert world hit to globe-local coordinates so picking stays aligned
    // while the world group auto-rotates.
    const localPoint = this.globe.worldToLocal(worldPoint.clone()).normalize();
    const lat = THREE.MathUtils.radToDeg(Math.asin(localPoint.y));
    const lon = THREE.MathUtils.radToDeg(Math.atan2(localPoint.z, -localPoint.x));
    return { lat, lon };
  }

  private setHoveredCountry(countryId: string | null) {
    if (this.hoveredCountry) {
      const prevHoverGroup = (this.hoveredCountry as THREE.Group).userData
        ?.hoverGroup as THREE.Group | undefined;
      if (prevHoverGroup) prevHoverGroup.visible = false;
      this.hoveredCountry = null;
    }

    if (!countryId) return;

    const group = this.countryMeshes.find(
      (obj) => (obj as THREE.Group).userData?.polygonId === countryId
    ) as THREE.Group | undefined;
    if (!group) return;

    const hoverGroup = group.userData?.hoverGroup as THREE.Group | undefined;
    if (hoverGroup) hoverGroup.visible = true;
    this.hoveredCountry = group;
  }

  private enterDetailView(countryId: string) {
    const selectedPolygon = this.countryPolygons.find((p) => p.id === countryId);
    if (!selectedPolygon) return;

    this.isDetailView = true;
    this.selectedCountryName = selectedPolygon.id;
    this.hideTooltip();
    this.showCountryPanel(selectedPolygon.displayName);

    const center = getCountryCenter(this.countryPolygons, countryId);
    if (center) this.startCameraAnimationToLatLon(center.lat, center.lon);
  }

  private exitDetailView() {
    if (!this.isDetailView) {
      this.hideCountryPanel();
      return;
    }
    this.isDetailView = false;
    this.selectedCountryName = null;
    this.setHoveredCountry(null);
    this.hideCountryPanel();
  }

  /** Slow zoom toward the region center; orbit target stays at globe center. */
  private startCameraAnimationToLatLon(lat: number, lon: number) {
    const surfacePoint = latLonToVector3(lat, lon, 1.0).normalize();
    const targetPos = surfacePoint.multiplyScalar(1.95);
    this.cameraAnimation = {
      fromPos: this.camera.position.clone(),
      toPos: targetPos,
      fromTarget: this.controls.target.clone(),
      toTarget: this.cameraDefaultTarget.clone(),
      startTime: performance.now(),
      duration: 2600,
    };
  }

  private updateTooltip(x: number, y: number, text: string) {
    if (!this.tooltipEl) return;
    this.tooltipEl.textContent = text;
    this.tooltipEl.style.left = `${x + 10}px`;
    this.tooltipEl.style.top = `${y + 10}px`;
    this.tooltipEl.style.display = "block";
  }

  private hideTooltip() {
    if (this.tooltipEl) this.tooltipEl.style.display = "none";
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
    if (closeBtn) closeBtn.onclick = () => this.exitDetailView();
  }

  private hideCountryPanel() {
    if (this.countryPanelEl) this.countryPanelEl.style.display = "none";
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private animate() {
    requestAnimationFrame(() => this.animate());

    const now = performance.now();
    const dt = this.lastFrameTime ? (now - this.lastFrameTime) / 1000 : 0;
    this.lastFrameTime = now;

    // Rotate the globe gently; keep it paused during camera moves/detail view.
    if (this.worldGroup && !this.cameraAnimation && !this.isDetailView) {
      this.worldGroup.rotation.y += this.earthRotationRateRadPerSec * dt;
    }

    const t = now * 0.005;
    this.countryHoverMaterial.opacity = 0.8 + 0.5 * Math.sin(t);
    this.celestialSystem.update();

    if (this.globeGlow) {
      this.globeGlow.scale.setScalar(1 + 0.012 * Math.sin(t * 0.4));
    }

    if (this.cameraAnimation) {
      const now = performance.now();
      const tAnim =
        (now - this.cameraAnimation.startTime) / this.cameraAnimation.duration;
      const clampedT = Math.min(Math.max(tAnim, 0), 1);
      const easedT = easeInOutCubic(clampedT);

      this.camera.position.lerpVectors(
        this.cameraAnimation.fromPos,
        this.cameraAnimation.toPos,
        easedT
      );
      this.controls.target.lerpVectors(
        this.cameraAnimation.fromTarget,
        this.cameraAnimation.toTarget,
        easedT
      );
      this.controls.update();

      if (clampedT >= 1) this.cameraAnimation = null;
    } else {
      this.controls.update();
    }

    this.renderer.render(this.scene, this.camera);
  }
}
