import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createDb } from "../src/db/client";

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

const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as object });

describe("health", () => {
  it("responds ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("institutions", () => {
  it("supports create, read, update, delete", async () => {
    const created = await post("/institutions", { name: "XP" });
    expect(created.statusCode).toBe(201);
    const inst = created.json();
    expect(inst).toMatchObject({ name: "XP", kind: "broker" });

    const got = await app.inject({ method: "GET", url: `/institutions/${inst.id}` });
    expect(got.json().name).toBe("XP");

    const updated = await app.inject({
      method: "PUT",
      url: `/institutions/${inst.id}`,
      payload: { name: "XP Investimentos", kind: "broker" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().name).toBe("XP Investimentos");

    const list = await app.inject({ method: "GET", url: "/institutions" });
    expect(list.json()).toHaveLength(1);

    const del = await app.inject({ method: "DELETE", url: `/institutions/${inst.id}` });
    expect(del.statusCode).toBe(204);
    const missing = await app.inject({ method: "GET", url: `/institutions/${inst.id}` });
    expect(missing.statusCode).toBe(404);
  });

  it("rejects duplicates with 409", async () => {
    await post("/institutions", { name: "Avenue" });
    const dup = await post("/institutions", { name: "Avenue" });
    expect(dup.statusCode).toBe(409);
  });

  it("returns 400 with issues on invalid input", async () => {
    const res = await post("/institutions", { name: "" });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues[0].path).toBe("name");
  });
});

describe("categories", () => {
  it("blocks duplicate top-level names but allows the same name under different parents", async () => {
    const casa = (await post("/categories", { name: "Casa", kind: "expense" })).json();
    const lazer = (await post("/categories", { name: "Lazer", kind: "expense" })).json();
    expect((await post("/categories", { name: "Casa", kind: "expense" })).statusCode).toBe(409);
    expect((await post("/categories", { name: "Casa", kind: "income" })).statusCode).toBe(201);
    expect((await post("/categories", { name: "Outros", kind: "expense", parentId: casa.id })).statusCode).toBe(201);
    expect((await post("/categories", { name: "Outros", kind: "expense", parentId: lazer.id })).statusCode).toBe(201);
    expect((await post("/categories", { name: "Outros", kind: "expense", parentId: casa.id })).statusCode).toBe(409);
  });
});

describe("cash transactions", () => {
  it("stores amounts as exact decimals and filters by date and direction", async () => {
    const cat = (await post("/categories", { name: "Salário", kind: "income" })).json();
    await post("/cash-transactions", {
      date: "2026-10-05",
      description: "Salário outubro",
      amount: "10000.10",
      direction: "in",
      categoryId: cat.id,
    });
    await post("/cash-transactions", { date: "2026-11-01", description: "Mercado", amount: 0.1, direction: "out" });

    const oct = await app.inject({ method: "GET", url: "/cash-transactions?from=2026-10-01&to=2026-10-31" });
    expect(oct.json()).toHaveLength(1);
    expect(oct.json()[0].amount).toBe("10000.10");

    const out = await app.inject({ method: "GET", url: "/cash-transactions?direction=out" });
    expect(out.json()[0]).toMatchObject({ amount: "0.1", currency: "BRL" });
  });

  it("rejects negative amounts and unknown categories", async () => {
    const neg = await post("/cash-transactions", { date: "2026-11-01", description: "x", amount: "-1", direction: "out" });
    expect(neg.statusCode).toBe(400);
    const fk = await post("/cash-transactions", {
      date: "2026-11-01",
      description: "x",
      amount: "1",
      direction: "out",
      categoryId: 999,
    });
    expect(fk.statusCode).toBe(409);
  });
});

describe("assets and trades", () => {
  it("records buys, sells and splits, and lists them by asset in date order", async () => {
    const xp = (await post("/institutions", { name: "XP" })).json();
    const hglg = (await post("/assets", { ticker: "hglg11", assetClass: "fii" })).json();
    expect(hglg.ticker).toBe("HGLG11");

    await post("/trades", {
      assetId: hglg.id,
      institutionId: xp.id,
      tradeDate: "2020-01-08",
      type: "sell",
      quantity: "5",
      unitPrice: "209",
      fees: "0.31",
    });
    await post("/trades", {
      assetId: hglg.id,
      institutionId: xp.id,
      tradeDate: "2019-12-02",
      type: "buy",
      quantity: "10",
      unitPrice: "180.50",
    });
    const split = await post("/trades", { assetId: hglg.id, tradeDate: "2025-01-02", type: "split", factor: "10" });
    expect(split.statusCode).toBe(201);

    const list = (await app.inject({ method: "GET", url: `/trades?assetId=${hglg.id}` })).json();
    expect(list.map((t: { type: string }) => t.type)).toEqual(["buy", "sell", "split"]);
    expect(list[1]).toMatchObject({ fees: "0.31", isDayTrade: false, source: "manual" });
  });

  it("validates fields required by each trade type", async () => {
    const a = (await post("/assets", { ticker: "VOO", assetClass: "etf_us", currency: "USD" })).json();
    const noQty = await post("/trades", { assetId: a.id, tradeDate: "2026-01-02", type: "buy", unitPrice: "500" });
    expect(noQty.statusCode).toBe(400);
    expect(noQty.json().issues[0].path).toBe("quantity");
    const noFactor = await post("/trades", { assetId: a.id, tradeDate: "2026-01-02", type: "split" });
    expect(noFactor.json().issues[0].path).toBe("factor");
  });

  it("deduplicates imported trades by source and externalId", async () => {
    const a = (await post("/assets", { ticker: "ITSA4", assetClass: "stock_br" })).json();
    const trade = {
      assetId: a.id,
      tradeDate: "2026-01-02",
      type: "buy",
      quantity: "100",
      unitPrice: "10",
      source: "b3",
      externalId: "abc-1",
    };
    expect((await post("/trades", trade)).statusCode).toBe(201);
    expect((await post("/trades", trade)).statusCode).toBe(409);
    // Manual trades without externalId never clash.
    const manual = { ...trade, source: "manual", externalId: undefined };
    expect((await post("/trades", manual)).statusCode).toBe(201);
    expect((await post("/trades", manual)).statusCode).toBe(201);
  });

  it("does not delete an asset that still has trades", async () => {
    const a = (await post("/assets", { ticker: "BBAS3", assetClass: "stock_br" })).json();
    await post("/trades", { assetId: a.id, tradeDate: "2026-01-02", type: "buy", quantity: "1", unitPrice: "20" });
    const del = await app.inject({ method: "DELETE", url: `/assets/${a.id}` });
    expect(del.statusCode).toBe(409);
  });
});

describe("seed", () => {
  it("creates default categories once", async () => {
    const { seed } = await import("../src/db/seed");
    const conn = createDb(":memory:");
    const first = seed(conn.db);
    expect(first).toBeGreaterThan(10);
    expect(seed(conn.db)).toBe(0);
    conn.close();
  });
});
