import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  rmSync,
  createReadStream,
  renameSync,
} from "node:fs";
import { join, resolve, extname, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { PARSER_VERSION } from "./parser/index.ts";
import { ATTRIBUTES, POSITIONS } from "./parser/attributes.ts";
import { searchPlayers, QueryError } from "./storage.ts";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data =
  process.env.FMSCOUT_DATA_DIR ||
  join(process.env.LOCALAPPDATA || join(root, ".cache"), "FMScout24");
const cache = join(data, "snapshots");
mkdirSync(cache, { recursive: true });
const settingsFile = join(data, "settings.json");
const defaultFolder = String.raw`C:\Users\LX\Documents\Sports Interactive\Football Manager 2024\games`;
let settings: { folder: string; lastSnapshot?: string } = { folder: defaultFolder };
try {
  settings = { ...settings, ...JSON.parse(readFileSync(settingsFile, "utf8")) };
} catch {}
function saveSettings() {
  const temp = settingsFile + ".tmp";
  writeFileSync(temp, JSON.stringify(settings, null, 2));
  renameSync(temp, settingsFile);
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
function listSaves() {
  return readdirSync(settings.folder, { withFileTypes: true })
    .filter((d) => d.isFile() && extname(d.name).toLowerCase() === ".fm")
    .map((d) => {
      const path = join(settings.folder, d.name),
        s = statSync(path),
        snapshotId = digest(path + "|" + s.size + "|" + s.mtimeMs + "|" + PARSER_VERSION);
      return {
        id: digest(path),
        name: d.name,
        size: s.size,
        mtime: s.mtimeMs,
        modified: new Date(s.mtimeMs).toISOString(),
        snapshotId,
        cached: existsSync(join(cache, snapshotId + ".sqlite")),
      };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}
function dbPath(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new QueryError("Invalid snapshot.");
  const p = join(cache, id + ".sqlite");
  if (!existsSync(p)) throw new QueryError("This save has not been imported.");
  return p;
}
function withDb<T>(id: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath(id), { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function metadata(id: string) {
  return withDb(id, (db) => {
    const row = db.prepare("SELECT value FROM metadata WHERE key='snapshot'").get() as {
      value: string;
    };
    const m = JSON.parse(row.value);
    try {
      const s = statSync(m.sourcePath);
      m.stale =
        s.size !== m.sourceSize ||
        s.mtimeMs !== m.sourceMtime ||
        m.parserVersion !== PARSER_VERSION;
    } catch {
      m.stale = true;
    }
    return m;
  });
}
type Job = {
  id: string;
  saveId: string;
  snapshotId: string;
  status: "running" | "complete" | "error" | "cancelled";
  progress: number;
  message: string;
  playerCount?: number;
  elapsedMs?: number;
  peakRssBytes?: number;
  startedAt: string;
};
const jobs = new Map<string, Job>();
let active: { job: Job; worker: Worker; temporary: string } | null = null;
function launchImport(saveId: string) {
  if (active)
    throw new QueryError("Another save is already being read. Cancel it or wait for it to finish.");
  const save = listSaves().find((s) => s.id === saveId);
  if (!save)
    throw new QueryError("The selected save is no longer in this folder. Refresh the save list.");
  const id = randomUUID(),
    job: Job = {
      id,
      saveId,
      snapshotId: save.snapshotId,
      status: save.cached ? "complete" : "running",
      progress: save.cached ? 100 : 0,
      message: save.cached ? "Loaded from local cache" : "Starting import",
      startedAt: new Date().toISOString(),
    };
  jobs.set(id, job);
  if (jobs.size > 100) jobs.delete(jobs.keys().next().value!);
  if (save.cached) {
    settings.lastSnapshot = save.snapshotId;
    saveSettings();
    return job;
  }
  const path = join(settings.folder, save.name),
    temporary = join(cache, id + ".partial.sqlite"),
    destination = join(cache, save.snapshotId + ".sqlite");
  const worker = new Worker(new URL("./import-worker.ts", import.meta.url), {
    workerData: {
      file: path,
      temporary,
      destination,
      metadata: {
        snapshotId: save.snapshotId,
        sourcePath: path,
        sourceName: save.name,
        sourceSize: save.size,
        sourceMtime: save.mtime,
        parserVersion: PARSER_VERSION,
      },
    },
  });
  active = { job, worker, temporary };
  const fail = (message: string) => {
    if (job.status === "running") {
      job.status = "error";
      job.message = message;
    }
    if (active?.job.id === id) active = null;
  };
  worker.on("message", (msg) => {
    if (job.status !== "running") return;
    if (msg.type === "progress") {
      job.progress = msg.progress;
      job.message = msg.message;
    }
    if (msg.type === "complete") {
      job.status = "complete";
      job.progress = 100;
      job.message = "Ready";
      job.playerCount = msg.playerCount;
      job.elapsedMs = msg.elapsedMs;
      job.peakRssBytes = msg.peakRssBytes;
      settings.lastSnapshot = save.snapshotId;
      saveSettings();
      if (active?.job.id === id) active = null;
    }
    if (msg.type === "error") fail(msg.message);
  });
  worker.on("error", (e) => fail(e.message));
  worker.on("exit", (code) => {
    if (job.status === "running") fail(`The reader stopped unexpectedly (${code}).`);
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  });
  return job;
}
const port = Number(process.env.FMSCOUT_PORT || 4242);
const allowedOrigins = new Set([`http://127.0.0.1:${port}`, "http://127.0.0.1:5173"]);
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new QueryError("Expected JSON.");
  let s = "";
  for await (const c of req) {
    s += c;
    if (s.length > 65536) throw new QueryError("Request is too large.");
  }
  try {
    const value = JSON.parse(s);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new QueryError("Expected a JSON object.");
  }
}
const server = createServer(async (req, res) => {
  try {
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) {
      json(res, 403, { error: "This app accepts local workspace requests only." });
      return;
    }
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host || "")) {
      json(res, 403, { error: "Invalid host." });
      return;
    }
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`),
      path = url.pathname,
      method = req.method;
    if (path === "/api/health") {
      json(res, 200, { app: "fm24-scout", parserVersion: PARSER_VERSION });
      return;
    }
    if (method === "GET" && path === "/api/settings") {
      json(res, 200, { ...settings, activeJob: active?.job ?? null });
      return;
    }
    if (method === "PUT" && path === "/api/settings") {
      const input = await body(req);
      if (active) throw new QueryError("Wait for the current import before changing folders.");
      try {
        if (
          typeof input.folder !== "string" ||
          input.folder.length > 4096 ||
          !statSync(input.folder).isDirectory()
        )
          throw new Error();
      } catch {
        throw new QueryError("Choose an existing save folder.");
      }
      settings = { folder: resolve(input.folder) };
      saveSettings();
      json(res, 200, settings);
      return;
    }
    if (method === "GET" && path === "/api/saves") {
      json(res, 200, { saves: listSaves() });
      return;
    }
    if (method === "GET" && path === "/api/attributes") {
      json(res, 200, { attributes: ATTRIBUTES, positions: POSITIONS });
      return;
    }
    if (method === "POST" && path === "/api/imports") {
      const input = await body(req);
      json(res, 202, launchImport(input.saveId));
      return;
    }
    const jobMatch = path.match(/^\/api\/imports\/([a-f0-9-]+)$/);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) {
        json(res, 404, { error: "Import not found." });
        return;
      }
      if (method === "GET") {
        json(res, 200, job);
        return;
      }
      if (method === "DELETE") {
        if (active?.job.id === job.id) {
          const current = active;
          job.status = "cancelled";
          job.message = "Import cancelled";
          await current.worker.terminate();
          if (active === current) active = null;
          if (existsSync(current.temporary)) rmSync(current.temporary, { force: true });
        }
        json(res, 200, job);
        return;
      }
    }
    const snapMatch = path.match(/^\/api\/snapshots\/([a-f0-9]{64})(?:\/players(?:\/(\d+))?)?$/);
    if (method === "GET" && snapMatch) {
      const id = snapMatch[1];
      if (!path.includes("/players")) {
        json(res, 200, metadata(id));
        return;
      }
      if (snapMatch[2]) {
        const value = withDb(id, (db) =>
          db.prepare("SELECT detail FROM players WHERE id=?").get(Number(snapMatch[2])),
        );
        if (!value) {
          json(res, 404, { error: "Player not found." });
          return;
        }
        json(res, 200, JSON.parse(String(value.detail)));
        return;
      }
      json(
        res,
        200,
        withDb(id, (db) => searchPlayers(db, url.searchParams)),
      );
      return;
    }
    if (path.startsWith("/api/")) {
      json(res, 404, { error: "Not found." });
      return;
    }
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const publicRoot = join(root, "web", "dist", "client");
    let asset = resolve(publicRoot, "." + decodeURIComponent(path));
    if (!asset.startsWith(publicRoot + sep) && asset !== publicRoot) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (existsSync(asset) && statSync(asset).isDirectory()) asset = join(asset, "index.html");
    if (!existsSync(asset) && !extname(path)) asset = join(publicRoot, "index.html");
    if (!existsSync(asset)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("App assets are not built. Run npm run build, then restart.");
      return;
    }
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
    };
    res.writeHead(200, {
      "Content-Type": types[extname(asset)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": extname(asset) === ".html" ? "no-cache" : "public, max-age=86400",
    });
    if (method === "HEAD") res.end();
    else createReadStream(asset).pipe(res);
  } catch (e) {
    json(res, e instanceof QueryError ? 400 : 500, {
      error: e instanceof Error ? e.message : String(e),
    });
  }
});
server.listen(port, "127.0.0.1", () => console.log(`FM Scout 24: http://127.0.0.1:${port}`));
server.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
process.on("SIGINT", () => {
  active?.worker.terminate();
  server.close();
});
