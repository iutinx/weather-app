import type { CountryPolygon } from "../ui/world/geo";
import { appendForecastCharts } from "../ui/weatherCharts";

/** Parsed Visual Crossing timeline payload for UI. */
export type WeatherData = {
  locationLabel: string;
  latitude: number | null;
  longitude: number | null;
  localTimeDisplay: string;
  current: {
    temp: number | null;
    feelslike: number | null;
    conditions: string;
    iconBadge: string;
    humidity: number | null;
    dew: number | null;
    pressure: number | null;
    visibility: number | null;
    cloudcover: number | null;
    uvindex: number | null;
    solarradiation: number | null;
    precipprob: number | null;
    windspeed: number | null;
    windgust: number | null;
    winddirDeg: number | null;
    winddirLabel: string;
    sunrise: string;
    sunset: string;
    moonphaseLabel: string;
    dayLengthLabel: string;
  };
  todayHigh: number | null;
  todayLow: number | null;
  /** Numeric series for SVG charts (aligned with `days`). */
  forecastSeries: Array<{
    shortLabel: string;
    tempmin: number | null;
    tempmax: number | null;
    precip: number | null;
  }>;
  days: Array<{
    dayName: string;
    datetime: string;
    conditionsShort: string;
    precipprob: number | null;
    precipMm: number | null;
    tempmin: number | null;
    tempmax: number | null;
    precipLabel: string;
    tempRangeLabel: string;
  }>;
};

type ApiCurrent = {
  datetime?: string;
  temp?: number;
  feelslike?: number;
  conditions?: string;
  icon?: string;
  humidity?: number;
  dew?: number;
  pressure?: number;
  visibility?: number;
  cloudcover?: number;
  uvindex?: number;
  solarradiation?: number;
  precipprob?: number;
  windspeed?: number;
  windgust?: number;
  winddir?: number;
  sunrise?: string;
  sunset?: string;
  sunriseEpoch?: number;
  sunsetEpoch?: number;
  moonphase?: number;
};

type ApiDay = {
  datetime?: string;
  conditions?: string;
  precip?: number;
  precipprob?: number;
  tempmin?: number;
  tempmax?: number;
};

type ApiPayload = {
  resolvedAddress?: string;
  address?: string;
  tzoffset?: number;
  latitude?: number;
  longitude?: number;
  currentConditions?: ApiCurrent;
  days?: ApiDay[];
};

// per-location: reuse API results for this long before allowing another request.
const WEATHER_CLIENT_CACHE_TTL_MS = 30 * 60 * 1000;

type WeatherCacheEntry = {
  fetchedAt: number;
  data: WeatherData;
};

const weatherCacheByLocation = new Map<string, WeatherCacheEntry>();

// one network request per location at a time; concurrent callers share the result.
const inFlightByLocation = new Map<string, Promise<WeatherData>>();

function cacheKeyForQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

export function degreesToCardinal(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const ix = Math.round(d / 45) % 8;
  return dirs[ix];
}

function windDirectionLabel(deg: number | null): string {
  if (deg == null) return "—";
  return `${degreesToCardinal(deg)} (${Math.round(deg)}°)`;
}

const MOON_PHASES = [
  "new",
  "waxing crescent",
  "first quarter",
  "waxing gibbous",
  "full",
  "waning gibbous",
  "last quarter",
  "waning crescent",
] as const;

export function moonPhaseToLabel(phase: number | null | undefined): string {
  if (phase == null || Number.isNaN(phase)) return "—";
  let p = phase % 1;
  if (p < 0) p += 1;
  const i = Math.round(p * 8) % 8;
  return MOON_PHASES[i];
}

