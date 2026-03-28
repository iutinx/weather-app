import type { CountryPolygon } from "../ui/world/geo";

export type WeatherSummary = {
  locationLabel: string;
  conditions: string;
  tempC: number | null;
  humidity: number | null;
  windKmh: number | null;
};

// per-location: reuse API results for this long before allowing another request. 
const WEATHER_CLIENT_CACHE_TTL_MS = 30 * 60 * 1000;

type WeatherCacheEntry = {
  fetchedAt: number;
  summary: WeatherSummary;
};

const weatherCacheByLocation = new Map<string, WeatherCacheEntry>();

// one network request per location at a time; concurrent callers share the result. 
const inFlightByLocation = new Map<string, Promise<WeatherSummary>>();

function cacheKeyForQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function summaryFromApiJson(
  data: {
    resolvedAddress?: string;
    address?: string;
    currentConditions?: {
      conditions?: string;
      temp?: number;
      humidity?: number;
      windspeed?: number;
    };
  },
  fallbackQuery: string
): WeatherSummary {
  const cur = data.currentConditions ?? {};
  const temp =
    typeof cur.temp === "number" && !Number.isNaN(cur.temp) ? cur.temp : null;
  const humidity =
    typeof cur.humidity === "number" && !Number.isNaN(cur.humidity)
      ? cur.humidity
      : null;
  const windKmh =
    typeof cur.windspeed === "number" && !Number.isNaN(cur.windspeed)
      ? cur.windspeed
      : null;

  return {
    locationLabel: data.resolvedAddress ?? data.address ?? fallbackQuery,
    conditions: String(cur.conditions ?? "—"),
    tempC: temp,
    humidity,
    windKmh,
  };
}

export function weatherQueryFromPolygon(p: CountryPolygon): string {
  if (p.name === p.countryName) return p.countryName;
  return `${p.name}, ${p.countryName}`;
}

export function formatWeatherCompact(w: WeatherSummary): string {
  const temp =
    w.tempC != null && !Number.isNaN(w.tempC)
      ? `${Math.round(w.tempC)}°C`
      : "—";
  return `${w.conditions} · ${temp}`;
}

export function formatWeatherLines(w: WeatherSummary): string[] {
  const temp =
    w.tempC != null && !Number.isNaN(w.tempC)
      ? `${Math.round(w.tempC)}`
      : "—";
  const hum =
    w.humidity != null && !Number.isNaN(w.humidity)
      ? `${Math.round(w.humidity)}`
      : "—";
  const wind =
    w.windKmh != null && !Number.isNaN(w.windKmh)
      ? `${Math.round(w.windKmh)}`
      : "—";

  return [
    `Current: ${w.conditions}`,
    `Temperature: ${temp} °C`,
    `Humidity: ${hum} %`,
    `Wind: ${wind} km/h`,
  ];
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
): Promise<WeatherSummary> {
  const key = cacheKeyForQuery(query);
  const now = Date.now();
  const cached = weatherCacheByLocation.get(key);
  if (cached && now - cached.fetchedAt < WEATHER_CLIENT_CACHE_TTL_MS) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    return { ...cached.summary };
  }

  const existing = inFlightByLocation.get(key);
  if (existing) {
    const summary = await followWithAbort(existing, signal);
    return { ...summary };
  }

  const trimmed = query.trim();
  const url = `/api/weather/${encodeURIComponent(trimmed)}`;

  const inflight = (async (): Promise<WeatherSummary> => {
    const res = await fetch(url);
    console.log(res); // api calls are working
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text.trim() || res.statusText);
    }
    const data = (await res.json()) as Parameters<
      typeof summaryFromApiJson
    >[0];
    const summary = summaryFromApiJson(data, trimmed);
    weatherCacheByLocation.set(key, { fetchedAt: Date.now(), summary });
    return summary;
  })();

  inflight.finally(() => {
    if (inFlightByLocation.get(key) === inflight) {
      inFlightByLocation.delete(key);
    }
  });

  inFlightByLocation.set(key, inflight);

  const summary = await followWithAbort(inflight, signal);
  return { ...summary };
}
