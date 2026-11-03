import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createDb, type Db } from "../src/db/client";
import { B3Client, b3ConfigFromEnv, monthWindows, type B3Config } from "../src/integrations/b3/client";
import { importB3 } from "../src/integrations/b3/import";
import { mapMovements } from "../src/integrations/b3/mapper";
import { movementsFromResponses } from "../src/integrations/b3/types";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/b3-movements.json", import.meta.url), "utf8"));
const list = (v: unknown) => (Array.isArray(v) ? v : [v]);
const movements = movementsFromResponses({
  equities: list(fixture.equities),
  fixedIncome: list(fixture.fixedIncome),
  treasuryBonds: list(fixture.treasuryBonds),
});

describe("mapMovements", () => {
  it("turns settlements, splits and fixed income into trades and explains what it ignores", () => {
    const mapped = mapMovements(movements);
    const trades = mapped.filter((m) => m.kind === "trade");
    expect(trades.map((t) => [t.ticker, t.type, t.quantity, t.unitPrice, t.assetClass])).toEqual([
      ["BBAS3", "buy", "100", "55.2", "stock_br"],
      ["BBAS3", "bonus", "100", "0", "stock_br"],
      ["HGLG11", "sell", "10", "160", "fii"],
      ["CDB BANCO XYZ S.A. 2026-04-10", "buy", "1", "1000", "fixed_income"],
      ["TESOURO IPCA+ 2035", "buy", "0.5", "2000", "treasury"],
    ]);
    const ignored = mapped.filter((m) => m.kind === "ignored");
    expect(ignored.map((i) => i.movementType)).toEqual(["Rendimento", "Transferência"]);
  });

  it("gives the same movement the same id every time", () => {
    const a = mapMovements(movements).filter((m) => m.kind === "trade");
    const b = mapMovements(movements).filter((m) => m.kind === "trade");
    expect(a.map((t) => t.externalId)).toEqual(b.map((t) => t.externalId));
    expect(new Set(a.map((t) => t.externalId)).size).toBe(a.length);
  });
});

describe("importB3", () => {
  let db: Db;
  let close: () => void;
  beforeEach(() => ({ db, close } = createDb(":memory:")));
  afterEach(() => close());

  it("imports once and skips on the next sync", () => {
    const first = importB3(db, movements);
    expect(first).toMatchObject({ tradesCreated: 5, tradesSkipped: 0, matchedOtherSource: 0, assetsCreated: 4, institutionsCreated: 2 });
    expect(first.ignored).toHaveLength(2);
    expect(importB3(db, movements)).toMatchObject({ tradesCreated: 0, tradesSkipped: 5 });
  });

  it("does not duplicate buys and sales that already came from myProfit", async () => {
    const conn = { app: await buildApp(db) };
    const post = (url: string, payload: object) => conn.app.inject({ method: "POST", url, payload });
    const bbas = (await post("/assets", { ticker: "BBAS3", assetClass: "stock_br" })).json();
    // myProfit has the trade date (D+0); B3 reports settlement two days later.
    await post("/trades", {
      assetId: bbas.id,
      tradeDate: "2024-04-01",
      type: "buy",
      quantity: "100",
      unitPrice: "55.20",
      fees: "0.5",
      source: "myprofit",
      externalId: "x",
    });
    const result = importB3(db, movements);
    expect(result).toMatchObject({ tradesCreated: 4, matchedOtherSource: 1 });

    const positions = (await conn.app.inject({ method: "GET", url: "/portfolio/positions" })).json();
    // 100 bought (from myProfit, with fees) + 100 from the split at zero cost.
    expect(positions.find((p: { ticker: string }) => p.ticker === "BBAS3")).toMatchObject({
      quantity: "200",
      totalCost: "5520.50",
    });
    await conn.app.close();
  });

  it("writes nothing on a dry run", () => {
    expect(importB3(db, movements, { dryRun: true }).tradesCreated).toBe(5);
    expect(importB3(db, movements).tradesCreated).toBe(5);
  });
});

