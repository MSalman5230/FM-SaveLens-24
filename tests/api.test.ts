import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  statSync,
  utimesSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { SaveArchive, SaveError } from "../server/parser/archive.ts";
import { readNames } from "../server/parser/strings.ts";
const source = join(process.env.FM_SAVELENS_24_FIXTURE_DIR || "tests/fixtures/private", "Tactics Creator.fm");
test("Truncated archives and absent name tables return clear format errors", () => {
  const root = mkdtempSync(join(tmpdir(), "fm24-format-"));
  try {
    for (const length of [0, 6, 25, 26, 100]) {
      const path = join(root, length + ".fm");
      writeFileSync(path, Buffer.alloc(length));
      assert.throws(() => new SaveArchive(path), SaveError);
    }
    const b = Buffer.alloc(50);
    b.writeUInt32LE(10001);
    b.writeUInt32LE(100, 8);
    assert.throws(() => readNames(b), SaveError);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + "fm24-format-"));
    rmSync(root, { recursive: true, force: true });
  }
});
test(
  "Local API: discovery, cancellation, changed saves, cache, queries and missing fields",
  { skip: !existsSync(source), timeout: 60000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "fm24-api-")),
      folder = join(root, "games"),
      data = join(root, "data");
    mkdirSync(folder);
    const file = join(folder, "Fixture.fm");
    copyFileSync(source, file);
    writeFileSync(join(folder, "Truncated.fm"), readFileSync(file).subarray(0, 100));
    const port = await new Promise<number>((r) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => r(p));
      });
    });
    const child = spawn(resolve("target/release/fm-savelens-24-server" + (process.platform === "win32" ? ".exe" : "")), ["--no-open"], {
      cwd: resolve("."),
      env: { ...process.env, FM_SAVELENS_24_PORT: String(port), FM_SAVELENS_24_DATA_DIR: data },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    child.stdout.on("data", (c) => (logs += c));
    child.stderr.on("data", (c) => (logs += c));
    t.after(async () => {
      child.kill();
      await new Promise<void>((r) => {
        if (child.exitCode !== null) r();
        else child.once("exit", () => r());
      });
      assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + "fm24-api-"));
      rmSync(root, { recursive: true, force: true });
    });
    const call = async (path: string, method = "GET", body?: unknown) => {
      const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, value: (await res.json()) as any };
    };
    for (let i = 0; i < 100 && !logs.includes("FM SaveLens 24:"); i++) await delay(30);
    assert.ok(logs.includes("FM SaveLens 24:"), logs);
    assert.equal((await call("/settings", "PUT", { folder: join(root, "missing") })).status, 400);
    assert.equal((await call("/imports", "POST", null)).status, 400);
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${port}/api/health`, {
          headers: { Origin: "https://example.com" },
        })
      ).status,
      403,
    );
    assert.equal((await call("/settings", "PUT", { folder })).status, 200);
    const files = (await call("/saves")).value.saves,
      fixture = files.find((s: any) => s.name === "Fixture.fm");
    assert.equal(files.length, 2);
    assert.equal(fixture.cached, false);
    let job = (await call("/imports", "POST", { saveId: fixture.id })).value;
    assert.equal((await call("/imports", "POST", { saveId: fixture.id })).status, 400);
    assert.equal((await call("/imports/" + job.id, "DELETE")).value.status, "cancelled");
    assert.equal(
      (await call("/saves")).value.saves.find((s: any) => s.id === fixture.id).cached,
      false,
    );
    // Change only this disposable copy immediately after dispatch. Both the
    // pre-read metadata comparison and post-read comparison must reject it.
    job = (await call("/imports", "POST", { saveId: fixture.id })).value;
    const stamp = new Date(Date.now() + 5000);
    utimesSync(file, stamp, stamp);
    async function finish(id: string) {
      for (let i = 0; i < 300; i++) {
        const j = (await call("/imports/" + id)).value;
        if (j.status !== "running") return j;
        await delay(50);
      }
      throw new Error("Import timed out");
    }
    const changed = await finish(job.id);
    assert.equal(changed.status, "error");
    assert.match(changed.message, /changed/i);
    job = (await call("/imports", "POST", { saveId: fixture.id })).value;
    let worstHealth = 0;
    while (job.status === "running") {
      const start = performance.now();
      assert.equal((await call("/health")).status, 200);
      worstHealth = Math.max(worstHealth, performance.now() - start);
      job = (await call("/imports/" + job.id)).value;
      await delay(50);
    }
    assert.equal(job.status, "complete", job.message);
    assert.ok(worstHealth < 1500, `Main process blocked for ${worstHealth} ms`);
    const snapshot = job.snapshotId,
      meta = (await call("/snapshots/" + snapshot)).value;
    assert.equal(meta.stale, false);
    assert.ok(meta.playerCount > 6000);
    const cached = (await call("/imports", "POST", { saveId: fixture.id })).value;
    assert.equal(cached.status, "complete");
    assert.equal(cached.snapshotId, snapshot);
    const path = "/snapshots/" + snapshot + "/players";
    const first = (await call(path + "?limit=25")).value,
      second = (await call(path + "?limit=25&page=2")).value;
    assert.equal(first.players.length, 25);
    assert.equal(second.players.length, 25);
    assert.equal(new Set([...first.players, ...second.players].map((p) => p.id)).size, 50);
    for (let i = 1; i < first.players.length; i++) {
      const a = first.players[i - 1],
        b = first.players[i];
      assert.ok(a.pa > b.pa || (a.pa === b.pa && a.ca >= b.ca));
    }
    for (const query of [
      "paMin=-1",
      "caMax=9007199254740992",
      "ageMin=1.5",
      "ageMin=30&ageMax=15",
      "sort=invalid",
      "direction=sideways",
      "limit=0",
      "attr_pace=21",
    ])
      assert.equal((await call(path + "?" + query)).status, 400, query);
    for (const field of ['age', 'ca', 'pa']) {
      const above = await call(path + `?${field}Min=250`);
      assert.equal(above.status, 200);
      assert.equal(above.value.total, 0);
      const upper = await call(path + `?${field}Max=250`);
      assert.equal(upper.status, 200);
      assert.equal(upper.value.total, meta.playerCount);
    }
    assert.equal((await call(path + "?q=%25")).value.total, 0, "LIKE wildcards are literal");
    const accented = (await call(path + "?q=mbappe")).value;
    assert.ok(
      accented.players.some((p: any) => p.name.includes("Mbappé")),
      "Accent-insensitive search preserves the displayed name",
    );
    const filtered = (
      await call(
        path + "?ageMax=30&caMin=80&paMin=100&position=12&attr_pace=12&attr_finishing=12&limit=25",
      )
    ).value;
    assert.ok(filtered.total > 0);
    for (const p of filtered.players) {
      assert.ok(p.age <= 30 && p.ca >= 80 && p.pa >= 100 && p.positions.includes("ST"));
      const d = (await call(path + "/" + p.id)).value;
      assert.ok(d.attributes.pace >= 12 && d.attributes.finishing >= 12);
      assert.equal(Object.keys(d.attributes).length, 62);
    }
    const unavailable = (await call(path + "?club=-1&limit=5")).value;
    for (const p of unavailable.players) assert.equal(p.club, null);
    assert.equal((await call(path + "/99999999")).status, 404);
    const before = statSync(file);
    utimesSync(file, new Date(), new Date(before.mtimeMs + 10000));
    assert.equal((await call("/snapshots/" + snapshot)).value.stale, true);
    assert.notEqual(
      (await call("/saves")).value.saves.find((s: any) => s.id === fixture.id).snapshotId,
      snapshot,
    );
    const truncated = files.find((s: any) => s.name === "Truncated.fm");
    const bad = (await call("/imports", "POST", { saveId: truncated.id })).value;
    assert.equal((await finish(bad.id)).status, "error");
    t.diagnostic(
      `Imported ${meta.playerCount} players. Slowest health request while importing: ${worstHealth.toFixed(1)} ms.`,
    );
  },
);
