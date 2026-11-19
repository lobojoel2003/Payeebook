import { useMemo, useState } from 'react';
import { formatMonth } from '../../core/dates';
import { formatMoney } from '../../core/money';

function compactMoney(cents: number): string {
  const d = cents / 100;
  if (Math.abs(d) >= 1000) return `$${(d / 1000).toFixed(d % 1000 === 0 ? 0 : 1)}k`;
  return `$${Math.round(d)}`;
}

function niceMax(v: number): number {
  if (v <= 0) return 10000;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}

/** Column with a 4px rounded data-end and a square baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface MonthFlow {
  month: string;
  in: number;
  out: number;
  saved: number;
}

/** Money in vs money spent per month: two series, grouped columns, hover tooltip and a table view. */
export function MonthlyChart({ data }: { data: MonthFlow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const W = 720;
  const H = 240;
  const pad = { l: 48, r: 8, t: 10, b: 28 };
  const max = niceMax(Math.max(...data.map((d) => Math.max(d.in, d.out)), 0));
  const band = (W - pad.l - pad.r) / Math.max(data.length, 1);
  const barW = Math.min(20, (band - 12) / 2);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - Math.max(v, 0) / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const hovered = hover !== null ? data[hover] : undefined;

  return (
    <div className="stack-sm">
      <div className="row-between">
        <div className="viz-legend" aria-hidden>
          <span>
            <i className="swatch" style={{ background: 'var(--series-1)' }} /> Money in
          </span>
          <span>
            <i className="swatch" style={{ background: 'var(--series-2)' }} /> Money spent
          </span>
        </div>
        <div className="segmented" role="group" aria-label="Chart view">
          <button aria-pressed={!asTable} onClick={() => setAsTable(false)}>
            Chart
          </button>
          <button aria-pressed={asTable} onClick={() => setAsTable(true)}>
            Table
          </button>
        </div>
      </div>
      {asTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Money in</th>
                <th className="num">Money spent</th>
                <th className="num">Moved to savings</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month}>
                  <td>{formatMonth(d.month)}</td>
                  <td className="num">{formatMoney(d.in)}</td>
                  <td className="num">{formatMoney(d.out)}</td>
                  <td className="num">{formatMoney(d.saved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="viz" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Money in and money spent by month">
            {ticks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
                <text className="axis-label" x={pad.l - 8} y={y(t) + 4} textAnchor="end">
                  {compactMoney(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = pad.l + band * i + band / 2;
              const dim = hover !== null && hover !== i ? 0.45 : 1;
              return (
                <g key={d.month}>
                  <path
                    className="bar-in"
                    opacity={dim}
                    d={columnPath(cx - barW - 1, y(d.in), barW, H - pad.b - y(d.in))}
                  />
                  <path
                    className="bar-out"
                    opacity={dim}
                    d={columnPath(cx + 1, y(d.out), barW, H - pad.b - y(d.out))}
                  />
                  <text className="axis-label" x={cx} y={H - 8} textAnchor="middle">
                    {formatMonth(d.month).split(' ')[0]}
                  </text>
                  <rect
                    className="hit"
                    x={pad.l + band * i}
                    y={pad.t}
                    width={band}
                    height={H - pad.t - pad.b}
                    tabIndex={0}
                    aria-label={`${formatMonth(d.month)}: in ${formatMoney(d.in)}, spent ${formatMoney(d.out)}`}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                  />
                </g>
              );
            })}
          </svg>
          {hovered && hover !== null && (
            <div
              className="tooltip"
              style={{
                left: `${((pad.l + band * hover + band / 2) / W) * 100}%`,
                top: `${(Math.min(y(hovered.in), y(hovered.out)) / H) * 100}%`,
              }}
            >
              <div className="tooltip-title">{formatMonth(hovered.month)}</div>
              <div className="tooltip-row">
                <span>
                  <i className="swatch" style={{ background: 'var(--series-1)' }} /> Money in
                </span>
                <b className="money">{formatMoney(hovered.in)}</b>
              </div>
              <div className="tooltip-row">
                <span>
                  <i className="swatch" style={{ background: 'var(--series-2)' }} /> Money spent
                </span>
                <b className="money">{formatMoney(hovered.out)}</b>
              </div>
              {hovered.saved !== 0 && (
                <div className="tooltip-row">
                  <span>Moved to savings</span>
                  <b className="money">{formatMoney(hovered.saved)}</b>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface BarItem {
  key: string;
  label: string;
  value: number;
}

/** Ranked horizontal bar list, single series, values printed at the bar end. */
export function BarList({
  items,
  max = 8,
  total,
}: {
  items: BarItem[];
  max?: number;
  total?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const rows = useMemo(() => {
    const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
    if (sorted.length <= max) return sorted;
    const tail = sorted.slice(max - 1);
    return [
      ...sorted.slice(0, max - 1),
      {
        key: '__other',
        label: `Other (${tail.length})`,
        value: tail.reduce((n, r) => n + r.value, 0),
      },
    ];
  }, [items, max]);
  const sum = total ?? rows.reduce((n, r) => n + r.value, 0);
  const top = rows[0]?.value ?? 1;
  const pct = (v: number) => (sum ? Math.round((v / sum) * 100) : 0);
  return (
    <div className="barlist" onMouseLeave={() => setHover(null)}>
      {rows.map((r) => (
        <div
          key={r.key}
          className="barlist-row"
          onMouseEnter={() => setHover(r.key)}
          style={{ opacity: hover && hover !== r.key ? 0.55 : 1 }}
          title={`${r.label}: ${formatMoney(r.value)} (${pct(r.value)}% of spending)`}
        >
          <span className="barlist-label">{r.label}</span>
          <div className="barlist-track">
            <div className="barlist-bar" style={{ width: `${(r.value / top) * 100}%` }} />
          </div>
          <span className="barlist-value">
            {formatMoney(r.value)}
            <span className="muted tiny" style={{ marginLeft: 6, fontWeight: 500 }}>
              {pct(r.value)}%
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
