import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  fetchWeatherForLocation,
  type WeatherData,
  formatWeatherCompact,
  renderWeatherDetail,
  weatherQueryFromPolygon,
} from "../api/weather";
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

  private cityAbortController: AbortController | null = null;
  private cityRequestId = 0;

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private countryMeshes: THREE.Object3D[] = [];
  private countryPolygons: CountryPolygon[] = [];
  private hoveredCountry: THREE.Object3D | null = null;

  private hoverFetchGen = 0;
  private hoveredWeatherCountryId: string | null = null;
  private hoverWeatherDebounce: ReturnType<typeof setTimeout> | null = null;
  private hoverFetchAbort: AbortController | null = null;
  private lastClientX = 0;
  private lastClientY = 0;

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
  private countryPanelBackdropEl: HTMLDivElement | null = null;
  private countryPanelScrollLockActive = false;
  private previousBodyOverflow = "";
  private resizeObserver: ResizeObserver | null = null;

  constructor(private container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this.scene.add(createStarfield());
    const { width, height } = this.readContainerSize();
    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.fitRenderer();
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
    this.observeContainerSize();
    this.bindCityWeatherSearch();
    this.animate();
  }

  private readContainerSize(): { width: number; height: number } {
    const w = Math.max(1, Math.floor(this.container.clientWidth));
    const h = Math.max(1, Math.floor(this.container.clientHeight));
    return { width: w, height: h };
  }

  private fitRenderer() {
    const { width, height } = this.readContainerSize();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
  }

  private observeContainerSize() {
    this.resizeObserver = new ResizeObserver(() => this.fitRenderer());
    this.resizeObserver.observe(this.container);
  }

  private setupOverlayElements() {
    this.tooltipEl = document.createElement("div");
    this.tooltipEl.style.position = "fixed";
    this.tooltipEl.style.pointerEvents = "none";
    this.tooltipEl.style.padding = "6px 10px";
    this.tooltipEl.style.borderRadius = "12px";
    this.tooltipEl.style.background = "rgba(255, 255, 255, 0.95)";
    this.tooltipEl.style.border = "1px solid rgba(229, 231, 235, 1)";
    this.tooltipEl.style.backdropFilter = "none";
    (this.tooltipEl.style as CSSStyleDeclaration & {
      WebkitBackdropFilter?: string;
    }).WebkitBackdropFilter = "none";
    this.tooltipEl.style.boxShadow =
      "0 18px 60px rgba(0, 0, 0, 0.10)";
    this.tooltipEl.style.color = "#111827";
    this.tooltipEl.style.fontSize = "12px";
    this.tooltipEl.style.whiteSpace = "pre-line";
    this.tooltipEl.style.maxWidth = "min(280px, 70vw)";
    this.tooltipEl.style.lineHeight = "1.35";
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
    this.countryPanelEl.style.overflow = "hidden";
    this.countryPanelEl.style.overscrollBehavior = "contain";
    this.countryPanelEl.style.touchAction = "pan-y";
    this.countryPanelEl.style.padding = "0";
    this.countryPanelEl.style.borderRadius = "24px";
    this.countryPanelEl.style.background = "rgba(255, 255, 255, 0.12)";
    this.countryPanelEl.style.backdropFilter = "blur(16px) saturate(150%)";
    (
      this.countryPanelEl.style as CSSStyleDeclaration & {
        WebkitBackdropFilter?: string;
      }
    ).WebkitBackdropFilter = "blur(16px) saturate(150%)";
    this.countryPanelEl.style.border = "1px solid rgba(255, 255, 255, 0.2)";
    this.countryPanelEl.style.boxShadow =
      "0 20px 60px rgba(0, 0, 0, 0.25)";
    this.countryPanelEl.style.color = "#111827";
    this.countryPanelEl.style.fontFamily =
      "-apple-system, system-ui, BlinkMacSystemFont, 'SF Pro Text', sans-serif";
    this.countryPanelEl.style.fontSize = "15px";
    this.countryPanelEl.style.zIndex = "20";
    this.countryPanelEl.style.display = "none";
    document.body.appendChild(this.countryPanelEl);

    this.countryPanelBackdropEl = document.createElement("div");
    this.countryPanelBackdropEl.style.position = "fixed";
    this.countryPanelBackdropEl.style.inset = "0";
    this.countryPanelBackdropEl.style.background = "rgba(0, 0, 0, 0.35)";
    this.countryPanelBackdropEl.style.zIndex = "19";
    this.countryPanelBackdropEl.style.display = "none";
    this.countryPanelBackdropEl.style.pointerEvents = "auto";
    document.body.appendChild(this.countryPanelBackdropEl);
    this.countryPanelBackdropEl.addEventListener("click", () => this.exitDetailView());
  }

  private bindCityWeatherSearch() {
    const doc = document;
    const form = doc.getElementById("city-search-form") as
      | HTMLFormElement
      | null;
    const input = doc.getElementById("city-search-input") as
      | HTMLInputElement
      | null;
    const result = doc.getElementById("city-search-result") as
      | HTMLDivElement
      | null;
    const toggleButton = doc.getElementById("city-search-toggle") as
      | HTMLButtonElement
      | null;
    if (!form || !input || !result) return;

    const setResultOpen = (open: boolean) => {
      result.classList.toggle("open", open);
      if (!toggleButton) return;
      toggleButton.hidden = false;
      toggleButton.textContent = open ? "Hide weather" : "Show weather";
    };

    toggleButton?.addEventListener("click", () => {
      const isOpen = result.classList.contains("open");
      setResultOpen(!isOpen);
    });

    const showLoading = () => {
      result.hidden = false;
      result.classList.add("open");
      if (toggleButton) toggleButton.hidden = true;
      result.replaceChildren();
      const el = doc.createElement("div");
      el.className = "city-loading";
      el.textContent = "Loading…";
      result.appendChild(el);
    };

    const showError = (message: string) => {
      result.hidden = false;
      result.classList.add("open");
      if (toggleButton) toggleButton.hidden = true;
      result.replaceChildren();
      const el = doc.createElement("div");
      el.className = "city-result-error";
      el.textContent = message;
      result.appendChild(el);
    };

    const splitLocation = (locationLabel: string): { city: string; country: string } => {
      const parts = locationLabel.split(",").map((p) => p.trim()).filter(Boolean);
      const city = parts[0] ?? locationLabel;
      const country = parts.slice(1).join(", ");
      return { city, country: country || "—" };
    };

    const statCard = (
      label: string,
      value: string
    ): HTMLElement => {
      const card = doc.createElement("div");
      card.className = "city-stat-card";

      const l = doc.createElement("div");
      l.className = "city-stat-label";
      l.textContent = label;

      const v = doc.createElement("div");
      v.className = "city-stat-value";
      v.textContent = value;

      card.appendChild(l);
      card.appendChild(v);
      return card;
    };

    const formatMaybeTemp = (n: number | null | undefined): string => {
      return n == null || Number.isNaN(n) ? "—" : `${Math.round(n)}°C`;
    };

    const formatMaybeTempRange = (
      min: number | null,
      max: number | null
    ): string => {
      if (min == null || max == null) return "—";
      if (Number.isNaN(min) || Number.isNaN(max)) return "—";
      return `${Math.round(min)}–${Math.round(max)}°C`;
    };

    const formatMaybePercent = (n: number | null): string => {
      return n == null || Number.isNaN(n) ? "—" : `${Math.round(n)}%`;
    };

    const formatMaybePrecipMm = (mm: number | null): string => {
      if (mm == null || Number.isNaN(mm)) return "—";
      if (mm === 0) return "—";
      return `${Math.round(mm)} mm`;
    };

    const render = (data: WeatherData) => {
      result.hidden = false;
      result.replaceChildren();

      const { city, country } = splitLocation(data.locationLabel);

      const hero = doc.createElement("div");
      hero.className = "city-hero";

      const top = doc.createElement("div");
      top.className = "city-hero-top";
      const cityEl = doc.createElement("div");
      cityEl.className = "city-name";
      cityEl.textContent = city;

      const countryEl = doc.createElement("div");
      countryEl.className = "city-country";
      countryEl.textContent = country;

      top.appendChild(cityEl);
      top.appendChild(countryEl);

      const timeEl = doc.createElement("div");
      timeEl.className = "city-time";
      timeEl.textContent = data.localTimeDisplay;

      const tempEl = doc.createElement("div");
      tempEl.className = "city-temp";
      tempEl.textContent =
        data.current.temp == null ? "—" : `${Math.round(data.current.temp)}°C`;

      const hi = data.todayHigh;
      const lo = data.todayLow;
      const feelslike = formatMaybeTemp(data.current.feelslike);

      const hiLoText =
        hi == null || lo == null
          ? "High/Low —"
          : `High ${Math.round(hi)}° / Low ${Math.round(lo)}°`;

      const feelsLine = doc.createElement("div");
      feelsLine.className = "city-feels-line";
      feelsLine.textContent = `${feelslike} · ${data.current.conditions} · ${hiLoText}`;

      const desc = data.days[0]?.conditionsShort ?? data.current.conditions;
      const descEl = doc.createElement("div");
      descEl.className = "city-description";
      descEl.textContent = desc;

      hero.appendChild(top);
      hero.appendChild(timeEl);
      hero.appendChild(tempEl);
      hero.appendChild(feelsLine);
      hero.appendChild(descEl);

      const atmoLabel = doc.createElement("div");
      atmoLabel.className = "city-section-label";
      atmoLabel.textContent = "Atmosphere";

      const atmoGrid = doc.createElement("div");
      atmoGrid.className = "city-grid-4";
      atmoGrid.appendChild(
        statCard(
          "humidity",
          data.current.humidity == null ? "—" : `${Math.round(data.current.humidity)}%`
        )
      );
      atmoGrid.appendChild(
        statCard(
          "dew",
          data.current.dew == null ? "—" : `${Math.round(data.current.dew)}°C`
        )
      );
      atmoGrid.appendChild(
        statCard(
          "pressure",
          data.current.pressure == null ? "—" : `${Math.round(data.current.pressure)} hPa`
        )
      );
      atmoGrid.appendChild(
        statCard(
          "visibility",
          data.current.visibility == null ? "—" : `${Math.round(data.current.visibility)} km`
        )
      );
      atmoGrid.appendChild(
        statCard(
          "cloudcover",
          data.current.cloudcover == null ? "—" : `${Math.round(data.current.cloudcover)}%`
        )
      );
      atmoGrid.appendChild(
        statCard(
          "uvindex",
          data.current.uvindex == null ? "—" : `${Math.round(data.current.uvindex)}`
        )
      );
      atmoGrid.appendChild(
        statCard(
          "solarradiation",
          data.current.solarradiation == null ? "—" : `${Math.round(data.current.solarradiation)}`
        )
      );
      atmoGrid.appendChild(
        statCard(
          "precipprob",
          formatMaybePercent(data.current.precipprob)
        )
      );

      const windSunWrap = doc.createElement("div");
      windSunWrap.className = "city-two-col";

      const windSection = doc.createElement("div");
      const windLabel = doc.createElement("div");
      windLabel.className = "city-section-label";
      windLabel.textContent = "Wind";
      windSection.appendChild(windLabel);

      const windGrid = doc.createElement("div");
      windGrid.className = "city-wind-grid";
      const wind = data.current;
      windGrid.appendChild(
        statCard(
          "windspeed",
          wind.windspeed == null ? "—" : `${Math.round(wind.windspeed)} km/h`
        )
      );
      windGrid.appendChild(
        statCard(
          "windgust",
          wind.windgust == null ? "—" : `${Math.round(wind.windgust)} km/h`
        )
      );
      windGrid.appendChild(statCard("winddir", wind.winddirLabel));
      windSection.appendChild(windGrid);

      const sunSection = doc.createElement("div");
      const sunLabel = doc.createElement("div");
      sunLabel.className = "city-section-label";
      sunLabel.textContent = "Sun & Moon";
      sunSection.appendChild(sunLabel);

      const sunGrid = doc.createElement("div");
      sunGrid.className = "city-sun-grid";
      sunGrid.appendChild(statCard("sunrise", wind.sunrise));
      sunGrid.appendChild(statCard("sunset", wind.sunset));
      sunGrid.appendChild(statCard("day length", wind.dayLengthLabel));
      sunGrid.appendChild(statCard("moonphase", wind.moonphaseLabel));
      sunSection.appendChild(sunGrid);

      windSunWrap.appendChild(windSection);
      windSunWrap.appendChild(sunSection);

      const forecast = doc.createElement("div");
      forecast.className = "city-forecast";

      const forecastHead = doc.createElement("div");
      forecastHead.className = "city-forecast-row";
      forecastHead.style.borderBottom = "0.5px solid rgba(255,255,255,0.08)";

      const dayHead = doc.createElement("div");
      dayHead.className = "city-forecast-row-head";
      dayHead.textContent = "Day";

      const condHead = doc.createElement("div");
      condHead.className = "city-forecast-row-head";
      condHead.textContent = "Condition";

      const probHead = doc.createElement("div");
      probHead.className = "city-forecast-row-head";
      probHead.textContent = "Precip %";

      const precipHead = doc.createElement("div");
      precipHead.className = "city-forecast-row-head";
      precipHead.textContent = "Precip mm";

      const tempHead = doc.createElement("div");
      tempHead.className = "city-forecast-row-head";
      tempHead.textContent = "Temp";

      forecastHead.appendChild(dayHead);
      forecastHead.appendChild(condHead);
      forecastHead.appendChild(probHead);
      forecastHead.appendChild(precipHead);
      forecastHead.appendChild(tempHead);
      forecast.appendChild(forecastHead);

      const days = data.days.slice(0, 7);
      days.forEach((d, i) => {
        const row = doc.createElement("div");
        row.className = "city-forecast-row";

        const day = doc.createElement("div");
        day.className = "city-forecast-cell";
        day.textContent = i === 0 ? "Today" : d.dayName;

        const cond = doc.createElement("div");
        cond.className = "city-forecast-cell";
        cond.textContent = d.conditionsShort;

        const prob = doc.createElement("div");
        prob.className = "city-forecast-cell city-forecast-cell--muted";
        prob.textContent = formatMaybePercent(d.precipprob);

        const precip = doc.createElement("div");
        precip.className = "city-forecast-cell city-forecast-cell--muted";
        precip.textContent = formatMaybePrecipMm(d.precipMm);

        const temp = doc.createElement("div");
        temp.className =
          "city-forecast-cell city-forecast-cell--muted city-forecast-cell-temp";
        temp.textContent = formatMaybeTempRange(d.tempmin, d.tempmax);

        row.appendChild(day);
        row.appendChild(cond);
        row.appendChild(prob);
        row.appendChild(precip);
        row.appendChild(temp);
        forecast.appendChild(row);
      });

      const divider1 = doc.createElement("div");
      divider1.className = "city-divider";
      const divider2 = doc.createElement("div");
      divider2.className = "city-divider";

      result.appendChild(hero);
      result.appendChild(divider1);
      result.appendChild(atmoLabel);
      result.appendChild(atmoGrid);
      result.appendChild(divider2);
      result.appendChild(windSunWrap);
      result.appendChild(forecast);
      setResultOpen(true);
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = input.value.trim();
      if (!query) {
        showError("Please enter a city name.");
        return;
      }

      this.cityAbortController?.abort();
      this.cityAbortController = new AbortController();
      const reqId = ++this.cityRequestId;

      showLoading();
      try {
        const data = await fetchWeatherForLocation(
          query,
          this.cityAbortController.signal
        );
        if (reqId !== this.cityRequestId) return;
        render(data);
      } catch (err) {
        if (reqId !== this.cityRequestId) return;
        const msg =
          err instanceof Error && err.message
            ? err.message
            : "City not found.";
        showError(msg);
      }
    });
  }

  private bindEvents() {
    this.renderer.domElement.addEventListener("mousemove", (event) => {
      this.onPointerMove(event);
    });
    this.renderer.domElement.addEventListener("click", (event) => {
      this.onClick(event);
    });
    window.addEventListener("resize", () => this.fitRenderer());
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
    this.lastClientX = event.clientX;
    this.lastClientY = event.clientY;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    if (!this.globe) {
      this.clearHoverWeatherState();
      this.hideTooltip();
      this.setHoveredCountry(null);
      return;
    }

    const hit = this.raycaster.intersectObject(this.globe, false);
    if (hit.length === 0) {
      this.clearHoverWeatherState();
      this.hideTooltip();
      this.setHoveredCountry(null);
      return;
    }

    const latLon = this.getLatLonFromGlobeHit(hit[0].point);
    if (!latLon) {
      this.clearHoverWeatherState();
      this.hideTooltip();
      this.setHoveredCountry(null);
      return;
    }
    const { lat, lon } = latLon;
    const country = findCountryAtLatLon(this.countryPolygons, lat, lon);

    if (!country) {
      this.clearHoverWeatherState();
      this.hideTooltip();
      this.setHoveredCountry(null);
      return;
    }

    this.setHoveredCountry(country.id);
    if (country.id !== this.hoveredWeatherCountryId) {
      this.hoveredWeatherCountryId = country.id;
      this.scheduleHoverWeather(country);
    } else {
      this.updateTooltipPosition(event.clientX, event.clientY);
    }
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
    this.clearHoverWeatherState(false);
    this.hideTooltip();
    this.showCountryPanel(selectedPolygon);

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

  /**
   * @param abortInFlight - Set false when opening the detail panel so an
   *   in-flight hover request can finish and warm the cache (avoids 429s and
   *   duplicate upstream calls for the same location).
   */
  private clearHoverWeatherState(abortInFlight = true) {
    this.hoverFetchGen++;
    this.hoveredWeatherCountryId = null;
    if (this.hoverWeatherDebounce !== null) {
      clearTimeout(this.hoverWeatherDebounce);
      this.hoverWeatherDebounce = null;
    }
    if (abortInFlight && this.hoverFetchAbort) {
      this.hoverFetchAbort.abort();
    }
    this.hoverFetchAbort = null;
  }

  private scheduleHoverWeather(country: CountryPolygon) {
    this.hoverFetchGen++;
    const gen = this.hoverFetchGen;

    if (this.hoverWeatherDebounce !== null) {
      clearTimeout(this.hoverWeatherDebounce);
      this.hoverWeatherDebounce = null;
    }
    if (this.hoverFetchAbort) {
      this.hoverFetchAbort.abort();
      this.hoverFetchAbort = null;
    }

    this.updateTooltipLines(this.lastClientX, this.lastClientY, [
      country.displayName,
      "Loading weather…",
    ]);

    this.hoverWeatherDebounce = window.setTimeout(async () => {
      this.hoverWeatherDebounce = null;
      if (gen !== this.hoverFetchGen) return;

      const ac = new AbortController();
      this.hoverFetchAbort = ac;
      try {
        const w = await fetchWeatherForLocation(
          weatherQueryFromPolygon(country),
          ac.signal
        );
        if (gen !== this.hoverFetchGen) return;
        this.updateTooltipLines(this.lastClientX, this.lastClientY, [
          country.displayName,
          formatWeatherCompact(w),
        ]);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (gen !== this.hoverFetchGen) return;
        this.updateTooltipLines(this.lastClientX, this.lastClientY, [
          country.displayName,
          "Weather unavailable",
        ]);
      } finally {
        if (this.hoverFetchAbort === ac) this.hoverFetchAbort = null;
      }
    }, 320);
  }

  private updateTooltipLines(x: number, y: number, lines: string[]) {
    if (!this.tooltipEl) return;
    this.tooltipEl.textContent = lines.join("\n");
    this.tooltipEl.style.display = "block";
    this.updateTooltipPosition(x, y);
  }

  private updateTooltipPosition(x: number, y: number) {
    if (!this.tooltipEl) return;
    this.tooltipEl.style.left = `${x + 10}px`;
    this.tooltipEl.style.top = `${y + 10}px`;
  }

  private hideTooltip() {
    if (this.tooltipEl) this.tooltipEl.style.display = "none";
  }

  private preventPageScroll = (event: Event) => {
    const target = event.target as Node | null;
    if (this.countryPanelEl && target && this.countryPanelEl.contains(target)) {
      return;
    }
    if (event instanceof WheelEvent || event instanceof TouchEvent) {
      event.preventDefault();
    }
    if (event instanceof KeyboardEvent) {
      const blockedKeys = [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        "Space",
      ];
      if (blockedKeys.includes(event.code)) {
        event.preventDefault();
      }
    }
  };

  private lockPageScroll() {
    if (this.countryPanelScrollLockActive) return;
    this.previousBodyOverflow = document.body.style.overflow || "";
    document.body.style.overflow = "hidden";
    document.addEventListener("wheel", this.preventPageScroll, { passive: false, capture: true });
    document.addEventListener("touchmove", this.preventPageScroll, { passive: false, capture: true });
    document.addEventListener("keydown", this.preventPageScroll, { capture: true });
    this.countryPanelScrollLockActive = true;
  }

  private unlockPageScroll() {
    if (!this.countryPanelScrollLockActive) return;
    document.removeEventListener("wheel", this.preventPageScroll, true);
    document.removeEventListener("touchmove", this.preventPageScroll, true);
    document.removeEventListener("keydown", this.preventPageScroll, true);
    document.body.style.overflow = this.previousBodyOverflow;
    this.previousBodyOverflow = "";
    this.countryPanelScrollLockActive = false;
  }

  private showCountryPanel(polygon: CountryPolygon) {
    if (!this.countryPanelEl) return;
    const root = this.countryPanelEl;
    root.replaceChildren();

    const windowBar = document.createElement("div");
    windowBar.className = "window-bar";

    const dots = document.createElement("div");
    dots.className = "window-dots";
    const redDot = document.createElement("span");
    redDot.className = "dot red";
    const yellowDot = document.createElement("span");
    yellowDot.className = "dot yellow";
    const greenDot = document.createElement("span");
    greenDot.className = "dot green";
    dots.appendChild(redDot);
    dots.appendChild(yellowDot);
    dots.appendChild(greenDot);

    const titleEl = document.createElement("div");
    titleEl.className = "window-title";
    titleEl.textContent = polygon.displayName;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Back to globe";
    closeBtn.style.border = "none";
    closeBtn.style.background = "rgba(255, 255, 255, 0.12)";
    closeBtn.style.color = "rgba(255, 255, 255, 0.92)";
    closeBtn.style.padding = "6px 10px";
    closeBtn.style.borderRadius = "999px";
    closeBtn.style.fontSize = "11px";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.marginLeft = "auto";
    closeBtn.style.transition = "background 0.2s ease";
    closeBtn.onmouseenter = () => {
      closeBtn.style.background = "rgba(255, 255, 255, 0.18)";
    };
    closeBtn.onmouseleave = () => {
      closeBtn.style.background = "rgba(255, 255, 255, 0.12)";
    };
    closeBtn.onclick = () => this.exitDetailView();

    const windowTitleWrapper = document.createElement("div");
    windowTitleWrapper.style.display = "flex";
    windowTitleWrapper.style.alignItems = "center";
    windowTitleWrapper.style.gap = "12px";
    windowTitleWrapper.style.width = "100%";
    windowTitleWrapper.appendChild(dots);
    windowTitleWrapper.appendChild(titleEl);
    windowTitleWrapper.appendChild(closeBtn);

    windowBar.appendChild(windowTitleWrapper);

    const windowBody = document.createElement("div");
    windowBody.className = "window-body";
    windowBody.style.overflowY = "auto";
    windowBody.style.padding = "14px 18px";
    windowBody.style.maxHeight = "calc(80vh - 46px)";
    windowBody.style.color = "rgba(255, 255, 255, 0.95)";

    const loading = document.createElement("p");
    loading.style.margin = "0 0 4px";
    loading.textContent = "Loading weather…";
    windowBody.appendChild(loading);

    root.appendChild(windowBar);
    root.appendChild(windowBody);
    root.style.minHeight = "320px";
    root.style.display = "block";
    if (this.countryPanelBackdropEl) {
      this.countryPanelBackdropEl.style.display = "block";
    }
    this.lockPageScroll();

    void (async () => {
      try {
        const w = await fetchWeatherForLocation(
          weatherQueryFromPolygon(polygon)
        );
        if (!this.countryPanelEl || this.countryPanelEl.style.display === "none")
          return;
        windowBody.style.minHeight = "0";
        windowBody.style.display = "block";
        windowBody.replaceChildren();
        renderWeatherDetail(windowBody, w);
      } catch {
        if (!this.countryPanelEl || this.countryPanelEl.style.display === "none")
          return;
        windowBody.replaceChildren();
        const err = document.createElement("p");
        err.style.margin = "0";
        err.textContent =
          "Could not load weather. Is Docker running and .env configured?";
        windowBody.appendChild(err);
      }
    })();
  }

  private hideCountryPanel() {
    if (this.countryPanelEl) this.countryPanelEl.style.display = "none";
    if (this.countryPanelBackdropEl) this.countryPanelBackdropEl.style.display = "none";
    this.unlockPageScroll();
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
