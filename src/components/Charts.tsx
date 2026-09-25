/** Lightweight SVG charts (no chart library to download). */

export function BarChart({ data, format = (v: number) => String(v), height = 180, gold }: { data: Array<{ label: string; value: number }>; format?: (value: number) => string; height?: number; gold?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = Math.max(data.length * 48, 300);
  const chartHeight = height - 28;
  const barWidth = (width / data.length) * 0.6;
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={data.map((d) => `${d.label}: ${format(d.value)}`).join(", ")}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} className="grid-line" x1="0" x2={width} y1={chartHeight - chartHeight * f} y2={chartHeight - chartHeight * f} />
      ))}
      {data.map((d, i) => {
        const h = (d.value / max) * (chartHeight - 14);
        const x = (width / data.length) * i + (width / data.length - barWidth) / 2;
        return (
          <g key={d.label}>
            <rect className={`bar ${gold ? "bar-gold" : ""}`} x={x} y={chartHeight - h} width={barWidth} height={Math.max(h, 1)} rx="4">
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
            <text x={x + barWidth / 2} y={height - 8} textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function HBars({ data, format = (v: number) => String(v) }: { data: Array<{ label: string; value: number }>; format?: (value: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="muted small">No data yet.</p>;
  return (
    <div className="hbar">
      {data.map((d) => (
        <div className="hbar-row" key={d.label}>
          <span>{d.label}</span>
          <div className="progress"><span style={{ width: `${(d.value / max) * 100}%` }} /></div>
          <strong className="small">{format(d.value)}</strong>
        </div>
      ))}
    </div>
  );
}

export const shortMonth = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
