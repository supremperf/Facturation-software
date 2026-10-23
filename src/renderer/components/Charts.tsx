import { useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { euroCompact, numberFR } from '../lib/format';

/* ------------------------------------------------------------------ */
/* Courbe sparkline                                                    */
/* ------------------------------------------------------------------ */

export function Sparkline({
  values,
  color = '#6c5ce7',
  height = 40,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  const width = 140;
  const clean = values.length ? values : [0, 0];
  const max = Math.max(...clean, 1);
  const min = Math.min(...clean, 0);
  const range = max - min || 1;
  const points = clean.map((value, index) => {
    const x = (index / Math.max(clean.length - 1, 1)) * width;
    const y = height - 4 - ((value - min) / range) * (height - 10);
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gradientId = useId().replace(/:/g, '');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.34" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Courbe principale                                                   */
/* ------------------------------------------------------------------ */

interface AreaPoint {
  label: string;
  value: number;
}

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  let path = `M${points[0].x},${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const tension = 0.18;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;
    path += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return path;
}

function niceMax(value: number): number {
  if (value <= 0) return 100;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const normalized = value / base;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * base;
}

export function AreaChart({
  data,
  color = '#6c5ce7',
  height = 280,
  secondary,
  secondaryColor = '#8b5cf6',
}: {
  data: AreaPoint[];
  color?: string;
  height?: number;
  secondary?: AreaPoint[];
  secondaryColor?: string;
}) {
  const gradientId = useId().replace(/:/g, '');
  const container = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const width = 820;
  const padding = { top: 16, right: 16, bottom: 30, left: 62 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = niceMax(
    Math.max(0, ...data.map((point) => point.value), ...(secondary?.map((point) => point.value) ?? [])),
  );

  const toPoints = (series: AreaPoint[]) =>
    series.map((point, index) => ({
      x: padding.left + (series.length <= 1 ? innerWidth / 2 : (index / (series.length - 1)) * innerWidth),
      y: padding.top + innerHeight - (point.value / maxValue) * innerHeight,
    }));

  const points = useMemo(() => toPoints(data), [data, maxValue, height]);
  void toPoints;
  const secondaryPoints = secondary ? toPoints(secondary) : null;
  const line = smoothPath(points);
  const area = points.length
    ? `${line} L${points[points.length - 1].x},${padding.top + innerHeight} L${points[0].x},${padding.top + innerHeight} Z`
    : '';

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxValue * ratio);

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const rect = container.current?.getBoundingClientRect();
    if (!rect || data.length === 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = (x - padding.left) / innerWidth;
    const index = Math.round(ratio * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, index)));
  };

  const active = hover !== null ? data[hover] : null;
  const activePoint = hover !== null ? points[hover] : null;
  const tooltipLeft = activePoint ? (activePoint.x / width) * 100 : 0;

  return (
    <div
      className="chart"
      ref={container}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      style={{ height }}
    >
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Évolution du chiffre d’affaires">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="70%" stopColor={color} stopOpacity="0.06" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridValues.map((value, index) => {
          const y = padding.top + innerHeight - (value / maxValue) * innerHeight;
          return (
            <g key={value}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="chart-grid" />
              {index > 0 ? (
                <text x={padding.left - 10} y={y + 4} textAnchor="end" className="chart-axis-label">
                  {euroCompact(value)}
                </text>
              ) : null}
            </g>
          );
        })}
        {area ? <path d={area} fill={`url(#${gradientId})`} /> : null}
        {secondaryPoints ? (
          <path
            d={smoothPath(secondaryPoints)}
            fill="none"
            stroke={secondaryColor}
            strokeWidth="1.5"
            strokeDasharray="5 5"
            opacity="0.7"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {line ? <path d={line} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" /> : null}
        {data.map((point, index) => {
          const px = padding.left + (data.length <= 1 ? innerWidth / 2 : (index / (data.length - 1)) * innerWidth);
          const showLabel = data.length <= 12 || index % Math.ceil(data.length / 8) === 0;
          return showLabel ? (
            <text key={point.label + index} x={px} y={height - 8} textAnchor="middle" className="chart-axis-label">
              {point.label}
            </text>
          ) : null;
        })}
        {activePoint ? (
          <g>
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={padding.top}
              y2={padding.top + innerHeight}
              className="chart-hover-line"
            />
            <circle cx={activePoint.x} cy={activePoint.y} r="4.5" fill={color} stroke="#0b1220" strokeWidth="2" />
          </g>
        ) : null}
      </svg>
      {active ? (
        <div className="chart-tooltip" style={{ left: `${tooltipLeft}%` }}>
          <span>{active.label}</span>
          <strong>{euroCompact(active.value)}</strong>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Donut                                                               */
/* ------------------------------------------------------------------ */

export function DonutChart({
  data,
  size = 190,
  thickness = 18,
  centerLabel,
  centerValue,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Répartition par statut">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(148,163,184,0.12)"
          strokeWidth={thickness}
        />
        {total > 0
          ? data.map((item) => {
              if (item.value <= 0) return null;
              const length = (item.value / total) * circumference;
              const dash = `${Math.max(length - 3, 0)} ${circumference - Math.max(length - 3, 0)}`;
              const circle = (
                <circle
                  key={item.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={thickness}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  strokeLinecap="round"
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  className="donut-segment"
                />
              );
              offset += length;
              return circle;
            })
          : null}
      </svg>
      <div className="donut-center">
        <strong>{centerValue ?? numberFR(total)}</strong>
        <span>{centerLabel ?? 'documents'}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Barres groupées                                                     */
/* ------------------------------------------------------------------ */

export function BarChart({
  data,
  colors = ['#6c5ce7', '#34d399'],
  height = 260,
  formatValue = euroCompact,
  ariaLabel = 'Histogramme',
}: {
  data: { label: string; values: number[] }[];
  colors?: string[];
  height?: number;
  formatValue?: (value: number) => string;
  ariaLabel?: string;
}) {
  const width = 820;
  const padding = { top: 16, right: 16, bottom: 30, left: 62 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = niceMax(Math.max(0, ...data.flatMap((item) => item.values)));
  const groupWidth = innerWidth / Math.max(data.length, 1);
  const barWidth = Math.min(26, (groupWidth * 0.55) / Math.max(colors.length, 1));
  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxValue * ratio);

  return (
    <div className="chart" style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={ariaLabel}>
        {grid.map((value, index) => {
          const y = padding.top + innerHeight - (value / maxValue) * innerHeight;
          return (
            <g key={value}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="chart-grid" />
              {index > 0 ? (
                <text x={padding.left - 10} y={y + 4} textAnchor="end" className="chart-axis-label">
                  {formatValue(value)}
                </text>
              ) : null}
            </g>
          );
        })}
        {data.map((group, groupIndex) => {
          const center = padding.left + groupWidth * groupIndex + groupWidth / 2;
          const totalBarsWidth = barWidth * group.values.length + 4 * (group.values.length - 1);
          return (
            <g key={group.label + groupIndex}>
              {group.values.map((value, valueIndex) => {
                const barHeight = (value / maxValue) * innerHeight;
                const x = center - totalBarsWidth / 2 + valueIndex * (barWidth + 4);
                return (
                  <rect
                    key={valueIndex}
                    x={x}
                    y={padding.top + innerHeight - barHeight}
                    width={barWidth}
                    height={Math.max(barHeight, value > 0 ? 2 : 0)}
                    rx={4}
                    fill={colors[valueIndex % colors.length]}
                    className="chart-bar"
                  />
                );
              })}
              <text x={center} y={height - 8} textAnchor="middle" className="chart-axis-label">
                {group.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Barres horizontales                                                 */
/* ------------------------------------------------------------------ */

export function HBars({
  items,
  formatValue,
  color = '#6c5ce7',
}: {
  items: { label: string; value: number; hint?: string }[];
  formatValue: (value: number) => string;
  color?: string;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="hbars">
      {items.map((item) => (
        <div key={item.label} className="hbar-row">
          <div className="hbar-label">
            <span>{item.label}</span>
            <strong>{formatValue(item.value)}</strong>
          </div>
          <div className="hbar-track">
            <span
              className="hbar-fill"
              style={{ width: `${Math.max((item.value / max) * 100, item.value > 0 ? 3 : 0)}%`, background: color }}
            />
          </div>
          {item.hint ? <span className="hbar-hint">{item.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="chart-legend">
      {items.map((item) => (
        <li key={item.label}>
          <span className="legend-dot" style={{ background: item.color }} />
          <span className="legend-label">{item.label}</span>
          {item.value ? <strong>{item.value}</strong> : null}
        </li>
      ))}
    </ul>
  );
}
