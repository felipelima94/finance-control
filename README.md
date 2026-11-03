# Finance Control

Controle financeiro pessoal, rodando localmente:

- **Fluxo de caixa**: entradas e saídas separadas por categoria.
- **Investimentos**: ações e FIIs na B3, renda fixa, Tesouro, cripto e exterior, com valor investido e preço médio.

## Stack

| Parte | Tecnologia |
| --- | --- |
| Monorepo | pnpm workspaces, TypeScript |
| API (`apps/api`) | Fastify 5, Drizzle ORM, SQLite (better-sqlite3), Zod |
| Dashboard (`apps/web`) | Next.js 16 (App Router), React 19 |
| Tipos e validação compartilhados (`packages/shared`) | Zod |
| Testes | Vitest |

Valores monetários e quantidades são guardados como texto decimal (`"1044.69"`) para não perder precisão. Os cálculos de carteira usarão decimal.js.

## Como rodar

Requer Node 22 e pnpm 10.

```bash
pnpm install
pnpm db:migrate   # cria data/finance.db
pnpm db:seed      # categorias iniciais (opcional, pode rodar de novo sem duplicar)
pnpm dev          # API em http://127.0.0.1:3333 e dashboard em http://localhost:3000
```

Outros comandos: `pnpm test`, `pnpm typecheck`, `pnpm build`.

Variáveis da API (opcionais): `PORT` (3333), `HOST` (127.0.0.1), `DATABASE_FILE` (`data/finance.db`), `CORS_ORIGIN` (`http://localhost:3000`).
No dashboard: `API_URL` (`http://127.0.0.1:3333`).

## Modelo de dados

| Tabela | Para que serve |
| --- | --- |
| `institutions` | Bancos e corretoras (XP, Avenue, NuInvest...) |
| `categories` | Categorias de receita e despesa, com subcategorias via `parentId` |
| `cash_transactions` | Lançamentos de entrada (`in`) e saída (`out`) |
| `assets` | Ativos, com classe (`stock_br`, `fii`, `etf_us`, `treasury`, `crypto`...) e moeda |
| `trades` | Operações: `buy`, `sell`, `split`, `reverse_split`, `bonus`, `subscription`, `transfer_in`, `transfer_out` |

`trades` também guarda taxas, câmbio (`fxRate`), day trade e a origem (`manual`, `myprofit`, `b3`).
O par `source` + `externalId` é único, então importações repetidas não duplicam operações.

Para alterar o schema: edite `apps/api/src/db/schema.ts` e rode `pnpm db:generate`.

## API

Cada recurso tem `GET /x`, `GET /x/:id`, `POST /x`, `PUT /x/:id` e `DELETE /x/:id`:

- `/institutions`
- `/categories`
- `/cash-transactions` (filtros: `from`, `to`, `categoryId`, `direction`)
- `/assets`
- `/trades` (filtros: `assetId`, `institutionId`, `from`, `to`)

Erros: `400` validação (com `issues`), `404` não encontrado, `409` duplicado ou registro em uso.

## Plano

1. ✅ Base e modelo de dados (este passo)
2. Importar a planilha da myProfit e calcular a carteira (preço médio, vendas, BRL/USD, day trade)
3. Dashboard de fluxo de caixa e carteira
4. Adaptador para a API de movimentação da B3
