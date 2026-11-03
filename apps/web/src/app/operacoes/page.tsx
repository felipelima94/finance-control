import Link from "next/link";
import { assetClasses, tradeTypes } from "@fc/shared";
import { createTrade, deleteTrade } from "@/app/actions";
import { ApiOffline } from "@/components/ApiOffline";
import { Notice } from "@/components/Notice";
import { tryGet, type Asset, type Institution, type Trade } from "@/lib/api";
import { date, money, quantity } from "@/lib/format";
import { assetClassLabel, sourceLabel, tradeTypeLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

const LIMIT = 50;

export default async function Operacoes({
  searchParams,
}: {
  searchParams: Promise<{ assetId?: string; ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const assetId = sp.assetId && /^\d+$/.test(sp.assetId) ? Number(sp.assetId) : undefined;
  const [trades, assets, institutions] = await Promise.all([
    tryGet<Trade[]>(`/trades${assetId ? `?assetId=${assetId}` : ""}`),
    tryGet<Asset[]>("/assets"),
    tryGet<Institution[]>("/institutions"),
  ]);
  if (!trades || !assets || !institutions) {
    return (
      <main>
        <h1>Operações</h1>
        <ApiOffline />
      </main>
    );
  }

  const assetById = new Map(assets.map((a) => [a.id, a]));
  const instName = new Map(institutions.map((i) => [i.id, i.name]));
  const selected = assetId ? assetById.get(assetId) : undefined;
  const recent = [...trades].reverse().slice(0, LIMIT);
  const returnTo = `/operacoes${assetId ? `?assetId=${assetId}` : ""}`;

  return (
    <main>
      <div className="header-row">
        <div>
          <h1>Operações{selected ? `: ${selected.ticker}` : ""}</h1>
          <div className="muted">
            Compras, vendas e eventos (desdobramento, grupamento, bonificação, transferência).
            {selected && (
              <>
                {" "}
                <Link href="/operacoes">Ver todas</Link>
              </>
            )}
          </div>
        </div>
      </div>

      <Notice ok={sp.ok} error={sp.error} />

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Nova operação</h2>
        <form action={createTrade} className="stack">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="field">
            Ativo
            <input name="ticker" list="tickers" required defaultValue={selected?.ticker} placeholder="Ex.: ITSA4" />
            <datalist id="tickers">
              {assets.map((a) => (
                <option key={a.id} value={a.ticker} />
              ))}
            </datalist>
          </label>
          <label className="field">
            Tipo
            <select name="type" defaultValue="buy">
              {tradeTypes.map((t) => (
                <option key={t} value={t}>{tradeTypeLabel[t]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Data
            <input type="date" name="tradeDate" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </label>
          <label className="field">
            Quantidade
            <input name="quantity" inputMode="decimal" placeholder="Compra, venda, bonificação" />
          </label>
          <label className="field">
            Preço unitário
            <input name="unitPrice" inputMode="decimal" placeholder="Na moeda do ativo" />
          </label>
          <label className="field">
            Taxas
            <input name="fees" inputMode="decimal" placeholder="0,00" />
          </label>
          <label className="field">
            Fator
            <input name="factor" inputMode="decimal" placeholder="Desdobramento: 2 = 1→2" />
          </label>
          <label className="field">
            Corretora
            <select name="institutionId" defaultValue="">
              <option value="">—</option>
              {institutions.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Classe (ativo novo)
            <select name="assetClass" defaultValue={selected?.assetClass ?? "stock_br"}>
              {assetClasses.map((c) => (
                <option key={c} value={c}>{assetClassLabel[c]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Moeda (ativo novo)
            <select name="currency" defaultValue={selected?.currency ?? "BRL"}>
              <option value="BRL">BRL</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          <button className="primary" type="submit">Salvar</button>
        </form>
        <p className="muted" style={{ marginBottom: 0, fontSize: "0.85rem" }}>
          Classe e moeda só são usadas quando o ativo ainda não existe. Para trocar de ticker, lance uma transferência de saída no antigo e uma de
          entrada no novo, com a mesma quantidade e o preço médio como preço unitário.
        </p>
      </section>

      <section className="card">
        <h2>
          {selected ? `Histórico de ${selected.ticker}` : "Operações recentes"}{" "}
          <span className="muted" style={{ fontWeight: 400 }}>
            ({trades.length > LIMIT ? `${LIMIT} de ${trades.length}` : trades.length})
          </span>
        </h2>
        {recent.length === 0 ? (
          <div className="empty">Nenhuma operação.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Ativo</th>
                  <th>Tipo</th>
                  <th className="num">Quantidade</th>
                  <th className="num">Preço</th>
                  <th className="num">Taxas</th>
                  <th>Corretora</th>
                  <th>Origem</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => {
                  const a = assetById.get(t.assetId);
                  return (
                    <tr key={t.id}>
                      <td>{date(t.tradeDate)}</td>
                      <td><Link href={`/operacoes?assetId=${t.assetId}`}>{a?.ticker}</Link></td>
                      <td>{tradeTypeLabel[t.type] ?? t.type}{t.factor ? ` (fator ${quantity(t.factor)})` : ""}</td>
                      <td className="num">{t.quantity ? quantity(t.quantity) : "—"}</td>
                      <td className="num">{t.unitPrice ? money(t.unitPrice, t.currency) : "—"}</td>
                      <td className="num">{Number(t.fees) ? money(t.fees, t.currency) : "—"}</td>
                      <td className="secondary">{t.institutionId ? instName.get(t.institutionId) : "—"}</td>
                      <td className="secondary">{sourceLabel[t.source] ?? t.source}</td>
                      <td className="num">
                        <form action={deleteTrade}>
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <button className="ghost" type="submit" aria-label={`Excluir operação de ${a?.ticker}`}>Excluir</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
