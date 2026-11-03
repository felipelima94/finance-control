import { resolve } from "node:path";

export const config = {
  port: Number(process.env.PORT ?? 3333),
  host: process.env.HOST ?? "127.0.0.1",
  databaseFile: resolve(process.env.DATABASE_FILE ?? "../../data/finance.db"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
};
