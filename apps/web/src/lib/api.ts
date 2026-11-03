/** Base URL of the local Fastify API. Override with API_URL in apps/web/.env.local. */
export const API_URL = process.env.API_URL ?? "http://127.0.0.1:3333";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { message?: string; issues?: { path: string; message: string }[] },
  ) {
    super(body.message ?? body.issues?.map((i) => `${i.path}: ${i.message}`).join("; ") ?? `HTTP ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body: unknown) => request<T>("POST", path, body);
export const apiDelete = (path: string) => request<void>("DELETE", path);

/** Returns null instead of throwing when the API is down, so pages can show a friendly message. */
export async function tryGet<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path);
  } catch {
    return null;
  }
}

// Row shapes returned by the CRUD routes.
export interface Institution {
  id: number;
  name: string;
}
export interface Category {
  id: number;
  name: string;
  kind: "income" | "expense";
  parentId: number | null;
}
export interface CashTransaction {
  id: number;
  date: string;
  description: string;
  amount: string;
  direction: "in" | "out";
  currency: string;
  categoryId: number | null;
  institutionId: number | null;
}
export interface Asset {
  id: number;
  ticker: string;
  assetClass: string;
  currency: string;
}
export interface Trade {
  id: number;
  assetId: number;
  institutionId: number | null;
  tradeDate: string;
  type: string;
  quantity: string | null;
  unitPrice: string | null;
  fees: string;
  factor: string | null;
  currency: string;
  source: string;
}
