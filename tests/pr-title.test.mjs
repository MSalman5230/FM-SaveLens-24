import {test} from 'node:test';
import assert from 'node:assert/strict';
// Release Please has no public parser export. Its exact version is pinned in package.json;
// these compatibility tests intentionally fail if an upgrade changes the internal API.
import {parseConventionalCommits} from 'release-please/build/src/commit.js';
import {TITLE_TYPES, TITLE_STATUS, isValidTitle, checkPullRequestTitle} from '../scripts/pr-title.mjs';

test('accepted titles are understood by the actual Release Please parser', () => {
  for (const type of TITLE_TYPES) {
    for (const suffix of [': x', ': describe the change', '(Parser/API_1.0): describe the change', '(api)!: change the API']) {
      const title = type + suffix;
      assert.ok(isValidTitle(title), title);
      const [commit] = parseConventionalCommits([{sha: 'abc', message: title}]);
      assert.equal(commit.type, type);
      assert.equal(commit.breaking, suffix.includes('!'));
    }
  }
  assert.ok(isValidTitle('chore(master): release 1.0.1'));
});

test('rejects missing types, malformed prefixes, incorrect spacing, and control characters', () => {
  for (const title of [undefined, null, 42, '', ' ', 'Add app branding', 'feature: add branding', 'fix:',
    'fix:  ', 'fix(): repair', 'fix(parser: repair', 'fix: repair\nfeat: add', 'fix: repair\r',
    'FIX: repair', 'fix:repair', ' fix: repair', 'fix: repair ', 'fix:  repair',
    'fix: repair\tmore', 'fix: repair\u0000', 'fix: repair\u007f', 'fix: repair\u00a0']) {
    assert.equal(isValidTitle(title), false, String(title));
  }
});

/** Model separate metadata snapshots, concurrent author edits, and forbidden API calls. */
function fixture({title = 'fix: preserve fractional snapshot timestamps', branch = 'codex/fix-failed-master-ci',
  prOverrides = {}, currentOverrides = {}, afterGet, getError, getErrorAt = 1,
  statusErrorOn, manual = false} = {}) {
  const pr = {number: 4, title, state: 'open', commits: 1, head: {sha: 'current-head', ref: branch}, ...prOverrides};
  const calls = {gets: [], updates: [], statuses: [], commitReads: 0, errors: [], warnings: []};
  const github = {
    rest: {
      pulls: {
        async get(params) {
          calls.gets.push(params);
          if (getError && calls.gets.length === getErrorAt) throw getError;
          if (calls.gets.length > 1) Object.assign(pr, currentOverrides);
          const data = structuredClone(pr);
          afterGet?.(pr, calls.gets.length);
          return {data};
        },
        async listCommits() {
          calls.commitReads++;
          throw new Error('Title validation must not read commits.');
        },
        async update(params) {
          calls.updates.push(params);
          throw new Error('Title validation must not edit PR metadata.');
        },
      },
      repos: {
        async createCommitStatus(params) {
          calls.statuses.push(params);
          if (params.state === statusErrorOn) throw new Error('403 Forbidden');
          return {data: {}};
        },
      },
    },
    async paginate() {
      calls.commitReads++;
      throw new Error('Title validation must not read commits.');
    },
  };
  const context = {
    repo: {owner: 'owner', repo: 'repo'}, serverUrl: 'https://github.com', runId: 123,
    payload: manual ? {inputs: {pull_request_number: '4'}} : {pull_request: {number: 4, title: 'stale event title', head: {sha: 'old-head'}}},
  };
  const core = {info() {}, warning: message => calls.warnings.push(message), setFailed: message => calls.errors.push(message)};
  return {github, context, core, calls, pr};
}

test('validates current metadata and publishes a stable status without edits or commit reads', async () => {
  const f = fixture();
  await checkPullRequestTitle(f);
  assert.deepEqual(f.calls.errors, []);
  assert.deepEqual(f.calls.updates, []);
  assert.equal(f.calls.commitReads, 0);
  assert.deepEqual(f.calls.statuses.map(status => status.state), ['pending', 'success']);
  assert.ok(f.calls.statuses.every(status => status.sha === 'current-head' && status.context === TITLE_STATUS));
  assert.equal(f.calls.statuses[1].target_url, 'https://github.com/owner/repo/actions/runs/123');
});

test('valid release titles, scopes, and breaking markers pass regardless of branch, including manual dispatch', async () => {
  for (const title of ['chore(master): release 1.0.1', 'feat(Parser)!: change the API']) {
    const f = fixture({title, manual: true});
    await checkPullRequestTitle(f);
    assert.deepEqual(f.calls.errors, []);
    assert.equal(f.calls.updates.length, 0);
    assert.equal(f.calls.commitReads, 0);
    assert.equal(f.pr.title, title);
    assert.equal(f.calls.statuses.at(-1).state, 'success');
  }
});

