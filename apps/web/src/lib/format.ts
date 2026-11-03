const moneyFmt = new Map<string, Intl.NumberFormat>();

export function money(value: string | number, currency = "BRL") {
  let f = moneyFmt.get(currency);
  if (!f) {
    f = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
    moneyFmt.set(currency, f);
  }
  return f.format(Number(value));
}

/** Compact money for chart axes and tight labels: R$ 12,3 mil. */
export function moneyCompact(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 10_000 ? 1 : 0,
  }).format(value);
}

export function quantity(value: string | number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 }).format(Number(value));
}

export function percent(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

export function date(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-10" → "out/26" */
export function monthShort(ym: string) {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1]}/${y!.slice(2)}`;
}

/** "2026-10" → "outubro de 2026" */
export function monthLong(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const s = new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function addMonths(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return dt.toISOString().slice(0, 7);
}

export function lastDayOfMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

export const currentMonth = () => new Date().toISOString().slice(0, 7);
