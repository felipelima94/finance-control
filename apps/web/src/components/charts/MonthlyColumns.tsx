"use client";

import { useState } from "react";
import { money, moneyCompact, monthLong, monthShort } from "@/lib/format";

export interface MonthPoint {
  month: string;
  in: number;
  out: number;
}

const W = 720;
const H = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 64 };
const BAR = 18; // ≤ 24px
const GAP = 2; // surface gap between the pair

function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

/** Column with a 4px rounded top and a square baseline. */
function column(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Grouped columns of money in (series 1) and out (series 2) per month, with a hover tooltip. */
export function MonthlyColumns({ data, currency = "BRL" }: { data: MonthPoint[]; currency?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ticks = niceTicks(Math.max(...data.map((d) => Math.max(d.in, d.out)), 0));
  const top = ticks[ticks.length - 1]!;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / Math.max(data.length, 1);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const h = hover == null ? null : data[hover];

  return (
    <div className="chart-scroll">
    <div className="chart">
      <div className="legend" aria-hidden="true">
        <span><span className="key" style={{ background: "var(--series-1)" }} />Entradas</span>
        <span><span className="key" style={{ background: "var(--series-2)" }} />Saídas</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Entradas e saídas por mês, de ${monthLong(data[0]!.month)} a ${monthLong(data[data.length - 1]!.month)}`}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {moneyCompact(t, currency)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.left + band * i + band / 2;
          const bw = Math.min(BAR, (band - 8) / 2 - GAP / 2);
          return (
            <g key={d.month}>
              {hover === i && <rect x={cx - band / 2 + 2} y={PAD.top} width={band - 4} height={plotH} fill="var(--accent-wash)" rx={4} />}
              <path d={column(cx - GAP / 2 - bw, y(d.in), bw, y(0) - y(d.in))} fill="var(--series-1)" />
              <path d={column(cx + GAP / 2, y(d.out), bw, y(0) - y(d.out))} fill="var(--series-2)" />
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                {monthShort(d.month)}
              </text>
              {/* Hit target: the whole band, bigger than the marks. */}
              <rect
                x={cx - band / 2}
                y={PAD.top}
                width={band}
                height={plotH + PAD.bottom}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${monthLong(d.month)}: entradas ${money(d.in, currency)}, saídas ${money(d.out, currency)}`}
              />
            </g>
          );
        })}
      </svg>
      {h && hover != null && (
        <div
          className="tooltip"
          style={{
            left: `clamp(0px, calc(${((PAD.left + band * hover + band / 2) / W) * 100}% - 90px), calc(100% - 190px))`,
            top: 28,
          }}
        >
          <div className="t-title">{monthLong(h.month)}</div>
          <div className="t-row"><span>Entradas</span><span className="num">{money(h.in, currency)}</span></div>
          <div className="t-row"><span>Saídas</span><span className="num">{money(h.out, currency)}</span></div>
          <div className="t-row"><span>Saldo</span><span className={`num ${h.in - h.out >= 0 ? "pos" : "neg"}`}>{money(h.in - h.out, currency)}</span></div>
        </div>
      )}
    </div>
    </div>
  );
}