test('invalid titles fail with manual guidance without normalization, inference, or updates', async () => {
  for (const manual of [false, true]) {
    for (const title of ['Preserve timestamps', 'FIX:repair timestamps', ' fix: repair ', 'feature: add icons', 'fix:']) {
      const f = fixture({title, manual});
      await checkPullRequestTitle(f);
      assert.equal(f.calls.updates.length, 0);
      assert.equal(f.calls.commitReads, 0);
      assert.equal(f.pr.title, title);
      assert.deepEqual(f.calls.statuses.map(status => status.state), ['pending', 'failure']);
      assert.match(f.calls.errors[0], /Edit the PR title manually/);
      assert.match(f.calls.errors[0], /Use type\(scope\): description/);
    }
  }
});

test('title changes, new commits, or closure during API reads prevent a passing stale check', async () => {
  for (const currentOverrides of [{title: 'feat: the author chose a title'}, {head: {sha: 'new-head'}}, {state: 'closed'}]) {
    const f = fixture({currentOverrides});
    await checkPullRequestTitle(f);
    assert.equal(f.calls.updates.length, 0);
    assert.match(f.calls.errors[0], /PR changed/);
    assert.equal(f.calls.statuses.at(-1).state, 'failure');
    assert.equal(f.calls.statuses.at(-1).sha, 'current-head');
  }
});

test('author edits after the last metadata snapshot remain untouched for valid and invalid titles', async () => {
  const authorTitle = 'feat: the author chose a different release type';
  for (const title of ['fix: repair timestamps', 'FIX:repair timestamps']) {
    const valid = isValidTitle(title);
    const f = fixture({title, afterGet(pr, count) {
      if (count === (valid ? 2 : 1)) pr.title = authorTitle;
    }});
    await checkPullRequestTitle(f);
    assert.equal(f.pr.title, authorTitle);
    assert.deepEqual(f.calls.updates, []);
    assert.equal(f.calls.errors.length, valid ? 0 : 1);
    assert.equal(f.calls.statuses.at(-1).state, valid ? 'success' : 'failure');
  }
});

test('metadata and status API failures fail the check with useful errors', async () => {
  for (const getErrorAt of [1, 2]) {
    const f = fixture({getError: new Error('404 Not Found'), getErrorAt});
    await checkPullRequestTitle(f);
    assert.deepEqual(f.calls.errors, ['404 Not Found']);
    assert.deepEqual(f.calls.statuses.map(status => status.state), getErrorAt === 1 ? [] : ['pending', 'failure']);
  }
  for (const statusErrorOn of ['pending', 'success', 'failure']) {
    const f = fixture({statusErrorOn, ...(statusErrorOn === 'failure' ? {title: 'Invalid title'} : {})});
    await checkPullRequestTitle(f);
    assert.equal(f.calls.errors.length, 1);
    assert.equal(f.calls.statuses.at(-1).state, 'failure');
    if (statusErrorOn === 'failure') {
      assert.match(f.calls.errors[0], /Edit the PR title manually/);
      assert.match(f.calls.warnings[0], /Could not publish the PR title status: 403 Forbidden/);
    } else {
      assert.equal(f.calls.errors[0], '403 Forbidden');
    }
  }
});

test('invalid manual inputs and closed PRs never mutate metadata or statuses', async () => {
  for (const input of ['', '0', '-1', '1.5', 'abc']) {
    const f = fixture({manual: true});
    f.context.payload.inputs.pull_request_number = input;
    await checkPullRequestTitle(f);
    assert.equal(f.calls.errors.length, 1);
    assert.equal(f.calls.gets.length, 0);
    assert.equal(f.calls.statuses.length, 0);
  }
  const f = fixture({prOverrides: {state: 'closed'}});
  await checkPullRequestTitle(f);
  assert.equal(f.calls.updates.length, 0);
  assert.equal(f.calls.statuses.length, 0);
});

test('shell and expression syntax in valid titles is treated as literal text', async () => {
  const title = 'fix: repair \x60commands\x60 $(substitution) ${process.env.TOKEN} ${{ secrets.TOKEN }}';
  const f = fixture({title});
  await checkPullRequestTitle(f);
  assert.deepEqual(f.calls.errors, []);
  assert.equal(f.calls.updates.length, 0);
  assert.equal(f.pr.title, title);
  assert.equal(f.calls.statuses.at(-1).state, 'success');
});
