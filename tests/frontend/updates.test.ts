import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createUpdateController, initialUpdateView, showUpdateBanner, type UpdateStatus } from '../../web/lib/updates.ts';

const status = (changes: Partial<UpdateStatus> = {}): UpdateStatus => ({
  version: '1.3.0', automatic: true, dismissedVersion: null, lastCheckedAt: null,
  nextAutomaticCheckAt: 0, retryAt: null, latestVersion: null, updateAvailable: false,
  releaseUrl: null, error: null, ...changes,
});
const available = status({ latestVersion: '1.4.0', updateAvailable: true,
  releaseUrl: 'https://github.com/MSalman5230/FM-SaveLens-24/releases/tag/v1.4.0' });

function harness(initial = status()) {
  let now = 1000;
  let latest = initial;
  let view = initialUpdateView();
  let fail = false;
  let pending: (() => void) | undefined;
  let hold = false;
  const calls: { path: string; init: RequestInit }[] = [];
  const timers = new Map<number, { due: number; run: () => void }>();
  let timerId = 0;
  const controller = createUpdateController({
    clock: () => now,
    publish: (next) => { view = next; },
    schedule: (run, ms) => { const id = ++timerId; timers.set(id, { run, due: now + ms / 1000 }); return id as unknown as ReturnType<typeof setTimeout>; },
    cancel: (id) => { timers.delete(id as unknown as number); },
    request: async <T>(path: string, init: RequestInit = {}) => {
      calls.push({ path, init });
      if (hold) await new Promise<void>((resolve) => { pending = resolve; });
      if (fail) throw new Error('offline');
      if (path === '/updates/check') latest = { ...latest, lastCheckedAt: latest.error ? latest.lastCheckedAt : now, nextAutomaticCheckAt: now + 86400, retryAt: now + 60 };
      if (init.method === 'PUT') latest = { ...latest, ...JSON.parse(init.body as string) };
      return latest as T;
    },
  });
  return {
    controller, calls, timers,
    get view() { return view; },
    set status(value: UpdateStatus) { latest = value; },
    set fail(value: boolean) { fail = value; },
    set hold(value: boolean) { hold = value; },
    release() { pending?.(); hold = false; },
    async advance(seconds: number) {
      now += seconds;
      for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.run(); }
      await setImmediate();
    },
  };
}

test('startup checks when due, waits one day and refreshes the manual cooldown', async (t) => {
  const app = harness(); t.after(app.controller.dispose);
  await app.controller.refresh();
  assert.deepEqual(app.calls.map(call => call.path), ['/updates']);
  await app.advance(1);
  assert.equal(app.calls[1].path, '/updates/check');
  assert.deepEqual(JSON.parse(app.calls[1].init.body as string), { manual: false });
  await app.advance(60);
  assert.equal(app.calls.length, 2);
  assert.ok(app.view.now >= app.view.status!.retryAt!);
  await app.advance(86400 - 60);
  assert.equal(app.calls.length, 3);
});

test('saved opt-out prevents automatic checks; manual checks still work', async (t) => {
  const app = harness(status({ automatic: false })); t.after(app.controller.dispose);
  await app.controller.refresh();
  await app.advance(86400);
  assert.equal(app.calls.length, 1);
  await app.controller.check(true);
  assert.deepEqual(JSON.parse(app.calls[1].init.body as string), { manual: true });
  await app.controller.preferences({ automatic: true });
  assert.equal(app.view.status?.automatic, true);
});

test('dismissed release remains available in About and a later version restores banner', async (t) => {
  const app = harness(available); t.after(app.controller.dispose);
  await app.controller.refresh();
  assert.equal(showUpdateBanner(app.view.status), true);
  await app.controller.preferences({ dismissedVersion: '1.4.0' });
  assert.equal(showUpdateBanner(app.view.status), false);
  assert.equal(app.view.status?.updateAvailable, true);
  await app.controller.openRelease();
  assert.equal(app.calls.at(-1)?.path, '/updates/open');
  assert.equal(app.calls.at(-1)?.init.body, '{}');
  app.status = { ...available, latestVersion: '1.5.0', dismissedVersion: '1.4.0' };
  await app.controller.refresh();
  assert.equal(showUpdateBanner(app.view.status), true);
});

test('automatic errors remain quiet while manual failures are inline and retain known update', async (t) => {
  const app = harness(available); t.after(app.controller.dispose);
  await app.controller.refresh();
  app.status = { ...available, error: 'GitHub has limited update checks.' };
  await app.controller.check(false);
  assert.equal(app.view.message, '');
  await app.controller.check(true);
  assert.equal(app.view.message, 'GitHub has limited update checks.');
  assert.equal(app.view.status?.latestVersion, '1.4.0');
  app.fail = true;
  await app.controller.check(true);
  assert.match(app.view.message, /Could not check/);
  assert.equal(app.view.status?.latestVersion, '1.4.0');
});

test('busy requests coalesce checks, and disposal aborts and ignores late results', async () => {
  const app = harness();
  await app.controller.refresh();
  app.hold = true;
  const checking = app.controller.check(true);
  assert.equal(app.view.checking, true);
  await app.controller.check(true);
  await app.controller.refresh();
  assert.equal(app.calls.length, 2);
  app.controller.dispose();
  assert.equal(app.calls[1].init.signal?.aborted, true);
  const before = app.view;
  app.release();
  await checking;
  assert.equal(app.view, before);
  assert.equal(app.timers.size, 0);
});

test('failed preferences keep previous state; opening failures provide a fallback address', async (t) => {
  const app = harness(available); t.after(app.controller.dispose);
  await app.controller.refresh();
  app.fail = true;
  await app.controller.preferences({ dismissedVersion: '1.4.0' });
  assert.equal(showUpdateBanner(app.view.status), true);
  assert.match(app.view.message, /Could not save/);
  await app.controller.openRelease();
  assert.match(app.view.message, /github.com\/MSalman5230\/FM-SaveLens-24\/releases/);
});

test('failed automatic requests back off and never announce a false up-to-date result', async (t) => {
  const app = harness(); t.after(app.controller.dispose);
  await app.controller.refresh();
  app.fail = true;
  await app.advance(1);
  assert.equal(app.view.status?.lastCheckedAt, null);
  assert.equal(app.view.message, '');
  await app.advance(1);
  assert.equal(app.calls.length, 2);
  await app.advance(59);
  assert.equal(app.calls.length, 3);
});
