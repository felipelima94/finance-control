/** Base URL of the local Fastify API. Override with API_URL in apps/web/.env.local. */
export const API_URL = process.env.API_URL ?? "http://127.0.0.1:3333";

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} failed with ${res.status}`);
  return res.json() as Promise<T>;
}
