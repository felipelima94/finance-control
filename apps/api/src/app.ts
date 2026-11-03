import cors from "@fastify/cors";
import Fastify from "fastify";
import type { Db } from "./db/client";
import { registerErrorHandler } from "./errors";
import { registerRoutes } from "./routes";

export async function buildApp(db: Db, opts: { logger?: boolean; corsOrigin?: string } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: opts.corsOrigin ?? true });
  registerErrorHandler(app);
  registerRoutes(app, db);
  return app;
}
