import type { FastifyInstance } from "fastify";
import { b3SyncInput } from "@fc/shared";
import { z } from "zod";
import type { Db } from "../db/client";
import type { B3Client } from "../integrations/b3/client";
import { importB3 } from "../integrations/b3/import";
import { movementsFromResponses } from "../integrations/b3/types";

const pages = z
  .union([z.array(z.any()), z.record(z.string(), z.any())])
  .optional()
  .transform((v) => (v == null ? [] : Array.isArray(v) ? v : [v]));

/** Body of POST /imports/b3: raw API responses (one or many pages) per endpoint. */
const b3FileInput = z.object({ equities: pages, fixedIncome: pages, treasuryBonds: pages });

const yesterday = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export function registerB3Routes(app: FastifyInstance, db: Db, client: B3Client | null) {
  app.get("/integrations/b3/status", async () => ({ configured: client != null }));

  /** Fetches movements from the B3 API (data up to D-1) and imports them. */
  app.post("/integrations/b3/sync", async (req, reply) => {
    if (!client) {
      return reply.status(501).send({
        error: "NotConfigured",
        message: "B3 API is not configured. Set B3_BASE_URL, B3_TOKEN_URL, B3_CLIENT_ID, B3_CLIENT_SECRET and B3_DOCUMENT_NUMBER.",
      });
    }
    const input = b3SyncInput.parse(req.body);
    const to = input.to > yesterday() ? yesterday() : input.to;
    const movements = await client.fetchMovements(input.from, to);
    return importB3(db, movements, { dryRun: input.dryRun });
  });

  /**
   * Imports B3 API responses saved as JSON, without calling the API:
   *   { "equities": [<EquitiesMovementRsp>...], "fixedIncome": [...], "treasuryBonds": [...] }
   */
  app.post("/imports/b3", async (req) => {
    const q = z.object({ dryRun: z.enum(["true", "false"]).optional() }).parse(req.query);
    const body = b3FileInput.parse(req.body);
    return importB3(db, movementsFromResponses(body), { dryRun: q.dryRun === "true" });
  });
}
