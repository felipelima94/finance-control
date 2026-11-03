import Decimal from "decimal.js";
import type { FastifyInstance } from "fastify";
import { isoDate, positionsQuery, salesQuery } from "@fc/shared";
import { z } from "zod";
import type { Db } from "../db/client";
import { importMyProfit, parseMyProfit } from "../importers/myprofit";
import { loadPortfolio, summarize } from "../portfolio/service";

const XLSX_TYPES = ["application/octet-stream", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

export function registerPortfolioRoutes(app: FastifyInstance, db: Db) {
  app.addContentTypeParser(XLSX_TYPES, { parseAs: "buffer", bodyLimit: 20 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.get("/portfolio/positions", async (req) => {
    const q = positionsQuery.parse(req.query);
    const { positions } = loadPortfolio(db, q.asOf);
    return q.includeClosed ? positions : positions.filter((p) => !new Decimal(p.quantity).isZero());
  });

  app.get("/portfolio/sales", async (req) => {
    const q = salesQuery.parse(req.query);
    const { sales } = loadPortfolio(db, q.to);
    return sales.filter((s) => (!q.from || s.date >= q.from) && (!q.assetId || s.assetId === q.assetId));
  });

  app.get("/portfolio/summary", async (req) => {
    const q = z.object({ asOf: isoDate.optional() }).parse(req.query);
    return summarize(loadPortfolio(db, q.asOf));
  });

  /**
   * Upload a myProfit export as the raw request body:
   *   curl --data-binary @relatorio.xlsx -H 'content-type: application/octet-stream' \
   *        'http://127.0.0.1:3333/imports/myprofit?dryRun=true'
   */
  app.post("/imports/myprofit", async (req, reply) => {
    const q = z.object({ dryRun: z.enum(["true", "false"]).optional() }).parse(req.query);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return reply.status(400).send({ error: "BadRequest", message: "Send the .xlsx file as the request body" });
    }
    let parsed;
    try {
      parsed = await parseMyProfit(req.body);
    } catch {
      return reply.status(400).send({ error: "BadRequest", message: "Could not read the file as .xlsx" });
    }
    return importMyProfit(db, parsed, { dryRun: q.dryRun === "true" });
  });
}
