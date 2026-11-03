import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

export class NotFoundError extends Error {
  statusCode = 404;
  constructor(what: string) {
    super(`${what} not found`);
  }
}

export class ConflictError extends Error {
  statusCode = 409;
  name = "Conflict";
}

function sqliteCode(err: unknown): string | undefined {
  if (typeof err === "object" && err && "code" in err && typeof err.code === "string") return err.code;
  const cause = (err as { cause?: unknown })?.cause;
  return cause ? sqliteCode(cause) : undefined;
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number };
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: "ValidationError",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof NotFoundError) {
      return reply.status(404).send({ error: "NotFound", message: err.message });
    }
    const code = sqliteCode(err);
    if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      return reply.status(409).send({ error: "Conflict", message: "A record with these values already exists" });
    }
    // RESTRICT violations surface as SQLITE_CONSTRAINT_TRIGGER with a "FOREIGN KEY" message.
    if (code === "SQLITE_CONSTRAINT_FOREIGNKEY" || (code === "SQLITE_CONSTRAINT_TRIGGER" && /FOREIGN KEY/i.test(err.message))) {
      return reply.status(409).send({
        error: "Conflict",
        message: "Referenced record does not exist, or this record is still in use",
      });
    }
    const status = err.statusCode;
    if (status && status < 500) return reply.status(status).send({ error: err.name, message: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: "InternalServerError" });
  });
}
