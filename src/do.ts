import { DurableObject } from "cloudflare:workers";
import { Budget, BudgetExhausted, isSubrequestLimit } from "./budget";
import { ApiError, CompanyCam } from "./companycam";
import {
  ACCOUNT_RESOURCES,
  PROJECT_RESOURCES,
  documentUrl,
  photoFiles,
  videoUrl,
} from "./plan";
import { Store, extFor, projectDir } from "./store";
import { Throttle } from "./throttle";
import type { Env, JobState, Status } from "./types";

/** Concurrent tasks per shard. */
const CONCURRENCY = 10;
const MAX_ATTEMPTS = 4;
/** Subrequests held back per task. */
const RESERVE_PER_TASK = 6;
/** Shards projects are spread across. */
const DEFAULT_SHARDS = 8;
/** Projects dispatched per wave. */
const WAVE_SIZE = 200;

/** Work window for one tick. */
const TICK_MS = 5 * 60_000;
const TICK_MS_FREE = 15_000;
/** Added to the tick window to give the watchdog delay. */
const WATCHDOG_SLACK_MS = 3 * 60_000;
/** Subrequests attempted per tick before the real ceiling is known. */
const DEFAULT_SUBREQUESTS = 900;
/** Floor for the learned ceiling. */
const MIN_SUBREQUESTS = 20;
/** Folder inside the bucket everything is written under. */
const DEFAULT_PREFIX = "cocam";
/** Bucket name shown in the dashboard when none is configured. */
const DEFAULT_BUCKET = "cocam-archive";
/** Timeout for one asset download. */
const ASSET_TIMEOUT_MS = 120_000;

/** Maps a project id to a shard. */
function shardFor(id: string, count: number): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % count;
}

interface ShardSnapshot {
  pending: number;
  running: number;
  failed: number;
  state: JobState;
  error: string | null;
  counters: Record<string, number>;
  failures: Status["recentFailures"];
  grid: string;
  skipped: Record<string, string>;
}

interface Task {
  id: number;
  kind: string;
  payload: any;
  attempts: number;
}

