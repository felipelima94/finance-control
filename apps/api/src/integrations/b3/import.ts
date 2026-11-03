import Decimal from "decimal.js";
import { and, eq, gte, lte, ne } from "drizzle-orm";
import type { B3ImportResult } from "@fc/shared";
import type { Db } from "../../db/client";
import { assets, institutions, trades } from "../../db/schema";
import { mapMovements } from "./mapper";
import type { B3Movements } from "./types";

/** How far back a buy or sale from another source can be and still count as the same operation (B3 reports settlement, D+2). */
const MATCH_WINDOW_DAYS = 7;

const minusDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

/**
 * Writes B3 movements as trades with source "b3".
 * - Movements already imported from B3 are skipped (by externalId).
 * - A buy or sale that already exists from another source (same asset, type and quantity,
 *   up to 7 days earlier) is skipped too, so myProfit history and B3 never double count.
 * - Movement types that do not change positions are counted under `ignored`.
 */
export function importB3(db: Db, movements: B3Movements, opts: { dryRun?: boolean } = {}): B3ImportResult {
  const mapped = mapMovements(movements);
  const result: B3ImportResult = {
    dryRun: !!opts.dryRun,
    rowsRead: mapped.length,
    tradesCreated: 0,
    tradesSkipped: 0,
    matchedOtherSource: 0,
    assetsCreated: 0,
    institutionsCreated: 0,
    ignored: [],
    errors: [],
  };

  const ignored = new Map<string, { reason: string; movementType: string; count: number }>();
  for (const m of mapped) {
    if (m.kind !== "ignored") continue;
    const key = `${m.reason}|${m.movementType}`;
    const e = ignored.get(key) ?? { reason: m.reason, movementType: m.movementType, count: 0 };
    e.count++;
    ignored.set(key, e);
  }
  result.ignored = [...ignored.values()].sort((a, b) => b.count - a.count);

  const run = () => {
    const instIds = new Map<string, number>();
    const assetIds = new Map<string, number>();

    for (const m of mapped) {
      if (m.kind !== "trade") continue;

      if (db.select({ id: trades.id }).from(trades).where(and(eq(trades.source, "b3"), eq(trades.externalId, m.externalId))).get()) {
        result.tradesSkipped++;
        continue;
      }

      let assetId = assetIds.get(m.ticker);
      if (!assetId) {
        let row = db.select({ id: assets.id }).from(assets).where(eq(assets.ticker, m.ticker)).get();
        if (!row) {
          row = db.insert(assets).values({ ticker: m.ticker, assetClass: m.assetClass, currency: "BRL" }).returning({ id: assets.id }).get();
          result.assetsCreated++;
        }
        assetId = row.id;
        assetIds.set(m.ticker, assetId);
      }

      if (m.matchable) {
        const candidates = db
          .select({ quantity: trades.quantity })
          .from(trades)
          .where(
            and(
              eq(trades.assetId, assetId),
              eq(trades.type, m.type),
              ne(trades.source, "b3"),
              gte(trades.tradeDate, minusDays(m.tradeDate, MATCH_WINDOW_DAYS)),
              lte(trades.tradeDate, m.tradeDate),
            ),
          )
          .all();
        if (candidates.some((c) => c.quantity != null && new Decimal(c.quantity).eq(m.quantity))) {
          result.matchedOtherSource++;
          continue;
        }
      }

      let institutionId = instIds.get(m.institution);
      if (!institutionId) {
        let row = db.select({ id: institutions.id }).from(institutions).where(eq(institutions.name, m.institution)).get();
        if (!row) {
          row = db.insert(institutions).values({ name: m.institution, kind: "broker" }).returning({ id: institutions.id }).get();
          result.institutionsCreated++;
        }
        institutionId = row.id;
        instIds.set(m.institution, institutionId);
      }

      db.insert(trades)
        .values({
          assetId,
          institutionId,
          tradeDate: m.tradeDate,
          type: m.type,
          quantity: m.quantity,
          unitPrice: m.unitPrice,
          fees: "0",
          currency: "BRL",
          source: "b3",
          externalId: m.externalId,
          notes: `B3: ${m.description}`,
        })
        .run();
      result.tradesCreated++;
    }
  };

  const DRY_RUN = Symbol("dry-run");
  try {
    db.transaction(() => {
      run();
      if (opts.dryRun) throw DRY_RUN;
    });
  } catch (e) {
    if (e !== DRY_RUN) throw e;
  }
  return result;
}