export function formatDayLengthSeconds(
  sunriseEpoch: number | undefined,
  sunsetEpoch: number | undefined
): string {
  if (
    sunriseEpoch == null ||
    sunsetEpoch == null ||
    !Number.isFinite(sunriseEpoch) ||
    !Number.isFinite(sunsetEpoch)
  ) {
    return "—";
  }
  const sec = Math.max(0, sunsetEpoch - sunriseEpoch);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatLocationLocalTime(
  datetime: string | undefined,
  tzoffset: number | undefined
): string {
  if (!datetime) return "—";
  const m = datetime.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!m) return datetime;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const mo = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const year = m[1];
  let h24 = parseInt(m[4], 10);
  const min = m[5];
  const h12 = h24 % 12 || 12;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const tzStr =
    tzoffset != null && Number.isFinite(tzoffset)
      ? ` · UTC${tzoffset >= 0 ? "+" : ""}${tzoffset}`
      : "";
  return `${months[mo]} ${day}, ${year} · ${h12}:${min} ${ampm}${tzStr}`;
}

function iconToBadge(icon: string | undefined): string {
  if (!icon) return "—";
  return icon
    .split("-")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function shortConditions(s: string | undefined): string {
  if (!s) return "—";
  const first = s.split(",")[0]?.trim();
  return first || "—";
}

function precipDisplay(mm: number | null): string {
  if (mm == null || Number.isNaN(mm) || mm === 0) return "—";
  return `${mm} mm`;
}

function forecastDayLabel(dayDatetime: string, index: number): string {
  if (index === 0) return "Today";
  const m = dayDatetime.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dayDatetime;
  const date = new Date(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10)
  );
  return date.toLocaleDateString(undefined, { weekday: "long" });
}

function shortForecastLabel(dayDatetime: string, index: number): string {
  if (index === 0) return "Today";
  const m = dayDatetime.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "—";
  const date = new Date(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10)
  );
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

