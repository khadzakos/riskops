'use client';

import React from 'react';

// ─── Path helpers ─────────────────────────────────────────────────────────────

function pathFromPoints(pts: [number, number][]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
}

function areaFromPoints(pts: [number, number][], y0: number): string {
  return (
    pathFromPoints(pts) +
    ` L${pts[pts.length - 1][0].toFixed(2)},${y0} L${pts[0][0].toFixed(2)},${y0} Z`
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

export function Sparkline({
  values,
  color = 'var(--primary)',
  height = 28,
  strokeW = 1.5,
  fill = true,
}: {
  values: number[];
  color?: string;
  height?: number;
  strokeW?: number;
  fill?: boolean;
}) {
  if (!values || values.length < 2) return null;
  const w = 200, h = height, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts: [number, number][] = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (w - pad * 2),
    pad + (1 - (v - min) / span) * (h - pad * 2),
  ]);
  return (
    <svg className="metric-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {fill && <path d={areaFromPoints(pts, h)} fill={color} opacity="0.08" />}
      <path d={pathFromPoints(pts)} fill="none" stroke={color} strokeWidth={strokeW} />
    </svg>
  );
}

// ─── Line chart ───────────────────────────────────────────────────────────────

export interface LineSeries {
  name: string;
  color: string;
  data: { x: number | string; y: number }[];
}

