import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { b3SyncInput } from "@fc/shared";
import { config } from "../config";
import { createDb } from "../db/client";
import { B3Client, b3ConfigFromEnv } from "../integrations/b3/client";
import { importB3 } from "../integrations/b3/import";
import { movementsFromResponses } from "../integrations/b3/types";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const file = flag("file");

const usage = `Usage:
  pnpm sync:b3 --from 2024-01-01 --to 2024-12-31 [--dry-run]   # calls the B3 API (needs B3_* env vars)
  pnpm sync:b3 --file respostas.json [--dry-run]                # imports saved API responses`;

let movements;
if (file) {
  const json = JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), file), "utf8"));
  const list = (v: unknown) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  movements = movementsFromResponses({
    equities: list(json.equities),
    fixedIncome: list(json.fixedIncome),
    treasuryBonds: list(json.treasuryBonds),
  });
} else {
  const cfg = b3ConfigFromEnv();
  if (!cfg) {
    console.error("B3 API is not configured (B3_BASE_URL, B3_TOKEN_URL, B3_CLIENT_ID, B3_CLIENT_SECRET, B3_DOCUMENT_NUMBER).\n" + usage);
    process.exit(1);
  }
  const input = b3SyncInput.safeParse({ from: flag("from"), to: flag("to"), dryRun });
  if (!input.success) {
    console.error(input.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n") + "\n" + usage);
    process.exit(1);
  }
  movements = await new B3Client(cfg).fetchMovements(input.data.from, input.data.to);
}

const { db, close } = createDb(config.databaseFile);
const result = importB3(db, movements, { dryRun });
close();
console.log(JSON.stringify(result, null, 2));