function roundTemp(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n)}`;
}

function parseWeatherFromApi(
  data: ApiPayload,
  fallbackQuery: string
): WeatherData {
  const cur = data.currentConditions ?? {};
  const curAny = cur as ApiCurrent & Record<string, unknown>;
  const tz = data.tzoffset;
  const datetime = cur.datetime;
  const windDir = numOrNull(cur.winddir);

  const daysRaw = Array.isArray(data.days) ? data.days : [];
  const day0 = daysRaw[0];

  const daysOut = daysRaw.slice(0, 15).map((d, i) => {
    const tmin = numOrNull(d.tempmin);
    const tmax = numOrNull(d.tempmax);
    const range =
      tmin != null && tmax != null
        ? `${roundTemp(tmin)}–${roundTemp(tmax)} °C`
        : "—";
    const precip = numOrNull(d.precip);
    const precipprob = numOrNull((d as any).precipprob);
    return {
      dayName: forecastDayLabel(String(d.datetime ?? ""), i),
      datetime: String(d.datetime ?? ""),
      conditionsShort: shortConditions(d.conditions),
      precipprob,
      precipMm: precip,
      tempmin: tmin,
      tempmax: tmax,
      precipLabel: precipDisplay(precip),
      tempRangeLabel: range,
    };
  });

  const forecastSeries = daysRaw.slice(0, 15).map((d, i) => ({
    shortLabel: shortForecastLabel(String(d.datetime ?? ""), i),
    tempmin: numOrNull(d.tempmin),
    tempmax: numOrNull(d.tempmax),
    precip: numOrNull(d.precip),
  }));

  return {
    locationLabel: data.resolvedAddress ?? data.address ?? fallbackQuery,
    latitude: numOrNull(data.latitude),
    longitude: numOrNull(data.longitude),
    localTimeDisplay: formatLocationLocalTime(datetime, tz),
    current: {
      temp: numOrNull(cur.temp),
      feelslike: numOrNull(cur.feelslike),
      conditions: String(cur.conditions ?? "—"),
      iconBadge: iconToBadge(cur.icon),
      humidity: numOrNull(cur.humidity),
      dew: numOrNull(cur.dew),
      pressure: numOrNull(cur.pressure),
      visibility: numOrNull(cur.visibility),
      cloudcover: numOrNull(cur.cloudcover),
      uvindex: numOrNull(cur.uvindex),
      solarradiation: numOrNull((curAny as any).solarradiation),
      precipprob: numOrNull((curAny as any).precipprob),
      windspeed: numOrNull(cur.windspeed),
      windgust: numOrNull(cur.windgust),
      winddirDeg: windDir,
      winddirLabel: windDirectionLabel(windDir),
      sunrise: String(cur.sunrise ?? "—"),
      sunset: String(cur.sunset ?? "—"),
      moonphaseLabel: moonPhaseToLabel(cur.moonphase),
      dayLengthLabel: formatDayLengthSeconds(cur.sunriseEpoch, cur.sunsetEpoch),
    },
    todayHigh: numOrNull(day0?.tempmax),
    todayLow: numOrNull(day0?.tempmin),
    forecastSeries,
    days: daysOut,
  };
}

function styleEl(
  el: HTMLElement,
  styles: Partial<CSSStyleDeclaration> & Record<string, string>
): void {
  Object.assign(el.style, styles);
}

function statItem(
  document: Document,
  label: string,
  value: string
): HTMLDivElement {
  const wrap = document.createElement("div");
  styleEl(wrap, {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  });
  const l = document.createElement("div");
  l.textContent = label;
  styleEl(l, { fontSize: "11px", opacity: "0.65", textTransform: "uppercase" });
  const v = document.createElement("div");
  v.textContent = value;
  styleEl(v, { fontSize: "14px", fontWeight: "500" });
  wrap.appendChild(l);
  wrap.appendChild(v);
  return wrap;
}

function sectionTitle(document: Document, text: string): HTMLDivElement {
  const h = document.createElement("h3");
  h.textContent = text;
  styleEl(h, {
    margin: "0 0 10px",
    fontSize: "12px",
    fontWeight: "600",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    opacity: "0.85",
    borderBottom: "1px solid rgba(148, 163, 184, 0.35)",
    paddingBottom: "6px",
  });
  return h;
}

/**
 * Fills `container` with the detailed weather layout (used in the country panel body).
 */
export function renderWeatherDetail(container: HTMLElement, data: WeatherData): void {
  const doc = container.ownerDocument;

  const hero = doc.createElement("div");
  styleEl(hero, {
    marginBottom: "18px",
    padding: "14px 0 16px",
    borderBottom: "1px solid rgba(148, 163, 184, 0.25)",
  });

  const locLine = doc.createElement("div");
  locLine.textContent = data.locationLabel;
  styleEl(locLine, { fontSize: "13px", fontWeight: "600", marginBottom: "4px" });

  const timeLine = doc.createElement("div");
  timeLine.textContent = data.localTimeDisplay;
  styleEl(timeLine, { fontSize: "12px", opacity: "0.7", marginBottom: "12px" });

  const tempRow = doc.createElement("div");
  styleEl(tempRow, {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: "10px 16px",
    marginBottom: "8px",
  });
  const mainTemp = doc.createElement("span");
  mainTemp.textContent =
    data.current.temp != null
      ? `${Math.round(data.current.temp)}°C`
      : "—";
  styleEl(mainTemp, { fontSize: "34px", fontWeight: "700", lineHeight: "1" });

  const feels = doc.createElement("span");
  feels.textContent =
    data.current.feelslike != null
      ? `Feels like ${Math.round(data.current.feelslike)}°C`
      : "Feels like —";
  styleEl(feels, { fontSize: "14px", opacity: "0.85" });

  const hiLo = doc.createElement("span");
  const th = roundTemp(data.todayHigh);
  const tl = roundTemp(data.todayLow);
  hiLo.textContent =
    th !== "—" && tl !== "—" ? `High / Low ${th}° / ${tl}°` : "High / Low —";
  styleEl(hiLo, { fontSize: "14px", opacity: "0.85" });

  tempRow.appendChild(mainTemp);
  tempRow.appendChild(feels);
  tempRow.appendChild(hiLo);

  const condLine = doc.createElement("div");
  condLine.textContent = data.current.conditions;
  styleEl(condLine, { fontSize: "15px", marginTop: "6px", marginBottom: "8px" });

  const badge = doc.createElement("span");
  badge.textContent = data.current.iconBadge;
  styleEl(badge, {
    display: "inline-block",
    fontSize: "11px",
    fontWeight: "600",
    padding: "4px 10px",
    borderRadius: "999px",
    background: "rgba(96, 165, 250, 0.25)",
    color: "#bfdbfe",
    border: "1px solid rgba(147, 197, 253, 0.45)",
  });

  hero.appendChild(locLine);
  hero.appendChild(timeLine);
  hero.appendChild(tempRow);
  hero.appendChild(condLine);
  hero.appendChild(badge);

  const atmoWrap = doc.createElement("section");
  styleEl(atmoWrap, { marginBottom: "16px" });
  atmoWrap.appendChild(sectionTitle(doc, "Atmosphere"));
  const atmoGrid = doc.createElement("div");
  styleEl(atmoGrid, {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px 16px",
  });
  const c = data.current;
  atmoGrid.appendChild(
    statItem(doc, "Humidity", c.humidity != null ? `${Math.round(c.humidity)}%` : "—")
  );
  atmoGrid.appendChild(
    statItem(doc, "Dew point", c.dew != null ? `${Math.round(c.dew)} °C` : "—")
  );
  atmoGrid.appendChild(
    statItem(
      doc,
      "Pressure",
      c.pressure != null ? `${Math.round(c.pressure)} hPa` : "—"
    )
  );
  atmoGrid.appendChild(
    statItem(
      doc,
      "Visibility",
      c.visibility != null ? `${c.visibility} km` : "—"
    )
  );
  atmoGrid.appendChild(
    statItem(
      doc,
      "Cloud cover",
      c.cloudcover != null ? `${Math.round(c.cloudcover)}%` : "—"
    )
  );
  atmoGrid.appendChild(
    statItem(
      doc,
      "UV index",
      c.uvindex != null ? `${Math.round(c.uvindex)}` : "—"
    )
  );
  atmoWrap.appendChild(atmoGrid);

  const windWrap = doc.createElement("section");
  styleEl(windWrap, { marginBottom: "16px" });
  windWrap.appendChild(sectionTitle(doc, "Wind"));
  const windGrid = doc.createElement("div");
  styleEl(windGrid, {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "12px 10px",
  });
  windGrid.appendChild(
    statItem(
      doc,
      "Speed",
      c.windspeed != null ? `${Math.round(c.windspeed)} km/h` : "—"
    )
  );
  windGrid.appendChild(
    statItem(
      doc,
      "Gust",
      c.windgust != null ? `${Math.round(c.windgust)} km/h` : "—"
    )
  );
  windGrid.appendChild(statItem(doc, "Direction", c.winddirLabel));
  windWrap.appendChild(windGrid);

  const sunWrap = doc.createElement("section");
  styleEl(sunWrap, { marginBottom: "16px" });
  sunWrap.appendChild(sectionTitle(doc, "Sun & Moon"));
  const sunGrid = doc.createElement("div");
  styleEl(sunGrid, {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px 16px",
  });
  sunGrid.appendChild(statItem(doc, "Sunrise", c.sunrise));
  sunGrid.appendChild(statItem(doc, "Sunset", c.sunset));
  sunGrid.appendChild(
    statItem(doc, "Moon phase", c.moonphaseLabel)
  );
  sunGrid.appendChild(statItem(doc, "Day length", c.dayLengthLabel));
  sunWrap.appendChild(sunGrid);

  const fcWrap = doc.createElement("section");
  fcWrap.appendChild(sectionTitle(doc, "Forecast"));
  const fcTable = doc.createElement("div");
  styleEl(fcTable, { display: "flex", flexDirection: "column", gap: "0" });

  const headerRow = doc.createElement("div");
  styleEl(headerRow, {
    display: "grid",
    gridTemplateColumns: "minmax(72px,0.9fr) 1.1fr minmax(52px,0.6fr) minmax(88px,0.95fr)",
    gap: "8px",
    padding: "6px 0",
    fontSize: "10px",
    opacity: "0.6",
    textTransform: "uppercase",
    borderBottom: "1px solid rgba(148, 163, 184, 0.35)",
  });
  ["Day", "Condition", "Precip", "Temps"].forEach((t) => {
    const c = doc.createElement("div");
    c.textContent = t;
    headerRow.appendChild(c);
  });
  fcTable.appendChild(headerRow);

  data.days.forEach((row, i) => {
    const r = doc.createElement("div");
    styleEl(r, {
      display: "grid",
      gridTemplateColumns: "minmax(72px,0.9fr) 1.1fr minmax(52px,0.6fr) minmax(88px,0.95fr)",
      gap: "8px",
      padding: "10px 0",
      fontSize: "13px",
      borderBottom:
        i < data.days.length - 1 ? "1px solid rgba(148, 163, 184, 0.15)" : "none",
    });
    const d0 = doc.createElement("div");
    d0.textContent = row.dayName;
    d0.style.fontWeight = i === 0 ? "600" : "400";
    const d1 = doc.createElement("div");
    d1.textContent = row.conditionsShort;
    d1.style.opacity = "0.92";
    const d2 = doc.createElement("div");
    d2.textContent = row.precipLabel;
    const d3 = doc.createElement("div");
    d3.textContent = row.tempRangeLabel;
    r.appendChild(d0);
    r.appendChild(d1);
    r.appendChild(d2);
    r.appendChild(d3);
    fcTable.appendChild(r);
  });

  fcWrap.appendChild(fcTable);

  container.appendChild(hero);
  container.appendChild(atmoWrap);
  container.appendChild(windWrap);
  container.appendChild(sunWrap);
  appendForecastCharts(container, data);
  container.appendChild(fcWrap);
}

export function weatherQueryFromPolygon(p: CountryPolygon): string {
  if (p.name === p.countryName) return p.countryName;
  return `${p.name}, ${p.countryName}`;
}

export function formatWeatherCompact(w: WeatherData): string {
  const temp =
    w.current.temp != null && !Number.isNaN(w.current.temp)
      ? `${Math.round(w.current.temp)}°C`
      : "—";
  return `${w.current.conditions} · ${temp}`;
}

function followWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}

export async function fetchWeatherForLocation(
  query: string,
  signal?: AbortSignal
): Promise<WeatherData> {
  const key = cacheKeyForQuery(query);
  const now = Date.now();
  const cached = weatherCacheByLocation.get(key);
  if (cached && now - cached.fetchedAt < WEATHER_CLIENT_CACHE_TTL_MS) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    return {
      ...cached.data,
      days: [...cached.data.days],
      forecastSeries: cached.data.forecastSeries.map((p) => ({ ...p })),
    };
  }

  const existing = inFlightByLocation.get(key);
  if (existing) {
    const data = await followWithAbort(existing, signal);
    return {
      ...data,
      days: [...data.days],
      forecastSeries: data.forecastSeries.map((p) => ({ ...p })),
    };
  }

  const trimmed = query.trim();
  const url = `/api/weather/${encodeURIComponent(trimmed)}`;

  const inflight = (async (): Promise<WeatherData> => {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text.trim() || res.statusText);
    }
    const raw = (await res.json()) as ApiPayload;
    const data = parseWeatherFromApi(raw, trimmed);
    weatherCacheByLocation.set(key, {
      fetchedAt: Date.now(),
      data: {
        ...data,
        days: [...data.days],
        forecastSeries: data.forecastSeries.map((p) => ({ ...p })),
      },
    });
    return data;
  })();

  inflight.finally(() => {
    if (inFlightByLocation.get(key) === inflight) {
      inFlightByLocation.delete(key);
    }
  });

  inFlightByLocation.set(key, inflight);

  const data = await followWithAbort(inflight, signal);
  return {
    ...data,
    days: [...data.days],
    forecastSeries: data.forecastSeries.map((p) => ({ ...p })),
  };
}
