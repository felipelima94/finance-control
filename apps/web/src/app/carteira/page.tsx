import Link from "next/link";
import type { Position } from "@fc/shared";
import { ApiOffline } from "@/components/ApiOffline";
import { tryGet } from "@/lib/api";
import { money, percent, quantity } from "@/lib/format";
import { assetClassLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

const pnlClass = (v: string) => (Number(v) > 0 ? "num pos" : Number(v) < 0 ? "num neg" : "num muted");

export default async function Carteira({ searchParams }: { searchParams: Promise<{ class?: string; closed?: string }> }) {
  const { class: cls, closed } = await searchParams;
  const showClosed = closed === "1";
  const all = await tryGet<Position[]>("/portfolio/positions?includeClosed=true");
  if (!all) {
    return (
      <main>
        <h1>Carteira</h1>
        <ApiOffline />
      </main>
    );
  }

  const classes = [...new Set(all.map((p) => p.assetClass))].sort((a, b) =>
    (assetClassLabel[a] ?? a).localeCompare(assetClassLabel[b] ?? b, "pt-BR"),
  );
  const visible = all
    .filter((p) => (showClosed ? true : Number(p.quantity) !== 0))
    .filter((p) => !cls || p.assetClass === cls);

  // Group by currency, then class; share is relative to the currency total.
  const totalsByCurrency = new Map<string, number>();
  for (const p of visible) totalsByCurrency.set(p.currency, (totalsByCurrency.get(p.currency) ?? 0) + Number(p.totalCost));
  const groups = new Map<string, Position[]>();
  for (const p of visible) {
    const key = `${p.currency}|${p.assetClass}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const warnings = all.filter((p) => p.warnings.length);

  const href = (c?: string, cl = showClosed) => {
    const q = new URLSearchParams();
    if (c) q.set("class", c);
    if (cl) q.set("closed", "1");
    const s = q.toString();
    return `/carteira${s ? `?${s}` : ""}`;
  };

  return (
    <main>
      <div className="header-row">
        <div>
          <h1>Carteira</h1>
          <div className="muted">Preço médio pelo método da Receita, com taxas. Valores em custo de aquisição.</div>
        </div>
        <Link className="chip" href={href(cls, !showClosed)} aria-current={showClosed ? "true" : undefined}>
          {showClosed ? "✓ " : ""}Mostrar posições encerradas
        </Link>
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        <Link className="chip" href={href()} aria-current={!cls ? "true" : undefined}>Todas</Link>
        {classes.map((c) => (
          <Link key={c} className="chip" href={href(c)} aria-current={cls === c ? "true" : undefined}>
            {assetClassLabel[c] ?? c}
          </Link>
        ))}
      </div>

      <section className="card">
        {visible.length === 0 ? (
          <div className="empty">
            Nenhuma posição. Importe a planilha com <code>pnpm import:myprofit</code> ou <Link href="/operacoes">lance uma operação</Link>.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ativo</th>
                  <th className="num">Quantidade</th>
                  <th className="num">Preço médio</th>
                  <th className="num">Custo total</th>
                  <th className="num">% da carteira</th>
                  <th className="num">Resultado realizado</th>
                  <th className="num">Day trade</th>
                </tr>
              </thead>
              <tbody>
                {sortedGroups.map(([key, items]) => {
                  const [currency, assetClass] = key.split("|") as [string, string];
                  const groupCost = items.reduce((s, p) => s + Number(p.totalCost), 0);
                  const total = totalsByCurrency.get(currency) ?? 0;
                  return [
                    <tr key={key} className="group">
                      <td colSpan={3}>
                        {assetClassLabel[assetClass] ?? assetClass} <span className="muted">· {currency}</span>
                      </td>
                      <td className="num">{money(groupCost, currency)}</td>
                      <td className="num">{percent(total ? groupCost / total : 0)}</td>
                      <td colSpan={2} />
                    </tr>,
                    ...items
                      .sort((a, b) => Number(b.totalCost) - Number(a.totalCost))
                      .map((p) => (
                        <tr key={p.assetId}>
                          <td>
                            <Link href={`/operacoes?assetId=${p.assetId}`}>{p.ticker}</Link>
                            {p.warnings.length > 0 && <span title={p.warnings.join("\n")}> ⚠</span>}
                          </td>
                          <td className="num">{quantity(p.quantity)}</td>
                          <td className="num">{money(p.averagePrice, currency)}</td>
                          <td className="num">{money(p.totalCost, currency)}</td>
                          <td className="num">{percent(total ? Number(p.totalCost) / total : 0)}</td>
                          <td className={pnlClass(p.realizedPnl)}>{money(p.realizedPnl, currency)}</td>
                          <td className={pnlClass(p.dayTradePnl)}>{money(p.dayTradePnl, currency)}</td>
                        </tr>
                      )),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {warnings.length > 0 && (
        <section className="card" id="avisos" style={{ marginTop: 16 }}>
          <h2>⚠ Avisos ({warnings.length})</h2>
          <p className="secondary" style={{ marginTop: 0 }}>
            Estas vendas são maiores que a posição calculada, então só a quantidade em carteira entrou no resultado. Normalmente falta lançar
            um desdobramento, uma bonificação ou uma troca de ticker (transferência de saída no ticker antigo e de entrada no novo).
          </p>
          <ul>
            {warnings.map((p) =>
              p.warnings.map((w, i) => (
                <li key={`${p.assetId}-${i}`}>
                  <Link href={`/operacoes?assetId=${p.assetId}`}>{p.ticker}</Link>: {w}
                </li>
              )),
            )}
          </ul>
        </section>
      )}
    </main>
  );
}
