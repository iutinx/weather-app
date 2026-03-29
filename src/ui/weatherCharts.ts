import type { WeatherData } from "../api/weather";

function styleEl(
  el: HTMLElement,
  styles: Partial<CSSStyleDeclaration> & Record<string, string>
): void {
  Object.assign(el.style, styles);
}

const NS = "http://www.w3.org/2000/svg";

function chartSectionTitle(doc: Document, text: string): HTMLHeadingElement {
  const h = doc.createElement("h3");
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

function yAxisLabels(
  doc: Document,
  svg: SVGSVGElement,
  pad: { t: number; r: number; b: number; l: number },
  innerH: number,
  yMin: number,
  yMax: number,
  ticks: number
): void {
  for (let i = 0; i <= ticks; i++) {
    const t = yMin + (i / ticks) * (yMax - yMin);
    const y = pad.t + innerH - (i / ticks) * innerH;
    const text = doc.createElementNS(NS, "text");
    text.setAttribute("x", String(pad.l - 6));
    text.setAttribute("y", String(y + 4));
    text.setAttribute("text-anchor", "end");
    text.setAttribute("fill", "rgba(203, 213, 225, 0.75)");
    text.setAttribute("font-size", "10");
    text.textContent = `${Math.round(t)}°`;
    svg.appendChild(text);
  }
}

function temperatureRangeChart(
  doc: Document,
  series: WeatherData["forecastSeries"]
): HTMLElement | null {
  const w = 340;
  const h = 152;
  const pad = { t: 10, r: 10, b: 30, l: 38 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const points: Array<{ i: number; min: number; max: number }> = [];
  series.forEach((d, i) => {
    if (d.tempmin != null && d.tempmax != null) {
      points.push({ i, min: d.tempmin, max: d.tempmax });
    }
  });
  if (points.length === 0) return null;

  const all = points.flatMap((p) => [p.min, p.max]);
  const yMin = Math.floor(Math.min(...all) - 1);
  const yMax = Math.ceil(Math.max(...all) + 1);
  const ySpan = Math.max(yMax - yMin, 1);

  const n = series.length;
  const xAt = (i: number) =>
    pad.l + (n <= 1 ? innerW / 2 : (i / Math.max(n - 1, 1)) * innerW);
  const yScale = (t: number) => pad.t + innerH - ((t - yMin) / ySpan) * innerH;

  const svg = doc.createElementNS(NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", `${h}`);
  svg.style.display = "block";
  svg.style.maxWidth = "100%";

  yAxisLabels(doc, svg, pad, innerH, yMin, yMax, 4);

  const maxPts = points.map((p) => `${xAt(p.i)},${yScale(p.max)}`).join(" ");
  const minPtsRev = [...points]
    .reverse()
    .map((p) => `${xAt(p.i)},${yScale(p.min)}`)
    .join(" ");
  const poly = doc.createElementNS(NS, "polygon");
  poly.setAttribute("points", `${maxPts} ${minPtsRev}`);
  poly.setAttribute("fill", "rgba(251, 146, 60, 0.18)");
  poly.setAttribute("stroke", "none");
  svg.appendChild(poly);

  const maxPath = doc.createElementNS(NS, "polyline");
  maxPath.setAttribute(
    "points",
    points.map((p) => `${xAt(p.i)},${yScale(p.max)}`).join(" ")
  );
  maxPath.setAttribute("fill", "none");
  maxPath.setAttribute("stroke", "#fb923c");
  maxPath.setAttribute("stroke-width", "2");
  maxPath.setAttribute("stroke-linejoin", "round");
  svg.appendChild(maxPath);

  const minPath = doc.createElementNS(NS, "polyline");
  minPath.setAttribute(
    "points",
    points.map((p) => `${xAt(p.i)},${yScale(p.min)}`).join(" ")
  );
  minPath.setAttribute("fill", "none");
  minPath.setAttribute("stroke", "#38bdf8");
  minPath.setAttribute("stroke-width", "2");
  minPath.setAttribute("stroke-linejoin", "round");
  svg.appendChild(minPath);

  points.forEach((p) => {
    const cx = xAt(p.i);
    for (const [cy, fill] of [
      [yScale(p.max), "#fb923c"],
      [yScale(p.min), "#38bdf8"],
    ] as const) {
      const c = doc.createElementNS(NS, "circle");
      c.setAttribute("cx", String(cx));
      c.setAttribute("cy", String(cy));
      c.setAttribute("r", "3");
      c.setAttribute("fill", fill);
      svg.appendChild(c);
    }
  });

  const labelStride = Math.max(1, Math.ceil(n / 8));
  series.forEach((d, i) => {
    if (i % labelStride !== 0 && i !== n - 1 && i !== 0) return;
    const label = doc.createElementNS(NS, "text");
    label.setAttribute("x", String(xAt(i)));
    label.setAttribute("y", String(h - 8));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("fill", "rgba(203, 213, 225, 0.85)");
    label.setAttribute("font-size", "9");
    label.textContent = d.shortLabel;
    svg.appendChild(label);
  });

  const leg = doc.createElement("div");
  styleEl(leg, {
    display: "flex",
    gap: "14px",
    marginTop: "6px",
    fontSize: "11px",
    opacity: "0.85",
  });
  const hi = doc.createElement("span");
  hi.innerHTML =
    '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#fb923c;vertical-align:middle;margin-right:6px"></span>High';
  const lo = doc.createElement("span");
  lo.innerHTML =
    '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#38bdf8;vertical-align:middle;margin-right:6px"></span>Low';
  leg.appendChild(hi);
  leg.appendChild(lo);

  const holder = doc.createElement("div");
  holder.appendChild(svg);
  holder.appendChild(leg);
  return holder;
}

function precipBarChart(
  doc: Document,
  series: WeatherData["forecastSeries"]
): HTMLElement | null {
  const precips = series.map((d) =>
    d.precip != null && !Number.isNaN(d.precip) ? d.precip : 0
  );
  const maxRaw = Math.max(...precips, 0);
  const scaleMax = maxRaw > 0 ? maxRaw : 1;
  const w = 340;
  const h = 120;
  const pad = { t: 8, r: 8, b: 28, l: 8 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const n = series.length;
  if (n === 0) return null;

  const slotW = innerW / n;
  const barW = Math.max(3, slotW * 0.55);

  const svg = doc.createElementNS(NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", `${h}`);
  svg.style.display = "block";
  svg.style.maxWidth = "100%";

  const baselineY = pad.t + innerH;
  const line = doc.createElementNS(NS, "line");
  line.setAttribute("x1", String(pad.l));
  line.setAttribute("x2", String(w - pad.r));
  line.setAttribute("y1", String(baselineY));
  line.setAttribute("y2", String(baselineY));
  line.setAttribute("stroke", "rgba(148, 163, 184, 0.35)");
  line.setAttribute("stroke-width", "1");
  svg.appendChild(line);

  const labelStride = Math.max(1, Math.ceil(n / 8));

  series.forEach((d, i) => {
    const p = precips[i];
    const bh = (p / scaleMax) * innerH;
    const cx = pad.l + slotW * i + (slotW - barW) / 2;
    const rect = doc.createElementNS(NS, "rect");
    rect.setAttribute("x", String(cx));
    rect.setAttribute("y", String(baselineY - bh));
    rect.setAttribute("width", String(barW));
    rect.setAttribute("height", String(p > 0 ? Math.max(bh, 2) : 0));
    rect.setAttribute("rx", "2");
    rect.setAttribute(
      "fill",
      p > 0 ? "rgba(56, 189, 248, 0.78)" : "rgba(148, 163, 184, 0.08)"
    );
    svg.appendChild(rect);

    if (i % labelStride === 0 || i === n - 1 || i === 0) {
      const label = doc.createElementNS(NS, "text");
      label.setAttribute("x", String(cx + barW / 2));
      label.setAttribute("y", String(h - 6));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", "rgba(203, 213, 225, 0.85)");
      label.setAttribute("font-size", "9");
      label.textContent = d.shortLabel;
      svg.appendChild(label);
    }
  });

  const cap = doc.createElement("div");
  styleEl(cap, { fontSize: "11px", opacity: "0.7", marginTop: "4px" });
  cap.textContent =
    maxRaw > 0
      ? `Daily total (mm) · peak ${maxRaw.toFixed(1)} mm in this window`
      : "Daily total (mm) · no measurable rain in this window";

  const holder = doc.createElement("div");
  holder.appendChild(svg);
  holder.appendChild(cap);
  return holder;
}

/** Inserts temperature band + precipitation bar charts into the panel. */
export function appendForecastCharts(container: HTMLElement, data: WeatherData): void {
  const doc = container.ownerDocument;
  const series = data.forecastSeries;
  if (!series.length) return;

  const section = doc.createElement("section");
  styleEl(section, { marginBottom: "16px" });

  section.appendChild(chartSectionTitle(doc, "Forecast charts"));

  const tempWrap = doc.createElement("div");
  styleEl(tempWrap, { marginBottom: "18px" });
  tempWrap.appendChild(chartSectionTitle(doc, "Daily high / low"));
  const tempChart = temperatureRangeChart(doc, series);
  if (tempChart) tempWrap.appendChild(tempChart);
  else {
    const p = doc.createElement("p");
    styleEl(p, { margin: "0", fontSize: "12px", opacity: "0.65" });
    p.textContent = "Not enough temperature data to chart.";
    tempWrap.appendChild(p);
  }
  section.appendChild(tempWrap);

  const precipWrap = doc.createElement("div");
  precipWrap.appendChild(chartSectionTitle(doc, "Precipitation"));
  const precipChart = precipBarChart(doc, series);
  if (precipChart) precipWrap.appendChild(precipChart);
  section.appendChild(precipWrap);

  container.appendChild(section);
}
