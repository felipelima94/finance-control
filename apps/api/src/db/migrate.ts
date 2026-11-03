import { config } from "../config";
import { createDb } from "./client";

const { close } = createDb(config.databaseFile);
close();
console.log(`Migrated ${config.databaseFile}`);
