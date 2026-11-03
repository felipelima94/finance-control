import cors from "@fastify/cors";
import Fastify from "fastify";
import type { Db } from "./db/client";
import type { B3Client } from "./integrations/b3/client";
import { registerErrorHandler } from "./errors";
import { registerRoutes } from "./routes";

export async function buildApp(
  db: Db,
  opts: { logger?: boolean; corsOrigin?: string; b3Client?: B3Client | null } = {},
) {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: opts.corsOrigin ?? true });
  registerErrorHandler(app);
  registerRoutes(app, db, { b3Client: opts.b3Client });
  return app;
}
