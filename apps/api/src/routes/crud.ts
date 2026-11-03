import { eq, type SQL } from "drizzle-orm";
import type { SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import type { FastifyInstance } from "fastify";
import type { ZodType } from "zod";
import { idParam } from "@fc/shared";
import type { Db } from "../db/client";
import { NotFoundError } from "../errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Table = SQLiteTableWithColumns<any>;

export interface CrudOptions {
  /** URL prefix, e.g. "/institutions". */
  path: string;
  /** Human name used in error messages. */
  name: string;
  table: Table;
  input: ZodType;
  /** Builds WHERE filters from the query string for the list route. */
  listFilter?: (query: unknown) => SQL | undefined;
  /** ORDER BY for the list route. */
  orderBy?: SQL[] | ((t: Table) => SQL[]);
  /** Extra checks before insert/update. `id` is set on updates. Throw to reject. */
  validate?: (data: Record<string, unknown>, id?: number) => void;
}

/**
 * Registers list / get / create / replace / delete routes for a table.
 * Updates are full replacements (PUT) validated with the same schema as create.
 */
export function registerCrud(app: FastifyInstance, db: Db, opts: CrudOptions) {
  const { path, name, table } = opts;
  const idCol = table.id;

  app.get(path, async (req) => {
    let q = db.select().from(table).$dynamic();
    const where = opts.listFilter?.(req.query);
    if (where) q = q.where(where);
    const order = typeof opts.orderBy === "function" ? opts.orderBy(table) : opts.orderBy;
    if (order?.length) q = q.orderBy(...order);
    return q.all();
  });

  app.get(`${path}/:id`, async (req) => {
    const { id } = idParam.parse(req.params);
    const row = db.select().from(table).where(eq(idCol, id)).get();
    if (!row) throw new NotFoundError(name);
    return row;
  });

  app.post(path, async (req, reply) => {
    const data = opts.input.parse(req.body) as Record<string, unknown>;
    opts.validate?.(data);
    const row = db.insert(table).values(data).returning().get();
    return reply.status(201).send(row);
  });

  app.put(`${path}/:id`, async (req) => {
    const { id } = idParam.parse(req.params);
    const data = opts.input.parse(req.body) as Record<string, unknown>;
    opts.validate?.(data, id);
    const row = db
      .update(table)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(idCol, id))
      .returning()
      .get();
    if (!row) throw new NotFoundError(name);
    return row;
  });

  app.delete(`${path}/:id`, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const row = db.delete(table).where(eq(idCol, id)).returning().get();
    if (!row) throw new NotFoundError(name);
    return reply.status(204).send();
  });
}
