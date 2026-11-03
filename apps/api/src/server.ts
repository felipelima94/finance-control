import { buildApp } from "./app";
import { config } from "./config";
import { createDb } from "./db/client";
import { B3Client, b3ConfigFromEnv } from "./integrations/b3/client";

const { db, close } = createDb(config.databaseFile);
const b3 = b3ConfigFromEnv();
const app = await buildApp(db, { logger: true, corsOrigin: config.corsOrigin, b3Client: b3 ? new B3Client(b3) : null });

const shutdown = async () => {
  await app.close();
  close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
