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

### Importar a planilha da myProfit

Exporte o "Relatório Histórico de investimentos" (.xlsx) na myProfit e rode:

```bash
pnpm import:myprofit ~/Downloads/relatorio.xlsx --dry-run   # só mostra o que seria importado
pnpm import:myprofit ~/Downloads/relatorio.xlsx
```

Ou envie pela API: `curl --data-binary @relatorio.xlsx -H 'content-type: application/octet-stream' http://127.0.0.1:3333/imports/myprofit`.

Pode importar o mesmo arquivo (ou um export mais novo) várias vezes: operações já importadas são ignoradas.
Instituições e ativos são criados automaticamente, com a classe vinda da coluna "Grupo".
Resgates totais de renda fixa (quantidade 0 na planilha) vendem a posição inteira daquela data.

Variáveis da API (opcionais): `PORT` (3333), `HOST` (127.0.0.1), `DATABASE_FILE` (`data/finance.db`), `CORS_ORIGIN` (`http://localhost:3000`).
No dashboard: `API_URL` (`http://127.0.0.1:3333`).

## Dashboard

Em http://localhost:3000, com `pnpm dev` rodando:

- **Visão geral**: entradas, saídas e saldo do mês, gráfico dos últimos 12 meses, saídas por categoria, carteira por classe (BRL e USD) e aviso de inconsistências.
- **Carteira**: posições por classe com quantidade, preço médio, custo, % da carteira e resultados, com filtro por classe e posições encerradas.
- **Lançamentos**: cadastro e lista de entradas e saídas do mês.
- **Operações**: cadastro de compras, vendas e eventos (desdobramento, grupamento, bonificação, transferência) e histórico por ativo.

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

Carteira (calculada a partir de `trades`):

- `GET /portfolio/positions` (`asOf`, `includeClosed=true`): quantidade, preço médio, custo total, resultado realizado e de day trade por ativo, mais avisos de inconsistência.
- `GET /portfolio/sales` (`from`, `to`, `assetId`): cada venda com custo, valor líquido e lucro, separando day trade.
- `GET /portfolio/summary` (`asOf`): totais por classe de ativo e moeda.
- `POST /imports/myprofit` (`dryRun=true`): importa o .xlsx enviado no corpo.
- `GET /cash-flow/summary` (`from`, `to`, `currency`): entradas, saídas e saldo por mês e por categoria.

### Como o preço médio é calculado

Segue o método de custo médio da Receita Federal (`apps/api/src/portfolio/engine.ts`):

- Compras somam quantidade e custo (quantidade × preço + taxas). Preço médio = custo / quantidade.
- Vendas tiram quantidade pelo preço médio, que não muda. Resultado = valor da venda − taxas − quantidade × preço médio.
- Desdobramento multiplica a quantidade e grupamento divide, sem mudar o custo. Bonificação soma quantidade pelo custo atribuído.
- Day trade (compra e venda do mesmo ativo, no mesmo dia e na mesma corretora) é separado primeiro e não altera o preço médio.
- Posições somam todas as corretoras. Ativos em USD ficam em USD (a conversão para BRL vem depois).
- Se uma venda é maior que a posição, só a quantidade em carteira entra no cálculo e a posição ganha um aviso. Normalmente isso indica um evento que falta lançar (desdobramento, bonificação ou troca de ticker).

Para uma troca de ticker (ex.: NUBR33 → ROXO34), lance um `transfer_out` no ticker antigo e um `transfer_in` no novo, com a mesma quantidade e o preço médio como `unitPrice`.

Erros: `400` validação (com `issues`), `404` não encontrado, `409` duplicado ou registro em uso.

## Plano

1. ✅ Base e modelo de dados (este passo)
2. ✅ Importar a planilha da myProfit e calcular a carteira (preço médio, vendas, BRL/USD, day trade)
3. ✅ Dashboard de fluxo de caixa e carteira
4. Adaptador para a API de movimentação da B3
