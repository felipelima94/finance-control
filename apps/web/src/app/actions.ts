"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, apiDelete, apiGet, apiPost, type Asset } from "@/lib/api";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const num = (fd: FormData, k: string) => (str(fd, k) ? Number(str(fd, k)) : undefined);
/** Accepts "1.234,56" or "1234.56" and returns "1234.56". */
const dec = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (!v) return undefined;
  return v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
};

function back(path: string, params: Record<string, string>): never {
  const [base, query] = path.split("?");
  const q = new URLSearchParams(query);
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  redirect(`${base}?${q.toString()}`);
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : "Erro inesperado ao falar com a API");

export async function createCashTransaction(fd: FormData) {
  const returnTo = str(fd, "returnTo") ?? "/lancamentos";
  try {
    await apiPost("/cash-transactions", {
      date: str(fd, "date"),
      description: str(fd, "description"),
      amount: dec(fd, "amount"),
      direction: str(fd, "direction"),
      categoryId: num(fd, "categoryId") ?? null,
      institutionId: num(fd, "institutionId") ?? null,
      notes: str(fd, "notes") ?? null,
    });
  } catch (e) {
    back(returnTo, { error: message(e) });
  }
  revalidatePath("/", "layout");
  back(returnTo, { ok: "Lançamento salvo" });
}

export async function deleteCashTransaction(fd: FormData) {
  const returnTo = str(fd, "returnTo") ?? "/lancamentos";
  try {
    await apiDelete(`/cash-transactions/${num(fd, "id")}`);
  } catch (e) {
    back(returnTo, { error: message(e) });
  }
  revalidatePath("/", "layout");
  back(returnTo, { ok: "Lançamento excluído" });
}

export async function createTrade(fd: FormData) {
  const returnTo = str(fd, "returnTo") ?? "/operacoes";
  try {
    const ticker = str(fd, "ticker")?.toUpperCase();
    if (!ticker) throw new ApiError(400, { message: "Informe o ativo" });
    const assets = await apiGet<Asset[]>("/assets");
    let asset = assets.find((a) => a.ticker === ticker);
    if (!asset) {
      asset = await apiPost<Asset>("/assets", {
        ticker,
        assetClass: str(fd, "assetClass") ?? "stock_br",
        currency: str(fd, "currency") ?? "BRL",
      });
    }
    await apiPost("/trades", {
      assetId: asset.id,
      institutionId: num(fd, "institutionId") ?? null,
      tradeDate: str(fd, "tradeDate"),
      type: str(fd, "type"),
      quantity: dec(fd, "quantity") ?? null,
      unitPrice: dec(fd, "unitPrice") ?? null,
      fees: dec(fd, "fees") ?? "0",
      factor: dec(fd, "factor") ?? null,
      currency: asset.currency,
      notes: str(fd, "notes") ?? null,
    });
  } catch (e) {
    back(returnTo, { error: message(e) });
  }
  revalidatePath("/", "layout");
  back(returnTo, { ok: "Operação salva" });
}

export async function deleteTrade(fd: FormData) {
  const returnTo = str(fd, "returnTo") ?? "/operacoes";
  try {
    await apiDelete(`/trades/${num(fd, "id")}`);
  } catch (e) {
    back(returnTo, { error: message(e) });
  }
  revalidatePath("/", "layout");
  back(returnTo, { ok: "Operação excluída" });
}
