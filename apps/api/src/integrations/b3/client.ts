import { readFileSync } from "node:fs";
import { Agent, type Dispatcher } from "undici";
import {
  emptyMovements,
  movementsFromResponses,
  type B3Links,
  type B3Movements,
  type EquitiesMovementRsp,
  type FixedIncomeMovementRsp,
  type TreasuryBondsMovementRsp,
} from "./types";

export interface B3Config {
  /** API base, e.g. https://<host>/api/movement/v2 (the swagger leaves the host as a placeholder). */
  baseUrl: string;
  /** OAuth2 client-credentials token endpoint. */
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  /** Client certificate and key (PEM) for mutual TLS, when B3 requires it. */
  certFile?: string;
  keyFile?: string;
  /** CPF of the investor whose movements are read. */
  documentNumber: string;
}

/** Reads the B3 settings from environment variables. Returns null when they are not set. */
export function b3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): B3Config | null {
  const { B3_BASE_URL, B3_TOKEN_URL, B3_CLIENT_ID, B3_CLIENT_SECRET, B3_DOCUMENT_NUMBER } = env;
  if (!B3_BASE_URL || !B3_TOKEN_URL || !B3_CLIENT_ID || !B3_CLIENT_SECRET || !B3_DOCUMENT_NUMBER) return null;
  return {
    baseUrl: B3_BASE_URL.replace(/\/$/, ""),
    tokenUrl: B3_TOKEN_URL,
    clientId: B3_CLIENT_ID,
    clientSecret: B3_CLIENT_SECRET,
    scope: env.B3_SCOPE,
    certFile: env.B3_CERT_FILE,
    keyFile: env.B3_KEY_FILE,
    documentNumber: B3_DOCUMENT_NUMBER.replace(/\D/g, ""),
  };
}

export class B3ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type FetchLike = (url: string, init: RequestInit & { dispatcher?: Dispatcher }) => Promise<Response>;

export interface B3ClientOptions {
  fetch?: FetchLike;
  /** Waits between retries; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

/** Splits [from, to] into calendar-month windows, the unit each request asks for. */
export function monthWindows(from: string, to: string): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let cur = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  while (cur <= last) {
    const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    const end = monthEnd < last ? monthEnd : last;
    out.push({ start: cur.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
    cur = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1));
  }
  return out;
}

/**
 * Client for the movement API. It gets an OAuth2 token, follows `page` until
 * `Links.next` is empty, and retries 429 and 5xx responses with backoff.
 */
export class B3Client {
  private token: { value: string; expiresAt: number } | null = null;
  /** Shared by parallel requests so only one token call is in flight. */
  private tokenRequest: Promise<string> | null = null;
  private readonly fetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly dispatcher?: Dispatcher;

  constructor(
    private readonly config: B3Config,
    opts: B3ClientOptions = {},
  ) {
    this.fetch = opts.fetch ?? (globalThis.fetch as FetchLike);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 4;
    if (config.certFile && config.keyFile) {
      this.dispatcher = new Agent({
        connect: { cert: readFileSync(config.certFile), key: readFileSync(config.keyFile) },
      });
    }
  }

  private accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return Promise.resolve(this.token.value);
    this.tokenRequest ??= this.requestToken().finally(() => (this.tokenRequest = null));
    return this.tokenRequest;
  }

  private async requestToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    if (this.config.scope) body.set("scope", this.config.scope);
    const res = await this.fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      dispatcher: this.dispatcher,
    });
    if (!res.ok) throw new B3ApiError(res.status, `B3 token request failed with ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 300) * 1000 };
    return json.access_token;
  }

  private async get<T>(path: string, query: Record<string, string>): Promise<T> {
    const url = `${this.config.baseUrl}${path}?${new URLSearchParams(query)}`;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(url, {
        headers: { authorization: `Bearer ${await this.accessToken()}`, accept: "application/json" },
        dispatcher: this.dispatcher,
      });
      if (res.ok) return (await res.json()) as T;
      // 404 is how the API answers "no movements in this period".
      if (res.status === 404) return { Links: { self: url } } as T;
      if (res.status === 401 && attempt === 0) {
        this.token = null;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      const text = await res.text().catch(() => "");
      throw new B3ApiError(res.status, `B3 ${path} failed with ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
    }
  }

  private async allPages<T extends { Links: B3Links }>(path: string, start: string, end: string): Promise<T[]> {
    const pages: T[] = [];
    for (let page = 1; page <= 1000; page++) {
      const rsp = await this.get<T>(path, {
        referenceStartDate: start,
        referenceEndDate: end,
        page: String(page),
      });
      pages.push(rsp);
      if (!rsp.Links?.next || rsp.Links.next === "null") break;
    }
    return pages;
  }

  /** Fetches equities, fixed income and treasury movements between two dates (inclusive). */
  async fetchMovements(from: string, to: string): Promise<B3Movements> {
    const doc = this.config.documentNumber;
    const result = emptyMovements();
    for (const { start, end } of monthWindows(from, to)) {
      const [equities, fixedIncome, treasuryBonds] = await Promise.all([
        this.allPages<EquitiesMovementRsp>(`/equities/investors/${doc}`, start, end),
        this.allPages<FixedIncomeMovementRsp>(`/fixed-income/investors/${doc}`, start, end),
        this.allPages<TreasuryBondsMovementRsp>(`/treasury-bonds/investors/${doc}`, start, end),
      ]);
      const m = movementsFromResponses({ equities, fixedIncome, treasuryBonds });
      result.equities.push(...m.equities);
      result.fixedIncome.push(...m.fixedIncome);
      result.treasuryBonds.push(...m.treasuryBonds);
    }
    return result;
  }
}