export function LineChart({
  series,
  height = 240,
  yFormat = (v: number) => v.toFixed(2),
  xFormat = (v: number | string) => String(v),
  xTicks = 6,
  yTicks = 5,
  dashedSeries = [] as string[],
  fillArea = false,
}: {
  series: LineSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  xFormat?: (v: number | string) => string;
  xTicks?: number;
  yTicks?: number;
  dashedSeries?: string[];
  fillArea?: boolean;
}) {
  if (!series.length || !series[0].data.length) return null;

  const w = 800, h = height;
  const padL = 52, padR = 18, padT = 12, padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  // Build a unified sorted X-axis from ALL series (union of all dates/values).
  // This ensures every series is plotted against the same X positions regardless
  // of whether individual series have different date coverage.
  const xSet = new Set<string>();
  series.forEach((s) => s.data.forEach((d) => xSet.add(String(d.x))));
  const allX = Array.from(xSet).sort();
  const xIndexMap = new Map<string, number>(allX.map((x, i) => [x, i]));

  const allY = series.flatMap((s) => s.data.map((d) => d.y));
  let yMin = Math.min(...allY), yMax = Math.max(...allY);
  const yPad = (yMax - yMin) * 0.08 || 1;
  yMin -= yPad; yMax += yPad;
  const xMax = allX.length - 1;

  const xScale = (i: number) => padL + (i / (xMax || 1)) * innerW;
  const yScale = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const yTickVals = Array.from({ length: yTicks }, (_, i) => yMin + (yMax - yMin) * i / (yTicks - 1));
  const xTickIdx = Array.from({ length: xTicks }, (_, i) => Math.round((allX.length - 1) * i / (xTicks - 1)));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={height} style={{ overflow: 'visible' }}>
      {yTickVals.map((v, i) => (
        <g key={i}>
          <line className="grid-line" x1={padL} x2={w - padR} y1={yScale(v)} y2={yScale(v)} />
          <text className="axis-label" x={padL - 6} y={yScale(v) + 3} textAnchor="end">{yFormat(v)}</text>
        </g>
      ))}
      {xTickIdx.map((idx, i) => (
        <text key={i} className="axis-label" x={xScale(idx)} y={h - padB + 14} textAnchor="middle">
          {xFormat(allX[idx])}
        </text>
      ))}
      {series.map((s, i) => {
        // Map each data point to its correct X position in the unified axis.
        // Only connect consecutive points that are adjacent in the unified axis
        // to avoid drawing lines across large gaps (missing data periods).
        const pts: [number, number][] = s.data
          .map((d) => {
            const xi = xIndexMap.get(String(d.x));
            if (xi === undefined) return null;
            return [xScale(xi), yScale(d.y)] as [number, number];
          })
          .filter((p): p is [number, number] => p !== null);

        if (pts.length === 0) return null;

        // Build path with M/L commands, inserting M (move) when there is a gap
        // larger than 5 unified-axis steps to avoid connecting distant points.
        const seriesXIndices = s.data
          .map((d) => xIndexMap.get(String(d.x)))
          .filter((xi): xi is number => xi !== undefined);

        let pathD = '';
        for (let k = 0; k < pts.length; k++) {
          const gap = k > 0 ? seriesXIndices[k] - seriesXIndices[k - 1] : 0;
          pathD += `${k === 0 || gap > 5 ? 'M' : 'L'}${pts[k][0].toFixed(2)},${pts[k][1].toFixed(2)} `;
        }

        const dashed = dashedSeries.includes(s.name);
        return (
          <g key={s.name}>
            {fillArea && i === 0 && (
              <path d={areaFromPoints(pts, padT + innerH)} fill={s.color} opacity="0.08" />
            )}
            <path
              d={pathD.trim()}
              fill="none"
              stroke={s.color}
              strokeWidth="1.6"
              strokeDasharray={dashed ? '4 3' : undefined}
            />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Histogram ────────────────────────────────────────────────────────────────

export function Histogram({
  bins,
  height = 180,
  color = 'var(--primary)',
  markers = [],
}: {
  bins: { x0: number; x1: number; count: number }[];
  height?: number;
  color?: string;
  markers?: { x: number; label: string; color: string }[];
}) {
  if (!bins || bins.length === 0) return null;
  const w = 800, h = height, padL = 40, padR = 8, padT = 8, padB = 24;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const maxCount = Math.max(...bins.map((b) => b.count));
  const xMin = bins[0].x0;
  const xMax = bins[bins.length - 1].x1;
  const xs = (v: number) => padL + ((v - xMin) / (xMax - xMin)) * innerW;
  const barH = (c: number) => (c / maxCount) * innerH;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={height}>
      <line className="grid-line" x1={padL} x2={w - padR} y1={padT + innerH} y2={padT + innerH} />
      {bins.map((b, i) => {
        const x = xs(b.x0);
        const bw = xs(b.x1) - x - 1;
        const bh = barH(b.count);
        const fill = b.x1 <= 0 ? 'var(--crit-soft)' : b.x0 >= 0 ? 'var(--good-soft)' : color;
        return <rect key={i} x={x} y={padT + innerH - bh} width={Math.max(bw, 1)} height={bh} fill={fill} />;
      })}
      {[xMin, (xMin + xMax) / 2, xMax].map((v, i) => (
        <text key={i} className="axis-label" x={xs(v)} y={h - padB + 14} textAnchor="middle">
          {(v * 100).toFixed(1)}%
        </text>
      ))}
      {markers.map((m, i) => (
        <g key={i}>
          <line x1={xs(m.x)} x2={xs(m.x)} y1={padT} y2={padT + innerH} stroke={m.color} strokeWidth="1.2" strokeDasharray="3 3" />
          <text className="axis-label" x={xs(m.x)} y={padT + 12} textAnchor="middle" fill={m.color} fontWeight="500">{m.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── Donut ────────────────────────────────────────────────────────────────────

export function Donut({
  data,
  size = 160,
  stroke = 22,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  stroke?: number;
}) {
  if (!data || data.length === 0) return null;
  const r = size / 2 - stroke / 2 - 2;
  const c = 2 * Math.PI * r;
  const total = data.reduce((s, d) => s + d.value, 0);
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--hair)" strokeWidth={stroke} />
      {data.map((d, i) => {
        const frac = d.value / total;
        const dash = frac * c;
        const off = -acc * c;
        acc += frac;
        return (
          <circle
            key={i}
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke={d.color}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${c - dash}`}
            strokeDashoffset={off}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
      })}
    </svg>
  );
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────

export function Heatmap({
  labels,
  matrix,
}: {
  labels: string[];
  matrix: number[][];
}) {
  if (!labels.length || !matrix.length) return null;
  const n = labels.length;
  const cell = Math.floor(420 / n);
  const w = cell * n + 80;
  const h = cell * n + 80;
  const color = (v: number) => {
    if (v >= 0) {
      const t = Math.abs(v);
      return `rgba(74, 107, 62, ${0.1 + t * 0.6})`;
    }
    const t = Math.abs(v);
    return `rgba(107, 31, 42, ${0.1 + t * 0.6})`;
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%">
      {labels.map((l, i) => (
        <text key={'r' + i} className="axis-label" x={70} y={80 + cell * i + cell / 2 + 3} textAnchor="end" fontWeight="500">{l}</text>
      ))}
      {labels.map((l, i) => (
        <text key={'c' + i} className="axis-label" x={80 + cell * i + cell / 2} y={64} textAnchor="middle" fontWeight="500">{l}</text>
      ))}
      {matrix.map((row, i) =>
        row.map((v, j) => (
          <g key={`${i}-${j}`}>
            <rect x={80 + cell * j} y={80 + cell * i} width={cell - 1} height={cell - 1} fill={color(v)} />
            <text
              className="axis-label"
              x={80 + cell * j + cell / 2}
              y={80 + cell * i + cell / 2 + 3}
              textAnchor="middle"
              fill="var(--ink-2)"
              fontFamily="var(--mono)"
              fontSize="10"
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))
      )}
    </svg>
  );
}

// ─── Returns → histogram bins ─────────────────────────────────────────────────

export function makeBins(
  returns: number[],
  min = -0.06,
  max = 0.06,
  nb = 40
): { x0: number; x1: number; count: number }[] {
  const step = (max - min) / nb;
  const arr = Array.from({ length: nb }, (_, i) => ({ x0: min + i * step, x1: min + (i + 1) * step, count: 0 }));
  returns.forEach((r) => {
    const i = Math.min(nb - 1, Math.max(0, Math.floor((r - min) / step)));
    arr[i].count++;
  });
  return arr;
}
