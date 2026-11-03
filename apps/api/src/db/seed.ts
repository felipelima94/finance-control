import { and, eq, isNull } from "drizzle-orm";
import type { CategoryKind } from "@fc/shared";
import { config } from "../config";
import { createDb, type Db } from "./client";
import { categories } from "./schema";

/** Starter categories. Edit freely through the API; re-running the seed never duplicates them. */
export const defaultCategories: Record<CategoryKind, string[]> = {
  income: ["Salário", "Freelance", "Rendimentos", "Reembolsos", "Outras receitas"],
  expense: [
    "Moradia",
    "Alimentação",
    "Transporte",
    "Saúde",
    "Educação",
    "Lazer",
    "Assinaturas",
    "Compras",
    "Impostos e taxas",
    "Outras despesas",
  ],
};

export function seed(db: Db) {
  let created = 0;
  for (const [kind, names] of Object.entries(defaultCategories) as [CategoryKind, string[]][]) {
    for (const name of names) {
      const exists = db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.name, name), eq(categories.kind, kind), isNull(categories.parentId)))
        .get();
      if (!exists) {
        db.insert(categories).values({ name, kind }).run();
        created++;
      }
    }
  }
  return created;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, close } = createDb(config.databaseFile);
  console.log(`Seeded ${seed(db)} categories into ${config.databaseFile}`);
  close();
}
