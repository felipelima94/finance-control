import type { CashFlowSummary } from "@fc/shared";
import { createCashTransaction, deleteCashTransaction } from "@/app/actions";
import { ApiOffline } from "@/components/ApiOffline";
import { MonthNav } from "@/components/MonthNav";
import { Notice } from "@/components/Notice";
import { tryGet, type CashTransaction, type Category, type Institution } from "@/lib/api";
import { currentMonth, date, lastDayOfMonth, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Lancamentos({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentMonth();
  const range = `from=${month}-01&to=${lastDayOfMonth(month)}`;
  const [txs, categories, institutions, flow] = await Promise.all([
    tryGet<CashTransaction[]>(`/cash-transactions?${range}`),
    tryGet<Category[]>("/categories"),
    tryGet<Institution[]>("/institutions"),
    tryGet<CashFlowSummary>(`/cash-flow/summary?${range}`),
  ]);
  if (!txs || !categories || !institutions || !flow) {
    return (
      <main>
        <h1>Lançamentos</h1>
        <ApiOffline />
      </main>
    );
  }

  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const instName = new Map(institutions.map((i) => [i.id, i.name]));
  const returnTo = `/lancamentos?month=${month}`;
  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = today.startsWith(month) ? today : `${month}-01`;

  return (
    <main>
      <div className="header-row">
        <div>
          <h1>Lançamentos</h1>
          <div className="muted">
            Entradas {money(flow.totals.in)} · Saídas {money(flow.totals.out)} · Saldo{" "}
            <span className={Number(flow.totals.net) < 0 ? "neg" : ""}>{money(flow.totals.net)}</span>
          </div>
        </div>
        <MonthNav month={month} basePath="/lancamentos" />
      </div>

      <Notice ok={sp.ok} error={sp.error} />

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Novo lançamento</h2>
        <form action={createCashTransaction} className="stack">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="field">
            Tipo
            <select name="direction" defaultValue="out">
              <option value="out">Saída</option>
              <option value="in">Entrada</option>
            </select>
          </label>
          <label className="field">
            Data
            <input type="date" name="date" defaultValue={defaultDate} required />
          </label>
          <label className="field" style={{ gridColumn: "span 2" }}>
            Descrição
            <input name="description" required maxLength={200} placeholder="Ex.: Mercado" />
          </label>
          <label className="field">
            Valor (R$)
            <input name="amount" inputMode="decimal" required placeholder="0,00" />
          </label>
          <label className="field">
            Categoria
            <select name="categoryId" defaultValue="">
              <option value="">Sem categoria</option>
              <optgroup label="Saídas">
                {categories.filter((c) => c.kind === "expense").map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
              <optgroup label="Entradas">
                {categories.filter((c) => c.kind === "income").map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="field">
            Conta
            <select name="institutionId" defaultValue="">
              <option value="">—</option>
              {institutions.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </label>
          <button className="primary" type="submit">Salvar</button>
        </form>
        {categories.length === 0 && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Dica: rode <code>pnpm db:seed</code> para criar as categorias iniciais.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Lançamentos do mês</h2>
        {txs.length === 0 ? (
          <div className="empty">Nenhum lançamento neste mês.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Categoria</th>
                  <th>Conta</th>
                  <th className="num">Valor</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.id}>
                    <td className="num" style={{ textAlign: "left" }}>{date(t.date)}</td>
                    <td>{t.description}</td>
                    <td className="secondary">{t.categoryId ? catName.get(t.categoryId) : "Sem categoria"}</td>
                    <td className="secondary">{t.institutionId ? instName.get(t.institutionId) : "—"}</td>
                    <td className={`num ${t.direction === "in" ? "pos" : ""}`}>
                      {t.direction === "in" ? "+" : "−"} {money(t.amount, t.currency)}
                    </td>
                    <td className="num">
                      <form action={deleteCashTransaction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button className="ghost" type="submit" aria-label={`Excluir ${t.description}`}>Excluir</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
