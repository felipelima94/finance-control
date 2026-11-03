"use client";

import { useState } from "react";
import { money, percent } from "@/lib/format";

export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** Extra line in the tooltip, e.g. "11 ativos". */
  detail?: string;
  href?: string;
}

/**
 * Ranked horizontal bars for one series (no legend: the card title names it).
 * Value at the bar tip; hover or focus shows the share of the total.
 */
export function BarList({ items, currency = "BRL", color = "var(--series-1)" }: { items: BarItem[]; currency?: string; color?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...items.map((i) => i.value), 0);
  const total = items.reduce((s, i) => s + i.value, 0);

  return (
    <div className="chart barlist" onMouseLeave={() => setHover(null)}>
      {items.map((item, idx) => {
        const row = (
          <>
            <span className="name" title={item.label}>{item.label}</span>
            <span className="track">
              <span className="bar" style={{ width: `${max ? (item.value / max) * 78 : 0}%`, background: color }} />
              <span className="val">{money(item.value, currency)}</span>
            </span>
          </>
        );
        const props = {
          className: "row",
          tabIndex: 0,
          onMouseEnter: () => setHover(idx),
          onFocus: () => setHover(idx),
          onBlur: () => setHover(null),
          "aria-label": `${item.label}: ${money(item.value, currency)}, ${percent(total ? item.value / total : 0)} do total`,
        };
        return item.href ? (
          <a key={item.key} href={item.href} {...props} style={{ textDecoration: "none" }}>{row}</a>
        ) : (
          <div key={item.key} {...props}>{row}</div>
        );
      })}
      {hover != null && items[hover] && (
        <div className="tooltip" style={{ right: 0, top: hover * 30 + 30 }}>
          <div className="t-title">{items[hover]!.label}</div>
          <div className="t-row"><span>Valor</span><span className="num">{money(items[hover]!.value, currency)}</span></div>
          <div className="t-row"><span>Participação</span><span className="num">{percent(total ? items[hover]!.value / total : 0)}</span></div>
          {items[hover]!.detail && <div className="t-row muted"><span>{items[hover]!.detail}</span></div>}
        </div>
      )}
    </div>
  );
}
