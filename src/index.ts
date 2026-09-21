import { DASHBOARD_HTML } from "./dashboard";
import type { Env } from "./types";

export { BackupJob } from "./do";

const COOKIE = "cce_session";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" || path === "/index.html") {
      return html(DASHBOARD_HTML);
    }

    if (!path.startsWith("/api/")) return new Response("Not found", { status: 404 });

    const password = env.DASHBOARD_PASSWORD;
    if (!password) {
      return json(
        {
          error:
            "DASHBOARD_PASSWORD is not set. Add it as a Worker secret (Settings -> Variables and Secrets) and reload.",
          setup: true,
        },
        503,
      );
    }

    if (path === "/api/login" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { password?: string };
      if (!timingSafeEqual(body.password ?? "", password)) {
        return json({ error: "Incorrect password." }, 401);
      }
      const res = json({ ok: true });
      res.headers.append(
        "Set-Cookie",
        `${COOKIE}=${await sessionToken(password)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`,
      );
      return res;
    }

    if (!(await authorized(request, password))) {
      return json({ error: "Unauthorized", login: true }, 401);
    }

    const job = env.BACKUP_JOB.get(env.BACKUP_JOB.idFromName("singleton"));

    try {
      switch (`${request.method} ${path}`) {
        case "GET /api/status":
          return json(await job.status());
        case "GET /api/projects":
          return json({ names: await job.projectNames() });
        case "POST /api/start": {
          const body = (await request.json().catch(() => ({}))) as {
            token?: string;
            full?: boolean;
          };
          return json(await job.start(body.token?.trim() || undefined, Boolean(body.full)));
        }
        case "POST /api/token": {
          const body = (await request.json().catch(() => ({}))) as { token?: string };
          return json(await job.setToken(body.token ?? ""));
        }
        case "POST /api/forget-token":
          await job.clearToken();
          return json(await job.status());
        case "POST /api/pause":
          return json(await job.pause());
        case "POST /api/retry":
          return json(await job.retryFailed());
        case "POST /api/reset":
          return json(await job.reset());
        default:
          return json({ error: "Not found" }, 404);
      }
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`cocam-backup:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorized(request: Request, password: string): Promise<boolean> {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  if (!match) return false;
  return timingSafeEqual(match[1], await sessionToken(password));
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}