/** Short label for a queue entry. */
function plural(n: number, one: string, many = one + "s"): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function describeTask(kind: string, payload: any): string {
  const where = payload?.scope ? String(payload.scope).replace(/^projects\//, "") : "";
  switch (kind) {
    case "asset": {
      const name = String(payload?.keyBase ?? "").split("/").pop();
      const proj = String(payload?.keyBase ?? "").split("/")[1] ?? "";
      const what = payload?.kind === "videos" ? "Video" : payload?.kind === "documents" ? "Document" : "Photo";
      return proj ? `${what} ${name} in ${proj}` : `${what} ${name}`;
    }
    case "coll":
      return where ? `${payload.file} for ${where}` : `Account ${payload?.file ?? "data"}`;
    case "project":
      return `Project ${payload?.id}${payload?.name ? ` (${payload.name})` : ""}`;
    case "checklist":
      return `Checklist ${payload?.cid} in ${where}`;
    case "verify":
      return `Project ${payload?.pid}${payload?.dir ? ` (${payload.dir.replace(/^projects\//, "")})` : ""}`;
    case "projects_page":
      return payload?.archived ? "Archived project list" : "Project list";
    default:
      return kind;
  }
}

/** Readable message for an error. */
function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.code === "invalid_token")
      return "CompanyCam rejected the API token. Paste a valid token below and start again.";
    if (err.code === "token_expired") return "The CompanyCam API token has expired. Paste a new one below.";
    if (err.code === "token_revoked") return "The CompanyCam API token was revoked. Paste a new one below.";
    if (err.status === 403)
      return "That token does not have permission to read this data. It needs read access to projects, photos, documents and checklists.";
    if (err.status === 404) return "CompanyCam returned 404 - the item no longer exists.";
    if (err.status === 429) return "CompanyCam is rate limiting the export. It will keep retrying.";
    if (err.status >= 500) return `CompanyCam returned a server error (${err.status}).`;
    return `CompanyCam returned HTTP ${err.status}.`;
  }
  const m = err instanceof Error ? err.message : String(err);
  const asset = m.match(/^asset (\d{3}) for /);
  if (asset) return `The photo host returned HTTP ${asset[1]} for this file.`;
  if (/timed out|aborted|The operation was aborted/i.test(m)) return "The download timed out and will be retried.";
  return m.slice(0, 200);
}

export class BackupJob extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        prio INTEGER NOT NULL DEFAULT 5,
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS task_ready ON task (status, prio, id);
      CREATE UNIQUE INDEX IF NOT EXISTS task_dedupe ON task (kind, payload);
      CREATE TABLE IF NOT EXISTS ledger (
        key TEXT PRIMARY KEY,
        stamp TEXT NOT NULL,
        size INTEGER,
        at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wave (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        stamp TEXT NOT NULL DEFAULT '',
        seq INTEGER,
        sent INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS wave_order ON wave (sent, stamp DESC);
      CREATE TABLE IF NOT EXISTS proj (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        dir TEXT NOT NULL DEFAULT '',
        pending INTEGER NOT NULL DEFAULT 0,
        assets INTEGER NOT NULL DEFAULT 0,
        stored INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        verified INTEGER NOT NULL DEFAULT -1,
        seq INTEGER NOT NULL DEFAULT 0,
        note TEXT
      );
      CREATE TABLE IF NOT EXISTS pagebuf (
        scope TEXT NOT NULL,
        seq INTEGER NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (scope, seq)
      );
    `);
  }

  private get<T>(k: string, fallback: T): T {
    const row = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0] as
      | { v: string }
      | undefined;
    return row ? (JSON.parse(row.v) as T) : fallback;
  }

  private set(k: string, v: unknown): void {
    this.sql.exec(
      "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      k,
      JSON.stringify(v),
    );
  }

  private bump(name: string, by = 1): void {
    const c = this.get<Record<string, number>>("counters", {});
    c[name] = (c[name] ?? 0) + by;
    this.set("counters", c);
  }

  /** Per-project progress tracking. */
  private projTouch(id: string, name?: string, dir?: string): void {
    this.sql.exec(
      "INSERT INTO proj (id, name, dir) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET " +
        "name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE proj.name END, " +
        "dir  = CASE WHEN excluded.dir  <> '' THEN excluded.dir  ELSE proj.dir  END",
      id,
      name ?? "",
      dir ?? "",
    );
  }

  private projAdd(id: string, col: "pending" | "assets" | "stored" | "failed", by: number): void {
    this.projTouch(id);
    this.sql.exec(`UPDATE proj SET ${col} = MAX(0, ${col} + ?) WHERE id = ?`, by, id);
  }

  /** Project id for a task, or null. */
  private static pidOf(kind: string, payload: any): string | null {
    if (kind === "project") return payload?.id ? String(payload.id) : null;
    if (kind === "coll" || kind === "checklist" || kind === "asset" || kind === "verify")
      return payload?.pid ? String(payload.pid) : null;
    return null;
  }

  private enqueue(kind: string, payload: unknown, prio = 5): void {
    const before = this.sql
      .exec("SELECT COUNT(*) AS n FROM task WHERE kind = ? AND payload = ?", kind, JSON.stringify(payload))
      .toArray()[0] as { n: number };
    if (Number(before?.n ?? 0) > 0) return; // already queued - do not double count
    this.sql.exec(
      "INSERT OR IGNORE INTO task (kind, payload, prio) VALUES (?, ?, ?)",
      kind,
      JSON.stringify(payload),
      prio,
    );
    const pid = BackupJob.pidOf(kind, payload);
    if (pid) {
      this.projAdd(pid, "pending", 1);
      if (kind === "asset") this.projAdd(pid, "assets", 1);
    }
  }

  private claim(n: number): Task[] {
    const rows = this.sql
      .exec(
        "SELECT id, kind, payload, attempts FROM task WHERE status = 'pending' ORDER BY prio, id LIMIT ?",
        n,
      )
      .toArray() as Array<{ id: number; kind: string; payload: string; attempts: number }>;
    for (const r of rows) {
      this.sql.exec("UPDATE task SET status = 'running' WHERE id = ?", r.id);
    }
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      payload: JSON.parse(r.payload),
      attempts: r.attempts,
    }));
  }

  private finish(task: Task): void {
    this.sql.exec("DELETE FROM task WHERE id = ?", task.id);
    this.bump("tasksDone");
    const pid = BackupJob.pidOf(task.kind, task.payload);
    if (pid) this.projAdd(pid, "pending", -1);
  }

  private requeue(id: number): void {
    this.sql.exec("UPDATE task SET status = 'pending' WHERE id = ?", id);
  }

  private fail(task: Task, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof ApiError && err.fatal;
    const attempts = task.attempts + 1;

    if (permanent) {
      this.sql.exec(
        "UPDATE task SET status = 'failed', attempts = ?, error = ? WHERE id = ?",
        attempts,
        message,
        task.id,
      );
      this.set("state", "error");
      this.set("error", friendlyError(err));
      this.set("message", "");
      this.recordFailure(task, message, err);
      return;
    }

    if (attempts >= MAX_ATTEMPTS) {
      this.sql.exec(
        "UPDATE task SET status = 'failed', attempts = ?, error = ? WHERE id = ?",
        attempts,
        message,
        task.id,
      );
      this.bump("tasksFailed");
      const fpid = BackupJob.pidOf(task.kind, task.payload);
      if (fpid) {
        this.projAdd(fpid, "pending", -1);
        this.projAdd(fpid, "failed", 1);
      }
      this.recordFailure(task, message, err);
    } else {
      this.sql.exec(
        "UPDATE task SET status = 'pending', attempts = ?, error = ? WHERE id = ?",
        attempts,
        message,
        task.id,
      );
    }
  }

  /** Records a resource that could not be read. */
  private noteSkipped(file: string, err: ApiError): void {
    const map = this.get<Record<string, string>>("skipped", {});
    if (!map[file]) {
      map[file] = err.status === 403 ? "not permitted by this token" : "not available";
      this.set("skipped", map);
    }
  }

  private recordFailure(task: Task, message: string, err?: unknown): void {
    const list = this.get<Status["recentFailures"]>("failures", []);
    list.unshift({
      kind: task.kind,
      what: describeTask(task.kind, task.payload),
      error: friendlyError(err ?? new Error(message)),
      detail: message.slice(0, 300),
    });
    this.set("failures", list.slice(0, 25));
  }

  private token(): string | null {
    return this.get<string | null>("token", null) || this.env.COMPANYCAM_API_TOKEN || null;
  }

  /** Origin of the token in use. */
  private tokenSource(): "env" | "stored" | "none" {
    if (this.get<string | null>("token", null)) return "stored";
    return this.env.COMPANYCAM_API_TOKEN ? "env" : "none";
  }

  /** Validates a token against the API, then stores it. */
  async setToken(raw: string): Promise<{ ok: boolean; message: string }> {
    const token = (raw ?? "").trim();
    if (!token) return { ok: false, message: "Paste your CompanyCam API token first." };

    const budget = new Budget(8, 30_000);
    const gap = Number(this.env.MIN_REQUEST_MS);
    const throttle = new Throttle(Number.isFinite(gap) && gap > 0 ? gap : 0);
    const api = new CompanyCam(token, budget, this.env.API_BASE || undefined, throttle);
    let who = "";
    try {
      const env = await api.get<any>("/public_api/v1/companies/current");
      who = String(env.data?.name ?? "");
    } catch (e) {
      if (e instanceof ApiError && e.fatal) {
        return { ok: false, message: friendlyError(e) };
      }
      try {
        const env = await api.get<any>("/public_api/v1/users/current");
        who = [env.data?.first_name, env.data?.last_name].filter(Boolean).join(" ");
      } catch (e2) {
        return { ok: false, message: friendlyError(e2) };
      }
    }

    this.set("token", token);
    this.set("company", who);
    this.set("error", null);
    if (this.get<JobState>("state", "idle") === "error") this.set("state", "idle");
    return {
      ok: true,
      message: who ? `Connected to ${who}. You can start the backup.` : "Token accepted. You can start the backup.",
    };
  }

  /** Removes the stored token. */
  async clearToken(): Promise<void> {
    this.sql.exec("DELETE FROM meta WHERE k IN ('token','company')");
  }

  /** Work window for one tick. */
  private tickMs(): number {
    const override = Number(this.env.TICK_SECONDS);
    if (Number.isFinite(override) && override > 0) return Math.min(600, override) * 1000;
    return this.subrequestBudget() <= 100 ? TICK_MS_FREE : TICK_MS;
  }

  /** Subrequests attempted per tick, lowered to whatever the runtime allows. */
  private subrequestBudget(): number {
    const override = Number(this.env.MAX_SUBREQUESTS);
    if (Number.isFinite(override) && override > 0) return Math.floor(override);
    return this.get<number>("subrequestCeiling", DEFAULT_SUBREQUESTS);
  }

  /** Records the ceiling observed when the runtime refused a subrequest. */
  private learnCeiling(used: number): void {
    const learned = Math.max(MIN_SUBREQUESTS, used - 2);
    if (learned < this.subrequestBudget()) this.set("subrequestCeiling", learned);
  }

  /** Watchdog alarm delay. */
  private watchdogMs(): number {
    return this.tickMs() + WATCHDOG_SLACK_MS;
  }

  private get shardCount(): number {
    const n = Number(this.env.SHARDS ?? DEFAULT_SHARDS);
    return Number.isFinite(n) && n >= 1 ? Math.min(32, Math.floor(n)) : DEFAULT_SHARDS;
  }

  private shard(n: number) {
    return this.env.BACKUP_JOB.get(this.env.BACKUP_JOB.idFromName(`shard-${n}`));
  }

  private isCoordinator(): boolean {
    return this.get<boolean>("coordinator", false);
  }

  private async ensureAlarm(delayMs = 100): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + delayMs);
    }
  }

  private async eachShard<T>(fn: (stub: ReturnType<BackupJob["shard"]>) => Promise<T>): Promise<T[]> {
    return Promise.all(
      Array.from({ length: this.shardCount }, (_, i) => fn(this.shard(i))),
    );
  }

  /** Adds projects to this shard's queue. */
  async acceptProjects(
    items: Array<{ id: string; name: string; stamp: string; seq?: number }>,
    token: string,
  ): Promise<void> {
    if (token) this.set("token", token);
    for (const p of items) {
      this.enqueue("project", { id: p.id, name: p.name, stamp: p.stamp }, 2);
      this.projTouch(String(p.id), String(p.name ?? ""));
      if (typeof p.seq === "number") {
        this.sql.exec("UPDATE proj SET seq = ? WHERE id = ?", p.seq, String(p.id));
      }
    }
    if (this.get<JobState>("state", "idle") !== "running") {
      this.set("state", "running");
      this.set("error", null);
      if (!this.get<number | null>("startedAt", null)) this.set("startedAt", Date.now());
    }
    await this.ensureAlarm();
  }

  async shardStatus(): Promise<ShardSnapshot> {
    return {
      grid: await this.shardGrid(),
      skipped: this.get<Record<string, string>>("skipped", {}),
      pending: this.count("pending"),
      running: this.count("running"),
      failed: this.count("failed"),
      state: this.get<JobState>("state", "idle"),
      error: this.get<string | null>("error", null),
      counters: this.get<Record<string, number>>("counters", {}),
      failures: this.get("failures", []),
    };
  }

  /** Resumes a shard holding queued work. */
  async shardResume(token: string): Promise<void> {
    if (token) this.set("token", token);
    if (this.count("pending") + this.count("running") === 0) return;
    this.set("state", "running");
    this.set("error", null);
    await this.ensureAlarm();
  }

  async shardPause(): Promise<void> {
    if (this.get<JobState>("state", "idle") === "running") {
      this.set("state", "paused");
      await this.ctx.storage.deleteAlarm();
    }
  }

  async shardRetryFailed(token: string): Promise<void> {
    this.sql.exec("UPDATE task SET status = 'pending', attempts = 0 WHERE status = 'failed'");
    const c = this.get<Record<string, number>>("counters", {});
    this.set("counters", { ...c, tasksFailed: 0 });
    await this.shardResume(token);
  }

  /** Clears per-run counters, leaving the ledger intact. */
  async shardBeginRun(): Promise<void> {
    this.set("counters", {});
    this.set("failures", []);
    this.set("startedAt", Date.now());
    this.set("finishedAt", null);
  }

  async shardReset(clearLedger: boolean): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    this.sql.exec("DELETE FROM task");
    this.sql.exec("DELETE FROM pagebuf");
    if (clearLedger) this.sql.exec("DELETE FROM ledger");
    this.set("counters", {});
    this.set("failures", []);
    this.set("state", "idle");
    this.set("error", null);
    this.set("startedAt", null);
    this.set("finishedAt", null);
  }

  async start(token?: string, full = false): Promise<Status> {
    if (token) this.set("token", token);
    if (!this.token()) throw new Error("No CompanyCam API token configured.");

    const state = this.get<JobState>("state", "idle");
    if (state === "running") return this.status();

    if (state === "error") {
      this.sql.exec("UPDATE task SET status = 'pending', attempts = 0 WHERE status = 'failed'");
      this.set("failures", []);
      const c = this.get<Record<string, number>>("counters", {});
      this.set("counters", { ...c, tasksFailed: 0 });
      await this.eachShard((sh) => sh.shardRetryFailed(token ?? this.token() ?? ""));
    }

    const shardWork = (await this.refreshShards()).reduce(
      (n, snap) => n + snap.pending + snap.running,
      0,
    );
    const pending = this.count("pending") + this.count("running") + shardWork;
    if (pending === 0) {
      if (full) {
        this.sql.exec("DELETE FROM ledger");
        this.sql.exec("DELETE FROM pagebuf");
        await this.eachShard((s) => s.shardReset(true));
      }
      this.sql.exec("DELETE FROM task");
      this.set("counters", {});
      this.set("failures", []);
      this.set("startedAt", Date.now());
      this.set("finishedAt", null);
      await this.eachShard((sh) => sh.shardBeginRun());
      this.set("shardSnapshot", []);
      this.set("phase", "export");
      this.seed();
    }

    this.set("coordinator", true);
    this.set("state", "running");
    this.set("error", null);
    this.set("message", "Starting…");
    const tok = this.token() ?? "";
    await this.eachShard((s) => s.shardResume(tok));
    await this.ctx.storage.setAlarm(Date.now() + 100);
    return this.status();
  }

  private seed(): void {
    for (const r of ACCOUNT_RESOURCES) {
      this.enqueue("coll", { scope: "_account", file: r.file, path: r.path, single: r.single, seq: 0 }, 0);
    }
    this.set("discoveryPending", 2);
    this.set("wavesSent", 0);
    this.set("projectsSent", 0);
    this.set("waveNewest", "");
    this.set("waveOldest", "");
    this.sql.exec("DELETE FROM wave");
    this.enqueue("projects_page", { archived: false, seq: 0 }, 1);
    this.enqueue("projects_page", { archived: true, seq: 0 }, 1);
  }

  async pause(): Promise<Status> {
    if (this.get<JobState>("state", "idle") === "running") {
      this.set("state", "paused");
      this.set("message", "Paused.");
      await this.ctx.storage.deleteAlarm();
    }
    await this.eachShard((s) => s.shardPause());
    await this.refreshShards();
    return this.status();
  }

  async reset(): Promise<Status> {
    await this.eachShard((s) => s.shardReset(true));
    this.set("shardSnapshot", []);
    await this.ctx.storage.deleteAlarm();
    this.sql.exec("DELETE FROM task");
    this.sql.exec("DELETE FROM pagebuf");
    this.sql.exec("DELETE FROM ledger");
    this.set("counters", {});
    this.set("failures", []);
    this.set("state", "idle");
    this.set("error", null);
    this.set("message", "Reset. The bucket was left untouched.");
    this.set("startedAt", null);
    this.set("finishedAt", null);
    this.sql.exec("DELETE FROM meta WHERE k = 'token'");
    return this.status();
  }

  /** Requeues tasks that ran out of attempts. */
  async retryFailed(): Promise<Status> {
    this.sql.exec("UPDATE task SET status = 'pending', attempts = 0 WHERE status = 'failed'");
    this.set("counters", { ...this.get<Record<string, number>>("counters", {}), tasksFailed: 0 });
    await this.eachShard((s) => s.shardRetryFailed(this.token() ?? ""));
    return this.start();
  }

  private count(status: string): number {
    const row = this.sql
      .exec("SELECT COUNT(*) AS n FROM task WHERE status = ?", status)
      .toArray()[0] as { n: number };
    return Number(row?.n ?? 0);
  }

  /** Caches each shard's progress. */
  private async refreshShards(): Promise<ShardSnapshot[]> {
    const snaps = await this.eachShard((s) => s.shardStatus());
    this.set("shardSnapshot", snaps);
    return snaps;
  }

  /** Project names in grid order. */
  async projectNames(): Promise<string[]> {
    const total = this.waveCounts().total;
    const out = new Array<string>(Math.max(total, 0)).fill("");
    const lists = await this.eachShard((sh) => sh.shardNames());
    for (const list of lists) {
      for (const pair of list) {
        const seq = Number(pair[0]);
        if (Number.isInteger(seq) && seq >= 0 && seq < out.length) out[seq] = String(pair[1]);
      }
    }
    return out;
  }

  async status(): Promise<Status> {
    const snaps = this.get<ShardSnapshot[]>("shardSnapshot", []);
    const own = this.get<Record<string, number>>("counters", {});

    const counters: Record<string, number> = { ...own };
    let pending = this.count("pending");
    let running = this.count("running");
    let failed = this.count("failed");
    let done = own.tasksDone ?? 0;
    const failures = [...this.get<Status["recentFailures"]>("failures", [])];
    const skipped: Record<string, string> = { ...this.get<Record<string, string>>("skipped", {}) };
    let shardError: string | null = null;

    for (const snap of snaps) {
      pending += snap.pending;
      running += snap.running;
      failed += snap.failed;
      done += snap.counters?.tasksDone ?? 0;
      for (const [k, v] of Object.entries(snap.counters ?? {})) {
        if (k === "tasksDone") continue;
        counters[k] = (counters[k] ?? 0) + (v as number);
      }
      if (snap.error && !shardError) shardError = snap.error;
      for (const f of snap.failures ?? []) failures.push(f);
      for (const [k, v] of Object.entries(snap.skipped ?? {})) skipped[k] = v;
    }
    counters.tasksDone = done;
    const wave = this.waveCounts();
    const cells = new Array<string>(Math.max(wave.total, 0)).fill(".");
    for (const snap of snaps) {
      for (const part of (snap.grid ?? "").split(",")) {
        if (!part) continue;
        const idx = parseInt(part.slice(0, -1), 36);
        if (Number.isFinite(idx) && idx >= 0 && idx < cells.length) cells[idx] = part.slice(-1);
      }
    }
    const grid = cells.join("");

    return {
      state: this.get<JobState>("state", "idle"),
      startedAt: this.get<number | null>("startedAt", null),
      finishedAt: this.get<number | null>("finishedAt", null),
      lastTickAt: this.get<number | null>("lastTickAt", null),
      message: this.get<string>("message", ""),
      error: this.get<string | null>("error", null) ?? shardError,
      tasks: { pending, running, done, failed },
      counters,
      hasToken: Boolean(this.token()),
      tokenSource: this.tokenSource(),
      company: this.get<string>("company", ""),
      skipped,
      grid,
      phase: this.get<Status["phase"]>("phase", "export"),
      wave: {
        index: wave.waves,
        total: wave.wavesTotal,
        projectsSent: wave.sent,
        projectsTotal: wave.total,
        newest: this.get<string>("waveNewest", ""),
        oldest: this.get<string>("waveOldest", ""),
      },
      archive: `${this.env.ARCHIVE_BUCKET || DEFAULT_BUCKET}/${this.env.ARCHIVE_PREFIX || DEFAULT_PREFIX}`,
      recentFailures: failures.slice(0, 25),
      shards: snaps.map((s, i) => ({
        id: i,
        pending: s.pending + s.running,
        state: s.state,
      })),
    };
  }

  async alarm(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.get<JobState>("state", "idle") !== "running") return;

    const token = this.token();
    if (!token) {
      this.set("state", "error");
      this.set("error", "No CompanyCam API token configured.");
      return;
    }

    // Requeue tasks left running by an interrupted tick.
    this.sql.exec("UPDATE task SET status = 'pending' WHERE status = 'running'");
    this.set("lastTickAt", Date.now());

    // Armed before any work so a killed invocation still resumes.
    await this.ctx.storage.setAlarm(Date.now() + this.watchdogMs());

    const tickMs = this.tickMs();
    const budget = new Budget(this.subrequestBudget(), tickMs);
    const doneBefore = this.get<Record<string, number>>("counters", {}).tasksDone ?? 0;
    const gap = Number(this.env.MIN_REQUEST_MS);
    const throttle = new Throttle(Number.isFinite(gap) && gap > 0 ? gap : 0);
    const api = new CompanyCam(token, budget, this.env.API_BASE || undefined, throttle);
    const store = new Store(this.env.ARCHIVE, this.env.ARCHIVE_PREFIX || DEFAULT_PREFIX, budget);

    try {
      for (;;) {
        const slots = Math.min(CONCURRENCY, Math.floor(budget.remaining / RESERVE_PER_TASK));
        if (slots < 1 || !budget.timeLeft) break;
        const batch = this.claim(slots);
        if (batch.length === 0) break;
        await Promise.all(batch.map((t) => this.run(t, api, store, budget, throttle)));
        if (this.get<JobState>("state", "running") !== "running") break;
      }
    } catch (e) {
      if (!(e instanceof BudgetExhausted)) {
        this.set("state", "error");
        this.set("error", e instanceof Error ? e.message : String(e));
      }
    }

    this.sql.exec("UPDATE task SET status = 'pending' WHERE status = 'running'");

    const state = this.get<JobState>("state", "running");
    if (state !== "running") return;

    const remaining = this.count("pending");

    if (!this.isCoordinator()) {
      if (remaining > 0) {
        this.guardAgainstStall(doneBefore);
        await this.ctx.storage.setAlarm(Date.now() + 1000);
      } else {
        this.set("state", "done");
        this.set("finishedAt", Date.now());
        await this.ctx.storage.deleteAlarm();
      }
      return;
    }

    const snaps = await this.refreshShards();
    const shardWork = snaps.reduce((n, s) => n + s.pending + s.running, 0);
    const discovering = this.get<number>("discoveryPending", 0) > 0;
    const phase = this.get<Status["phase"]>("phase", "export");

    if (!discovering && phase === "export" && shardWork === 0 && remaining === 0) {
      const sent = await this.dispatchWave(budget);
      if (sent > 0) {
        this.set("message", this.waveMessage());
        await this.ctx.storage.setAlarm(Date.now() + 500);
        return;
      }
    }

    if (remaining > 0 || shardWork > 0) {
      if (remaining > 0) this.guardAgainstStall(doneBefore);
      this.set("message", discovering ? this.discoveryMessage() : this.waveMessage());
      await this.ctx.storage.setAlarm(Date.now() + (remaining > 0 ? 1000 : 3000));
    } else if (phase === "export") {
      this.set("phase", "verify");
      this.set("message", "Checking every job against your storage…");
      const tok = this.token() ?? "";
      const counts = await this.eachShard((sh) => sh.shardVerify(tok));
      const n = counts.reduce((a, b) => a + b, 0);
      if (n === 0) {
        await this.complete(store);
      } else {
        await this.ctx.storage.setAlarm(Date.now() + 1000);
      }
    } else {
      await this.complete(store);
    }
  }

  /** Fails a task that cannot complete within one tick's budget. */
  private guardAgainstStall(doneBefore: number): void {
    const doneNow = this.get<Record<string, number>>("counters", {}).tasksDone ?? 0;
    if (doneNow > doneBefore) {
      this.set("stalledTicks", 0);
      return;
    }
    const stalled = this.get<number>("stalledTicks", 0) + 1;
    this.set("stalledTicks", stalled);
    if (stalled < 3) return;

    const row = this.sql
      .exec("SELECT id, kind, payload, attempts FROM task WHERE status = 'pending' ORDER BY prio, id LIMIT 1")
      .toArray()[0] as { id: number; kind: string; payload: string; attempts: number } | undefined;
    if (row) {
      this.fail(
        { id: row.id, kind: row.kind, payload: JSON.parse(row.payload), attempts: MAX_ATTEMPTS },
        new Error(
          "This item needs more requests than one invocation allows. On the Workers Free plan, the Paid plan will let it through.",
        ),
      );
    }
    this.set("stalledTicks", 0);
  }

  private discoveryMessage(): string {
    const n = this.waveCounts().total;
    return n > 0 ? `Finding your jobs — ${n.toLocaleString()} so far…` : "Finding your jobs…";
  }

  private waveMessage(): string {
    const w = this.waveCounts();
    const c = this.get<Record<string, number>>("counters", {});
    const done = Math.max(0, w.sent - 0);
    const month = (iso: string) => {
      const d = new Date(iso);
      return Number.isFinite(d.getTime())
        ? d.toLocaleDateString(undefined, { month: "short", year: "numeric" })
        : "";
    };
    const from = month(this.get<string>("waveNewest", ""));
    const to = month(this.get<string>("waveOldest", ""));
    const range = from && to ? (from === to ? ` (${from})` : ` (${to} – ${from})`) : "";
    void c;
    void done;
    return `Copying your newest jobs first — batch ${w.waves} of ${w.wavesTotal}${range}.`;
  }

  private async complete(store: Store): Promise<void> {
    this.set("state", "done");
    this.set("finishedAt", Date.now());
    await this.ctx.storage.deleteAlarm();
    const summary = await this.status();
    const failed = summary.tasks.failed;
    this.set("phase", "done");
    const ok = summary.counters.projectsVerified ?? 0;
    const bad = summary.counters.projectsUnverified ?? 0;
    this.set(
      "message",
      failed > 0 && bad > 0
        ? `${plural(failed, "item")} could not be copied, and ${plural(bad, "job")} did not match your storage. Press Start again.`
        : failed > 0
          ? `${plural(failed, "item")} could not be copied. Press Retry failed to try again.`
          : bad > 0
            ? `${plural(bad, "job")} did not match your storage and will be re-fetched. Press Start again.`
            : `All ${plural(ok, "job")} copied and checked against your storage.`,
    );
    try {
      await store.putJson("_report.json", {
        finished_at: new Date().toISOString(),
        started_at: new Date(this.get<number>("startedAt", Date.now())).toISOString(),
        counters: summary.counters,
        failed_tasks: failed,
        recent_failures: summary.recentFailures,
        shards: this.shardCount,
        skipped_resources: summary.skipped,
        verification: {
          projects_verified: summary.counters.projectsVerified ?? 0,
          projects_failed_verification: summary.counters.projectsUnverified ?? 0,
        },
      });
    } catch {
    }
  }

  private async run(task: Task, api: CompanyCam, store: Store, budget: Budget, throttle: Throttle): Promise<void> {
    try {
      switch (task.kind) {
        case "coll":
          await this.doCollection(task, api, store);
          break;
        case "projects_page":
          await this.doProjectsPage(task, api, store, budget);
          break;
        case "project":
          await this.doProject(task, api, store);
          break;
        case "checklist":
          await this.doChecklist(task, api, store);
          break;
        case "asset":
          await this.doAsset(task, store, budget, throttle);
          break;
        case "verify":
          await this.doVerify(task, store);
          break;
        default:
          throw new Error(`unknown task kind: ${task.kind}`);
      }
      this.finish(task);
    } catch (e) {
      if (e instanceof BudgetExhausted) {
        this.requeue(task.id);
        return;
      }
      if (isSubrequestLimit(e)) {
        this.requeue(task.id);
        this.learnCeiling(budget.used);
        throw new BudgetExhausted("subrequests");
      }
      this.fail(task, e);
    }
  }

  /** One page of a collection endpoint. */
  private async doCollection(task: Task, api: CompanyCam, store: Store): Promise<void> {
    const { scope, file, path, single, cursor, seq = 0, pid } = task.payload;
    const bufScope = `${scope}/${file}`;

    if (single) {
      try {
        const env = await api.get<unknown>(path);
        await store.putJson(`${scope}/${file}.json`, env.data);
      } catch (e) {
        if (e instanceof ApiError && e.skippable) return this.noteSkipped(file, e);
        throw e;
      }
      return;
    }

    let page;
    try {
      const env = await api.get<any[]>(path, { limit: "100", after: cursor });
      page = {
        items: Array.isArray(env.data) ? env.data : [],
        next: env.meta?.has_next ? (env.meta.next_cursor ?? null) : null,
      };
    } catch (e) {
      if (e instanceof ApiError && e.skippable) return this.noteSkipped(file, e);
      throw e;
    }

    this.sql.exec(
      "INSERT INTO pagebuf (scope, seq, body) VALUES (?, ?, ?) ON CONFLICT(scope, seq) DO UPDATE SET body = excluded.body",
      bufScope,
      seq,
      JSON.stringify(page.items),
    );

    if (pid && scope) this.queueAssets(file, scope, page.items, String(pid));

    if (page.next) {
      this.enqueue("coll", { ...task.payload, cursor: page.next, seq: seq + 1 }, pid ? 2 : 0);
    } else {
      const all = this.readBuffer(bufScope);
      await store.putJson(`${scope}/${file}.json`, all);
      this.clearBuffer(bufScope);
      this.bump(file, all.length);
      if (file === "checklists" && pid) {
        for (const cl of all) {
          if (cl?.id) this.enqueue("checklist", { scope, pid, cid: cl.id }, 3);
        }
      }
    }
  }

  private queueAssets(file: string, scope: string, items: any[], pid: string): void {
    for (const item of items) {
      let files: Array<{ url: string; suffix: string }> = [];
      let dir: string;
      if (file === "photos") {
        files = photoFiles(item);
        dir = "photos";
      } else if (file === "videos") {
        const u = videoUrl(item);
        files = u ? [{ url: u, suffix: "" }] : [];
        dir = "videos";
      } else if (file === "documents") {
        const u = documentUrl(item);
        files = u ? [{ url: u, suffix: "" }] : [];
        dir = "documents";
      } else {
        continue;
      }
      if (files.length === 0 || !item?.id) continue;

      const name =
        file === "documents" && item.name
          ? `${item.id}-${String(item.name).replace(/[^\w.\- ]+/g, "_").slice(0, 80)}`
          : String(item.id);
      for (const f of files) {
        this.enqueue(
          "asset",
          {
            url: f.url,
            keyBase: `${scope}/${dir}/${name}${f.suffix}`,
            stamp: String(item.updated_at ?? item.created_at ?? ""),
            kind: file,
            pid,
          },
          5,
        );
      }
    }
  }

  private readBuffer(bufScope: string): any[] {
    const rows = this.sql
      .exec("SELECT body FROM pagebuf WHERE scope = ? ORDER BY seq", bufScope)
      .toArray() as Array<{ body: string }>;
    const out: any[] = [];
    for (const r of rows) {
      for (const item of JSON.parse(r.body) as any[]) out.push(item);
    }
    return out;
  }

  private clearBuffer(bufScope: string): void {
    this.sql.exec("DELETE FROM pagebuf WHERE scope = ?", bufScope);
  }

  private async doProjectsPage(
    task: Task,
    api: CompanyCam,
    store: Store,
    budget: Budget,
  ): Promise<void> {
    const { archived, cursor, seq = 0 } = task.payload;
    const env = await api.get<any[]>("/public_api/v1/projects", {
      limit: "100",
      after: cursor,
      archived: archived ? "true" : undefined,
    });
    const items = Array.isArray(env.data) ? env.data : [];
    const next = env.meta?.has_next ? (env.meta.next_cursor ?? null) : null;
    const bufScope = `_index/projects-${archived ? "archived" : "active"}`;

    this.sql.exec(
      "INSERT INTO pagebuf (scope, seq, body) VALUES (?, ?, ?) ON CONFLICT(scope, seq) DO UPDATE SET body = excluded.body",
      bufScope,
      seq,
      JSON.stringify(items),
    );

    for (const p of items) {
      if (!p?.id) continue;
      this.sql.exec(
        "INSERT OR IGNORE INTO wave (id, name, stamp) VALUES (?, ?, ?)",
        String(p.id),
        String(p.name ?? ""),
        String(p.updated_at ?? p.created_at ?? ""),
      );
    }

    if (next) {
      this.enqueue("projects_page", { archived, cursor: next, seq: seq + 1 }, 1);
    } else {
      const all = this.readBuffer(bufScope);
      await store.putJson(`_index/projects-${archived ? "archived" : "active"}.json`, all);
      this.clearBuffer(bufScope);
      this.set("discoveryPending", Math.max(0, this.get<number>("discoveryPending", 2) - 1));
    }
  }

  private async doProject(task: Task, api: CompanyCam, store: Store): Promise<void> {
    const { id, name, stamp } = task.payload;
    const dir = projectDir(id, name);
    this.projTouch(String(id), String(name ?? ""), dir);

    const seen = this.sql
      .exec("SELECT stamp FROM ledger WHERE key = ?", `project:${id}`)
      .toArray()[0] as { stamp: string } | undefined;
    if (seen && stamp && seen.stamp === stamp) {
      this.bump("projectsSkipped");
      return;
    }

    this.sql.exec(
      "UPDATE proj SET assets = 0, stored = 0, failed = 0, verified = -1, note = NULL WHERE id = ?",
      String(id),
    );

    const env = await api.get<any>(`/public_api/v1/projects/${id}`);
    await store.putJson(`${dir}/project.json`, env.data);

    for (const r of PROJECT_RESOURCES) {
      this.enqueue(
        "coll",
        {
          scope: dir,
          pid: id,
          file: r.file,
          path: r.path.replace("{id}", id),
          single: r.single,
          seq: 0,
        },
        2,
      );
    }

    this.sql.exec(
      "INSERT INTO ledger (key, stamp, size, at) VALUES (?, ?, NULL, ?) ON CONFLICT(key) DO UPDATE SET stamp = excluded.stamp, at = excluded.at",
      `project:${id}`,
      stamp,
      Date.now(),
    );
    this.bump("projects");
  }

  private async doChecklist(task: Task, api: CompanyCam, store: Store): Promise<void> {
    const { scope, pid, cid } = task.payload;
    const env = await api.get<any>(
      `/public_api/v1/projects/${pid}/conditional_checklists/${cid}`,
    );
    await store.putJson(`${scope}/checklists/${cid}.json`, env.data);
    this.bump("checklistDetails");
  }

  /** Checks a project's stored files against the bucket. */
  private async doVerify(task: Task, store: Store): Promise<void> {
    const { pid } = task.payload;
    const row = this.sql
      .exec("SELECT dir, assets, failed FROM proj WHERE id = ?", String(pid))
      .toArray()[0] as { dir: string; assets: number; failed: number } | undefined;
    if (!row || !row.dir) return;

    const found = await store.audit(row.dir);
    const expected = Number(row.assets) - Number(row.failed);
    const ok = found.hasProjectJson && found.assets >= expected;
    const note = ok
      ? null
      : !found.hasProjectJson
        ? "project.json is missing from the bucket"
        : `expected ${expected} files, found ${found.assets}`;

    this.sql.exec("UPDATE proj SET verified = ?, note = ? WHERE id = ?", ok ? 1 : 0, note, String(pid));
    this.bump(ok ? "projectsVerified" : "projectsUnverified");
    if (!ok) {
      this.sql.exec("DELETE FROM ledger WHERE key = ? OR key LIKE ?", `project:${pid}`, `${row.dir}/%`);
      this.recordFailure(
        { id: 0, kind: "verify", payload: { pid, dir: row.dir }, attempts: 0 },
        `verify ${row.dir}: ${note}`,
        new Error(`Does not match the bucket - ${note}. It will be re-fetched on the next run.`),
      );
    }
  }

  /** Dispatches the next wave, newest first. Returns how many were sent. */
  private async dispatchWave(budget: Budget): Promise<number> {
    const sentSoFar = this.get<number>("projectsSent", 0);
    const cap = this.maxProjects;
    const room = cap === null ? this.waveSize : Math.min(this.waveSize, cap - sentSoFar);
    if (room <= 0) return 0;

    const rows = this.sql
      .exec(
        "SELECT id, name, stamp FROM wave WHERE sent = 0 ORDER BY stamp DESC, id DESC LIMIT ?",
        room,
      )
      .toArray() as Array<{ id: string; name: string; stamp: string }>;
    if (rows.length === 0) return 0;
    const count = this.shardCount;
    const groups = new Map<number, Array<{ id: string; name: string; stamp: string; seq: number }>>();
    rows.forEach((r, i) => {
      const n = shardFor(String(r.id), count);
      let list = groups.get(n);
      if (!list) groups.set(n, (list = []));
      list.push({ id: String(r.id), name: r.name, stamp: r.stamp, seq: sentSoFar + i });
    });

    const tok = this.token() ?? "";
    await Promise.all(
      [...groups].map(async ([n, list]) => {
        budget.spend();
        await this.shard(n).acceptProjects(list, tok);
      }),
    );
    for (const r of rows) this.sql.exec("UPDATE wave SET sent = 1 WHERE id = ?", r.id);

    this.set("projectsSent", sentSoFar + rows.length);
    this.set("wavesSent", this.get<number>("wavesSent", 0) + 1);
    this.set("waveNewest", rows[0]?.stamp ?? "");
    this.set("waveOldest", rows[rows.length - 1]?.stamp ?? "");
    return rows.length;
  }

  /** Optional cap on projects per run. */
  private get maxProjects(): number | null {
    const n = Number(this.env.MAX_PROJECTS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }

  private get waveSize(): number {
    const n = Number(this.env.WAVE_SIZE);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : WAVE_SIZE;
  }

  private waveCounts(): { total: number; sent: number; waves: number; wavesTotal: number } {
    const t = this.sql.exec("SELECT COUNT(*) AS n FROM wave").toArray()[0] as { n: number };
    const cap = this.maxProjects;
    const total = cap === null ? Number(t?.n ?? 0) : Math.min(Number(t?.n ?? 0), cap);
    const sent = this.get<number>("projectsSent", 0);
    return {
      total,
      sent,
      waves: this.get<number>("wavesSent", 0),
      wavesTotal: Math.max(1, Math.ceil(total / this.waveSize)),
    };
  }

  /** Queues verification for this shard's projects. */
  async shardVerify(token: string): Promise<number> {
    if (token) this.set("token", token);
    const rows = this.sql.exec("SELECT id FROM proj").toArray() as Array<{ id: string }>;
    for (const r of rows) this.enqueue("verify", { pid: String(r.id) }, 7);
    if (rows.length > 0) {
      this.set("state", "running");
      await this.ensureAlarm();
    }
    return rows.length;
  }

  /** Grid position to project name. */
  async shardNames(): Promise<Array<[number, string]>> {
    const rows = this.sql
      .exec("SELECT seq, name FROM proj ORDER BY seq")
      .toArray() as Array<{ seq: number; name: string }>;
    return rows.map((r) => [Number(r.seq), String(r.name ?? "")]);
  }

  /** One character per project for the progress grid. */
  async shardGrid(): Promise<string> {
    const rows = this.sql
      .exec("SELECT seq, pending, assets, stored, failed, verified FROM proj ORDER BY seq")
      .toArray() as Array<{ seq: number; pending: number; assets: number; stored: number; failed: number; verified: number }>;
    const parts: string[] = [];
    for (const r of rows) {
      let out = "";
      if (r.verified === 0) out += "X";
      else if (r.verified === 1) out += "V";
      else if (r.failed > 0 && r.pending === 0) out += "X";
      else if (r.pending === 0) out += "D";
      else if (r.assets > 0 && r.stored > 0) {
        const pctDone = Math.min(9, Math.max(1, Math.round((r.stored / r.assets) * 9)));
        out += String(pctDone);
      } else out += r.stored > 0 || r.assets > 0 ? "1" : ".";
      parts.push(Number(r.seq).toString(36) + out);
    }
    return parts.join(",");
  }

  private async doAsset(task: Task, store: Store, budget: Budget, throttle?: Throttle): Promise<void> {
    const { url, keyBase, stamp, kind } = task.payload;

    const seen = this.sql
      .exec("SELECT stamp FROM ledger WHERE key = ?", keyBase)
      .toArray()[0] as { stamp: string } | undefined;
    if (seen && seen.stamp === stamp) {
      this.bump("assetsSkipped");
      if (task.payload.pid) this.projAdd(String(task.payload.pid), "stored", 1);
      return;
    }

    budget.spend();
    if (throttle) await throttle.wait();
    // Pre-signed CDN URL: no Authorization header.
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      if (res.status === 404 || res.status === 410) {
        this.bump("assetsMissing");
        if (task.payload.pid) this.projAdd(String(task.payload.pid), "failed", 1);
        return;
      }
      throw new Error(`asset ${res.status} for ${keyBase}`);
    }

    const ext = extFor(url, res.headers.get("content-type"));
    const key = keyBase.endsWith(ext) ? keyBase : `${keyBase}${ext}`;
    const out = await store.putRemote(key, res);

    this.sql.exec(
      "INSERT INTO ledger (key, stamp, size, at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET stamp = excluded.stamp, size = excluded.size, at = excluded.at",
      keyBase,
      stamp,
      out?.size ?? null,
      Date.now(),
    );
    this.bump(kind === "photos" ? "photosDownloaded" : kind === "videos" ? "videosDownloaded" : "documentsDownloaded");
    if (out?.size) this.bump("bytes", out.size);
    if (task.payload.pid) this.projAdd(String(task.payload.pid), "stored", 1);
  }
}
