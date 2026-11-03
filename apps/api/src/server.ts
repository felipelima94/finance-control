import { buildApp } from "./app";
import { config } from "./config";
import { createDb } from "./db/client";

const { db, close } = createDb(config.databaseFile);
const app = await buildApp(db, { logger: true, corsOrigin: config.corsOrigin });

const shutdown = async () => {
  await app.close();
  close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