describe("B3Client", () => {
  const config: B3Config = {
    baseUrl: "https://b3.example/api/movement/v2",
    tokenUrl: "https://b3.example/token",
    clientId: "id",
    clientSecret: "secret",
    documentNumber: "00123456789",
  };

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  it("gets a token, follows pages, retries 429 and treats 404 as no data", async () => {
    const calls: string[] = [];
    let equityCalls = 0;
    const fetch = async (url: string, init: RequestInit) => {
      calls.push(url);
      if (url === config.tokenUrl) {
        expect(String(init.body)).toContain("grant_type=client_credentials");
        return json({ access_token: "tok", expires_in: 3600 });
      }
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
      if (url.includes("/equities/")) {
        equityCalls++;
        if (equityCalls === 1) return json({}, 429, { "retry-after": "1" });
        return url.includes("page=1") ? json(fixture.equities[0]) : json(fixture.equities[1]);
      }
      if (url.includes("/fixed-income/")) return json(fixture.fixedIncome);
      return new Response("", { status: 404 });
    };
    const sleeps: number[] = [];
    const client = new B3Client(config, { fetch, sleep: async (ms) => void sleeps.push(ms) });

    const result = await client.fetchMovements("2024-04-01", "2024-04-30");
    expect(result.equities).toHaveLength(5);
    expect(result.fixedIncome).toHaveLength(1);
    expect(result.treasuryBonds).toHaveLength(0);
    expect(sleeps).toEqual([1000]);
    expect(calls.filter((c) => c === config.tokenUrl)).toHaveLength(1);
    expect(calls.find((c) => c.includes("/equities/"))).toBe(
      "https://b3.example/api/movement/v2/equities/investors/00123456789?referenceStartDate=2024-04-01&referenceEndDate=2024-04-30&page=1",
    );
  });

  it("fails with a clear error on other statuses", async () => {
    const fetch = async (url: string) =>
      url === config.tokenUrl ? json({ access_token: "tok" }) : new Response("CPF/CNPJ não localizado", { status: 422 });
    const client = new B3Client(config, { fetch });
    await expect(client.fetchMovements("2024-04-01", "2024-04-30")).rejects.toThrow(/422: CPF\/CNPJ não localizado/);
  });

  it("splits long periods into months", () => {
    expect(monthWindows("2024-01-15", "2024-03-10")).toEqual([
      { start: "2024-01-15", end: "2024-01-31" },
      { start: "2024-02-01", end: "2024-02-29" },
      { start: "2024-03-01", end: "2024-03-10" },
    ]);
  });

  it("reads its config from the environment", () => {
    expect(b3ConfigFromEnv({})).toBeNull();
    expect(
      b3ConfigFromEnv({
        B3_BASE_URL: "https://b3/api/",
        B3_TOKEN_URL: "https://b3/token",
        B3_CLIENT_ID: "a",
        B3_CLIENT_SECRET: "b",
        B3_DOCUMENT_NUMBER: "123.456.789-01",
      }),
    ).toMatchObject({ baseUrl: "https://b3/api", documentNumber: "12345678901" });
  });
});

describe("B3 routes", () => {
  let app: FastifyInstance;
  let close: () => void;
  beforeEach(async () => {
    const conn = createDb(":memory:");
    close = conn.close;
    app = await buildApp(conn.db);
  });
  afterEach(async () => {
    await app.close();
    close();
  });

  it("explains when the API is not configured", async () => {
    expect((await app.inject({ method: "GET", url: "/integrations/b3/status" })).json()).toEqual({ configured: false });
    const res = await app.inject({ method: "POST", url: "/integrations/b3/sync", payload: { from: "2024-01-01", to: "2024-01-31" } });
    expect(res.statusCode).toBe(501);
  });

  it("imports saved API responses", async () => {
    const res = await app.inject({ method: "POST", url: "/imports/b3", payload: fixture });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tradesCreated: 5, ignored: [expect.objectContaining({ count: 1 }), expect.anything()] });
  });
});
