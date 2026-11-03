import Link from "next/link";
import type { CashFlowSummary, ClassSummary, Position } from "@fc/shared";
import { ApiOffline } from "@/components/ApiOffline";
import { BarList } from "@/components/charts/BarList";
import { MonthlyColumns } from "@/components/charts/MonthlyColumns";
import { MonthNav } from "@/components/MonthNav";
import { tryGet } from "@/lib/api";
import { addMonths, currentMonth, lastDayOfMonth, money, monthShort } from "@/lib/format";
import { assetClassLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: m } = await searchParams;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : currentMonth();
  const from12 = `${addMonths(month, -11)}-01`;
  const to = lastDayOfMonth(month);

  const [year, monthFlow, summary, positions] = await Promise.all([
    tryGet<CashFlowSummary>(`/cash-flow/summary?from=${from12}&to=${to}`),
    tryGet<CashFlowSummary>(`/cash-flow/summary?from=${month}-01&to=${to}`),
    tryGet<ClassSummary[]>("/portfolio/summary"),
    tryGet<Position[]>("/portfolio/positions?includeClosed=true"),
  ]);
  if (!year || !monthFlow || !summary || !positions) {
    return (
      <main>
        <h1>Visão geral</h1>
        <ApiOffline />
      </main>
    );
  }

  // Fill months without transactions so the chart always shows 12 columns.
  const byMonth = new Map(year.months.map((x) => [x.month, x]));
  const series = Array.from({ length: 12 }, (_, i) => {
    const key = addMonths(month, i - 11);
    const v = byMonth.get(key);
    return { month: key, in: Number(v?.in ?? 0), out: Number(v?.out ?? 0) };
  });
  const hasFlow = series.some((s) => s.in || s.out);

  const expenses = monthFlow.categories.filter((c) => c.direction === "out");
  const warnings = positions.filter((p) => p.warnings.length);
  const byCurrency = (cur: string) =>
    summary
      .filter((s) => s.currency === cur && Number(s.totalCost) > 0)
      .map((s) => ({
        key: s.assetClass,
        label: assetClassLabel[s.assetClass] ?? s.assetClass,
        value: Number(s.totalCost),
        detail: `${s.positions} ${s.positions === 1 ? "ativo" : "ativos"}`,
        href: `/carteira?class=${s.assetClass}`,
      }))
      .sort((a, b) => b.value - a.value);
  const brl = byCurrency("BRL");
  const usd = byCurrency("USD");
  const invested = (items: { value: number }[]) => items.reduce((s, i) => s + i.value, 0);

  return (
    <main>
      <div className="header-row">
        <div>
          <h1>Visão geral</h1>
          <div className="muted">Fluxo de caixa do mês e carteira atual</div>
        </div>
        <MonthNav month={month} basePath="/" />
      </div>

      {warnings.length > 0 && (
        <div className="notice warn">
          ⚠ {warnings.length} {warnings.length === 1 ? "ativo tem" : "ativos têm"} venda maior que a posição. Provavelmente falta lançar um
          evento (desdobramento, bonificação ou troca de ticker). <Link href="/carteira#avisos">Ver detalhes</Link>
        </div>
      )}

      <div className="tiles">
        <div className="card tile">
          <div className="label">Entradas</div>
          <div className="value">{money(monthFlow.totals.in)}</div>
          <div className="sub">em {monthShort(month)}</div>
        </div>
        <div className="card tile">
          <div className="label">Saídas</div>
          <div className="value">{money(monthFlow.totals.out)}</div>
          <div className="sub">em {monthShort(month)}</div>
        </div>
        <div className="card tile">
          <div className="label">Saldo do mês</div>
          <div className={`value ${Number(monthFlow.totals.net) >= 0 ? "" : "neg"}`}>{money(monthFlow.totals.net)}</div>
          <div className="sub">entradas menos saídas</div>
        </div>
        <div className="card tile">
          <div className="label">Investido (BRL)</div>
          <div className="value">{money(invested(brl))}</div>
          <div className="sub">{usd.length > 0 ? `+ ${money(invested(usd), "USD")} no exterior` : "custo das posições abertas"}</div>
        </div>
      </div>

      <div className="grid grid-2">
        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>Entradas e saídas, últimos 12 meses</h2>
          {hasFlow ? (
            <>
              <MonthlyColumns data={series} />
              <details>
                <summary>Ver tabela</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Mês</th><th className="num">Entradas</th><th className="num">Saídas</th><th className="num">Saldo</th></tr>
                    </thead>
                    <tbody>
                      {series.map((s) => (
                        <tr key={s.month}>
                          <td>{monthShort(s.month)}</td>
                          <td className="num">{money(s.in)}</td>
                          <td className="num">{money(s.out)}</td>
                          <td className={`num ${s.in - s.out >= 0 ? "" : "neg"}`}>{money(s.in - s.out)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <div className="empty">
              Nenhum lançamento nesse período. <Link href="/lancamentos">Lançar entradas e saídas</Link>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Saídas por categoria em {monthShort(month)}</h2>
          {expenses.length ? (
            <BarList
              color="var(--series-2)"
              items={expenses.map((c) => ({
                key: String(c.categoryId),
                label: c.name,
                value: Number(c.total),
                detail: `${c.count} ${c.count === 1 ? "lançamento" : "lançamentos"}`,
              }))}
            />
          ) : (
            <div className="empty">Sem saídas neste mês.</div>
          )}
        </section>

        <section className="card">
          <h2>Carteira por classe (custo, BRL)</h2>
          {brl.length ? <BarList items={brl} /> : <div className="empty">Nenhuma posição em reais.</div>}
          {usd.length > 0 && (
            <>
              <h2 style={{ marginTop: 20 }}>Exterior (custo, USD)</h2>
              <BarList items={usd} currency="USD" />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
