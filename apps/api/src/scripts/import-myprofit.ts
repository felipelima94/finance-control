import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config";
import { createDb } from "../db/client";
import { importMyProfit, parseMyProfit } from "../importers/myprofit";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: pnpm import:myprofit <relatorio.xlsx> [--dry-run]");
  process.exit(1);
}

const { db, close } = createDb(config.databaseFile);
const parsed = await parseMyProfit(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), file)));
const result = importMyProfit(db, parsed, { dryRun });
close();

console.log(JSON.stringify(result, null, 2));
if (result.errors.length) process.exitCode = 1;
