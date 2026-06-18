/**
 * Shared NOVA design-system primitives (sparklines, gauges) used across
 * the dashboard, advisor and pools views.
 */

/** Map data values to evenly spaced SVG coordinates. */
export function buildSparkPoints(data: number[], width: number, height: number, pad = 4): [number, number][] {
  if (data.length < 2) return [];
  const max = Math.max(...data, 0.001);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  return data.map((value, index) => [
    (index / (data.length - 1)) * width,
    height - pad - ((value - min) / range) * (height - pad * 2),
  ]);
}

/** Build a smooth quadratic SVG path through the given points. */
export function buildSmoothPath(points: [number, number][]): string {
  if (points.length < 2) return '';
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i][0] + points[i + 1][0]) / 2;
    const midY = (points[i][1] + points[i + 1][1]) / 2;
    d += ` Q${points[i][0].toFixed(1)},${points[i][1].toFixed(1)} ${midX.toFixed(1)},${midY.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L${last[0].toFixed(1)},${last[1].toFixed(1)}`;
  return d;
}

export function SmoothSpark({ data, width, height, strokeWidth = 1.5, withDot = false }: {
  data: number[];
  width: number;
  height: number;
  strokeWidth?: number;
  withDot?: boolean;
}) {
  const points = buildSparkPoints(data, width, height);
  if (points.length < 2) return null;
  const line = buildSmoothPath(points);
  const last = points[points.length - 1];
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
      <path d={area} className="nova-sparkline-fill" />
      <path
        d={line}
        stroke="#FF9900"
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="group-hover:drop-shadow-[0_0_8px_rgba(255,153,0,0.5)] transition-all duration-300"
      />
      {withDot && <circle cx={last[0]} cy={last[1]} r="4" fill="#FF9900" className="animate-pulse" />}
    </svg>
  );
}

/** Circular health gauge (0-100). */
export function HealthGauge({ score, size = 28 }: { score: number; size?: number }) {
  const tone = score >= 80 ? 'stroke-emerald-400' : score >= 50 ? 'stroke-btc-500' : 'stroke-rose-500';
  const text = score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-btc-500' : 'text-rose-500';
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15.915" fill="none" className="stroke-white/10" strokeWidth="3" />
        <circle cx="18" cy="18" r="15.915" fill="none" className={tone} strokeWidth="3" strokeDasharray={`${Math.max(0, Math.min(100, score))}, 100`} />
      </svg>
      <span className={`absolute text-[9px] font-semibold font-mono ${text}`}>{Math.round(score)}</span>
    </div>
  );
}
