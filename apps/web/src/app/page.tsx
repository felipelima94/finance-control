import { apiGet, API_URL } from "@/lib/api";

const resources = [
  { path: "/institutions", label: "Instituições" },
  { path: "/categories", label: "Categorias" },
  { path: "/cash-transactions", label: "Lançamentos" },
  { path: "/assets", label: "Ativos" },
  { path: "/trades", label: "Operações" },
] as const;

async function loadCounts() {
  try {
    await apiGet("/health");
    const counts = await Promise.all(resources.map((r) => apiGet<unknown[]>(r.path).then((rows) => rows.length)));
    return { online: true as const, counts };
  } catch {
    return { online: false as const };
  }
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await loadCounts();
  return (
    <main>
      <h1>Finance Control</h1>
      <p className="muted">
        API em <code>{API_URL}</code>:{" "}
        {data.online ? (
          <span className="status-ok">online</span>
        ) : (
          <span className="status-bad">offline (rode <code>pnpm dev:api</code>)</span>
        )}
      </p>
      {data.online && (
        <div className="grid">
          {resources.map((r, i) => (
            <div className="card" key={r.path}>
              <div className="muted">{r.label}</div>
              <div className="value">{data.counts[i]}</div>
            </div>
          ))}
        </div>
      )}
      <p className="muted" style={{ marginTop: 32 }}>
        O dashboard de fluxo de caixa e carteira chega no passo 3 do plano.
      </p>
    </main>
  );
}
