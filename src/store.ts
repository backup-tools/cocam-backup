import type { Budget } from "./budget";

/** Size above which uploads switch to multipart. */
const MULTIPART_THRESHOLD = 90 * 1024 * 1024;
const PART_SIZE = 16 * 1024 * 1024;

export function slug(input: string, max = 60): string {
  const s = (input || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .slice(0, max)
    .replace(/^-|-$/g, "");
  return s || "untitled";
}

/** Folder name for a project. */
export function projectDir(id: string, name: string): string {
  return `projects/${id}-${slug(name)}`;
}

/** File extension from a URL or content type. */
export function extFor(url: string, contentType?: string | null): string {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\.([a-z0-9]{2,5})$/i);
    if (m) return `.${m[1].toLowerCase()}`;
  } catch {
  }
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/heic": ".heic",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "text/plain": ".txt",
  };
  return map[ct] ?? "";
}

export class Store {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly prefix: string,
    private readonly budget: Budget,
  ) {}

  private full(key: string): string {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  /** Writes a JSON document. */
  async putJson(key: string, value: unknown): Promise<void> {
    this.budget.spend();
    await this.bucket.put(this.full(key), JSON.stringify(value, null, 2), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
  }

  /** Streams a remote asset into R2. Returns bytes stored. */
  async putRemote(
    key: string,
    res: Response,
  ): Promise<{ size: number | null } | null> {
    const fullKey = this.full(key);
    const contentType = res.headers.get("content-type") ?? undefined;
    const lengthHeader = res.headers.get("content-length");
    const length = lengthHeader ? Number(lengthHeader) : NaN;
    const httpMetadata: R2HTTPMetadata = contentType ? { contentType } : {};

    if (!res.body) {
      this.budget.spend();
      await this.bucket.put(fullKey, new ArrayBuffer(0), { httpMetadata });
      return { size: 0 };
    }

    if (Number.isFinite(length) && length > MULTIPART_THRESHOLD) {
      return { size: await this.putMultipart(fullKey, res.body, httpMetadata) };
    }

    this.budget.spend();
    const written = await this.bucket.put(fullKey, res.body, { httpMetadata });
    return { size: written?.size ?? (Number.isFinite(length) ? length : null) };
  }

  /** Counts the objects stored under a project folder. */
  async audit(dir: string): Promise<{ objects: number; assets: number; hasProjectJson: boolean }> {
    const base = this.full(dir);
    let cursor: string | undefined;
    let objects = 0;
    let assets = 0;
    let hasProjectJson = false;
    for (;;) {
      this.budget.spend();
      const page = await this.bucket.list({ prefix: `${base}/`, limit: 1000, cursor });
      for (const obj of page.objects) {
        objects++;
        const rest = obj.key.slice(base.length + 1);
        if (rest === "project.json") hasProjectJson = true;
        if (rest.startsWith("photos/") || rest.startsWith("videos/") || rest.startsWith("documents/")) {
          assets++;
        }
      }
      if (!page.truncated) break;
      cursor = page.cursor;
    }
    return { objects, assets, hasProjectJson };
  }

  private async putMultipart(
    fullKey: string,
    body: ReadableStream<Uint8Array>,
    httpMetadata: R2HTTPMetadata,
  ): Promise<number> {
    this.budget.spend();
    const upload = await this.bucket.createMultipartUpload(fullKey, { httpMetadata });
    const parts: R2UploadedPart[] = [];
    const reader = body.getReader();
    let buf = new Uint8Array(0);
    let total = 0;

    const flush = async (chunk: Uint8Array) => {
      this.budget.spend();
      parts.push(await upload.uploadPart(parts.length + 1, chunk));
      total += chunk.byteLength;
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const merged = new Uint8Array(buf.byteLength + value.byteLength);
        merged.set(buf, 0);
        merged.set(value, buf.byteLength);
        buf = merged;
        while (buf.byteLength >= PART_SIZE) {
          await flush(buf.slice(0, PART_SIZE));
          buf = buf.slice(PART_SIZE);
        }
      }
      if (buf.byteLength > 0 || parts.length === 0) await flush(buf);
      this.budget.spend();
      await upload.complete(parts);
      return total;
    } catch (e) {
      await upload.abort().catch(() => {});
      throw e;
    }
  }
}
