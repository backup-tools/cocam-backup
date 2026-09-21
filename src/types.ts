export interface Env {
  ARCHIVE: R2Bucket;
  BACKUP_JOB: DurableObjectNamespace<import("./do").BackupJob>;
  /** Key prefix inside the bucket. Defaults to "cocam". */
  ARCHIVE_PREFIX?: string;
  /** Bucket name, for display only. */
  ARCHIVE_BUCKET?: string;
  /** Shards to spread projects across. Default 8. */
  SHARDS?: string;
  /** Override the per-tick subrequest budget. Normally learned automatically. */
  MAX_SUBREQUESTS?: string;
  /** Seconds of work per tick. Default 300. */
  TICK_SECONDS?: string;
  /** Projects per wave. Default 200. */
  WAVE_SIZE?: string;
  /** Cap on projects per run. Unset means all. */
  MAX_PROJECTS?: string;
  /** Minimum milliseconds between requests per shard. 0 disables. */
  MIN_REQUEST_MS?: string;
  COMPANYCAM_API_TOKEN?: string;
  DASHBOARD_PASSWORD?: string;
  /** API origin override, for testing. */
  API_BASE?: string;
}

/** Response envelope used by every endpoint. */
export interface Envelope<T = unknown> {
  data: T;
  errors: Array<{ code: string; message: string }>;
  meta: {
    next_cursor?: string | null;
    prev_cursor?: string | null;
    has_next?: boolean;
    has_prev?: boolean;
    total?: number;
  };
}

export type JobState = "idle" | "running" | "paused" | "done" | "error";

export interface Status {
  state: JobState;
  startedAt: number | null;
  finishedAt: number | null;
  lastTickAt: number | null;
  message: string;
  error: string | null;
  tasks: { pending: number; running: number; done: number; failed: number };
  counters: Record<string, number>;
  hasToken: boolean;
  recentFailures: Array<{ kind: string; what: string; error: string; detail: string }>;
  /** Whether the token came from config, the page, or is absent. */
  tokenSource: "env" | "stored" | "none";
  company: string;
  archive: string;
  /** Resources that could not be read, with the reason. */
  skipped: Record<string, string>;
  /** One character per project: "." queued, 1-9 copying, D copied, V verified, X problem. */
  grid: string;
  phase: "export" | "verify" | "done";
  wave: {
    index: number;
    total: number;
    projectsSent: number;
    projectsTotal: number;
    newest: string;
    oldest: string;
  };
  shards?: Array<{ id: number; pending: number; state: JobState }>;
}

/** An asset queued for download. */
export interface AssetJob {
  url: string;
  key: string;
  stamp: string;
  contentType?: string;
}
