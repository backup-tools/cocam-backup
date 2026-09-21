import type { Budget } from "./budget";
import type { Throttle } from "./throttle";
import type { Envelope } from "./types";

const DEFAULT_BASE = "https://app.companycam.com";
const UA = "cocam-backup/1.0 (+https://github.com/backup-tools/cocam-backup)";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Whether the token itself is unusable. */
  get fatal(): boolean {
    return (
      this.status === 401 ||
      this.code === "invalid_token" ||
      this.code === "token_expired" ||
      this.code === "token_revoked"
    );
  }

  /** Whether the resource can be skipped. */
  get skippable(): boolean {
    return this.status === 404 || this.status === 403;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CompanyCam {
  constructor(
    private readonly token: string,
    private readonly budget: Budget,
    private readonly base: string = DEFAULT_BASE,
    private readonly throttle?: Throttle,
  ) {}

  /** GET an endpoint, retrying on 429 and 5xx. */
  async get<T>(path: string, params: Record<string, string | undefined> = {}): Promise<Envelope<T>> {
    const url = new URL(path, this.base);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      this.budget.spend();
      if (this.throttle) await this.throttle.wait();
      let res: Response;
      try {
        res = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/json",
            "User-Agent": UA,
          },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        lastErr = e;
        await sleep(backoff(attempt));
        continue;
      }

      if (res.ok) return (await res.json()) as Envelope<T>;

      // Honour Retry-After when present.
      if (res.status === 429) {
        const wait = retryAfterMs(res) ?? backoff(attempt);
        await res.body?.cancel();
        await sleep(wait);
        continue;
      }

      const body = await res.text().catch(() => "");
      const code = firstErrorCode(body);
      const err = new ApiError(
        `GET ${url.pathname} -> ${res.status}${code ? ` (${code})` : ""} ${body.slice(0, 200)}`,
        res.status,
        code,
      );
      if (err.fatal || (res.status >= 400 && res.status < 500)) throw err;
      lastErr = err;
      await sleep(backoff(attempt));
    }
    throw lastErr instanceof Error ? lastErr : new ApiError(`GET ${url.pathname} failed`, 0);
  }

  /** Walks a cursor-paginated endpoint one page at a time. */
  async *paginate<T>(
    path: string,
    params: Record<string, string | undefined> = {},
    startCursor?: string,
  ): AsyncGenerator<{ items: T[]; nextCursor: string | null }> {
    let cursor = startCursor;
    for (;;) {
      const env = await this.get<T[]>(path, { ...params, limit: "100", after: cursor });
      const items = Array.isArray(env.data) ? env.data : [];
      const next = env.meta?.has_next ? (env.meta.next_cursor ?? null) : null;
      yield { items, nextCursor: next };
      if (!next) return;
      cursor = next;
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(8000, 400 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get("Retry-After");
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(30_000, Math.max(1000, secs * 1000));
  const when = Date.parse(h);
  return Number.isFinite(when) ? Math.min(30_000, Math.max(1000, when - Date.now())) : null;
}

function firstErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as Envelope;
    return parsed.errors?.[0]?.code;
  } catch {
    return undefined;
  }
}
