import { API_URL } from "@/lib/api";

export function ApiOffline() {
  return (
    <div className="notice error">
      Não consegui falar com a API em <code>{API_URL}</code>. Rode <code>pnpm dev:api</code> (ou <code>pnpm dev</code>) e recarregue.
    </div>
  );
}
