import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/**
 * A dev-server-only bridge between `DevLectureFolder` and a directory on disk.
 *
 * It exists for one reason: the File System Access API cannot be driven by
 * Playwright (architecture.md §11), so the browser tests in this container need
 * some other way to reach a prepared lecture folder. It is mounted only by
 * `vite dev`, never by `vite build`, and the client half is behind
 * `import.meta.env.DEV` so it is not in the production bundle either.
 *
 * The root comes from `LECTURE_DEV_ROOT`. Every request path is resolved and
 * checked against that root, so a crafted `path` cannot read outside it.
 */
export const DEV_PREFIX = "/__lecture/";

interface Ctx {
  root: string;
}

function badRequest(res: ServerResponse, code: number, message: string): void {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

function json(res: ServerResponse, body: unknown): void {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

/** Resolve a client-supplied relative path inside the root, or throw. */
function safeJoin(ctx: Ctx, rel: string): string {
  const cleaned = rel.replace(/^\/+/, "");
  const abs = path.resolve(ctx.root, cleaned);
  const root = path.resolve(ctx.root);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("path escapes LECTURE_DEV_ROOT");
  }
  return abs;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function handle(ctx: Ctx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://dev.invalid");
  const op = url.pathname.slice(DEV_PREFIX.length);
  const rel = url.searchParams.get("path") ?? "";

  if (op === "list") {
    const abs = safeJoin(ctx, rel);
    let entries: Array<{ name: string; dir: boolean }>;
    try {
      const dirents = await fs.readdir(abs, { withFileTypes: true });
      entries = dirents.map((d) => ({ name: d.name, dir: d.isDirectory() }));
    } catch {
      entries = [];
    }
    json(res, { entries });
    return;
  }

  if (op === "stat") {
    const abs = safeJoin(ctx, rel);
    try {
      const st = await fs.stat(abs);
      json(res, {
        exists: true,
        dir: st.isDirectory(),
        size: st.size,
        lastModified: Math.floor(st.mtimeMs),
      });
    } catch {
      json(res, { exists: false, dir: false, size: 0, lastModified: 0 });
    }
    return;
  }

  if (op === "read") {
    const abs = safeJoin(ctx, rel);
    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) {
        badRequest(res, 404, "not a file");
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/octet-stream");
      res.setHeader("content-length", String(st.size));
      res.setHeader("cache-control", "no-store");
      createReadStream(abs).pipe(res);
    } catch {
      badRequest(res, 404, "not found");
    }
    return;
  }

  if (op === "append" || op === "writeAtomic") {
    if (req.method !== "POST") {
      badRequest(res, 405, "POST only");
      return;
    }
    const body = JSON.parse(await readBody(req)) as { path?: string; text?: string };
    const abs = safeJoin(ctx, body.path ?? "");
    const text = body.text ?? "";
    await fs.mkdir(path.dirname(abs), { recursive: true });
    if (op === "append") {
      await fs.appendFile(abs, text, "utf8");
    } else {
      const tmp = `${abs}.tmp`;
      await fs.writeFile(tmp, text, "utf8");
      await fs.rename(tmp, abs);
    }
    json(res, { ok: true });
    return;
  }

  badRequest(res, 404, `unknown operation ${op}`);
}

export function devFolderPlugin(): Plugin {
  return {
    name: "lecture-dev-folder",
    apply: "serve",
    configureServer(server) {
      const root = process.env.LECTURE_DEV_ROOT;
      if (!root) {
        server.config.logger.info(
          "lecture-dev-folder: LECTURE_DEV_ROOT is not set, so ?dev will have nothing to read",
        );
        return;
      }
      const ctx: Ctx = { root: path.resolve(root) };
      server.config.logger.info(`lecture-dev-folder: serving ${ctx.root} at ${DEV_PREFIX}`);
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(DEV_PREFIX)) {
          next();
          return;
        }
        handle(ctx, req, res).catch((err: unknown) => {
          badRequest(res, 400, err instanceof Error ? err.message : String(err));
        });
      });
    },
  };
}
