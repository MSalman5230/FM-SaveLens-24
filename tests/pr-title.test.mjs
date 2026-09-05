import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'release-please';
import {parseConventionalCommits} from 'release-please/build/src/commit.js';
import {TITLE_TYPES, TITLE_STATUS, isValidTitle, proposeTitle, checkPullRequestTitle} from '../scripts/pr-title.mjs';

test('accepted titles are understood by the actual Release Please parser', () => {
  for (const type of TITLE_TYPES) {
    for (const suffix of [': describe the change', '(parser): describe the change', '(api)!: change the API']) {
      const title = type + suffix;
      assert.ok(isValidTitle(title), title);
      const [commit] = parseConventionalCommits([{sha: 'abc', message: title}]);
      assert.equal(commit.type, type);
      assert.equal(commit.breaking, suffix.includes('!'));
    }
  }
  assert.ok(isValidTitle('chore(master): release 1.0.1'));
});

test('rejects missing types, malformed prefixes, empty descriptions, and control characters', () => {
  for (const title of [undefined, null, '', ' ', 'Add app branding', 'feature: add branding', 'fix:',
    'fix:  ', 'fix(): repair', 'fix(parser: repair', 'fix: repair\nfeat: add', 'fix: repair\r',
    'FIX: repair', 'fix:repair', ' fix: repair ', 'fix: repair\u0000']) {
    assert.equal(isValidTitle(title), false, String(title));
  }
});

test('normalizes formatting while preserving explicit scope and breaking intent', () => {
  assert.equal(proposeTitle({title: '  FIX(Parser)!:repair timestamps  '}).title, 'fix(Parser)!: repair timestamps');
  assert.equal(proposeTitle({title: 'feat: add branding', branch: 'fix/branding'}).title, 'feat: add branding');
  assert.equal(proposeTitle({title: 'chore(master): release 1.0.1'}).title, 'chore(master): release 1.0.1');
});

test('infers only a consistent type from a complete set of conventional commits', () => {
  assert.equal(proposeTitle({title: 'Preserve timestamps', messages: ['fix(parser): preserve precision', 'fix: handle absent values']}).title,
    'fix: Preserve timestamps');
  assert.equal(proposeTitle({title: 'Preserve timestamps', messages: ["Merge branch 'master' into topic", 'fix: preserve precision']}).title,
    'fix: Preserve timestamps');
  for (const messages of [[], ['Add new icons'], ['fix: preserve precision', 'Harden tests'], ['feat: add branding', 'fix: repair icon']]) {
    assert.ok(proposeTitle({title: 'Update app', messages}).error);
  }
});

test('typed branches support existing codex naming without guessing prose intent', () => {
  for (const branch of ['fix/timestamps', 'fix-timestamps', 'codex/fix-failed-master-ci']) {
    assert.equal(proposeTitle({title: 'Preserve timestamps', branch, messages: ['Preserve timestamp precision']}).title,
      'fix: Preserve timestamps');
  }
  for (const branch of ['codex/add-icons', 'codex/prefix-something', 'topic/fix-readme']) {
    assert.ok(proposeTitle({title: 'Add tests', branch}).error);
  }
  assert.ok(proposeTitle({title: 'Update app', branch: 'fix/branding', messages: ['feat: add branding']}).error);
  assert.ok(proposeTitle({title: 'feature: add branding', branch: 'feat/branding'}).error);
  assert.ok(proposeTitle({title: 'fix:', branch: 'fix/timestamps'}).error);
});

test('inferred titles preserve breaking markers from commits, footers, and branches', () => {
  for (const options of [
    {messages: ['feat(api)!: change the API']},
    {messages: ['fix: change the API\n\nBREAKING CHANGE: old clients need migration']},
    {messages: ['fix: change the API\n\nBREAKING-CHANGE: old clients need migration']},
    {branch: 'fix/api', messages: ['Change the API\n\nBREAKING CHANGE: old clients need migration']},
    {branch: 'feat!/api'},
  ]) {
    const result = proposeTitle({title: 'Update API', ...options});
    assert.match(result.title, /!: Update API$/);
    const [commit] = parseConventionalCommits([{sha: 'abc', message: result.title}]);
    assert.equal(commit.breaking, true);
  }
});

function fixture({title = 'Preserve fractional snapshot timestamps', branch = 'codex/fix-failed-master-ci',
  messages = ['Preserve fractional snapshot timestamps'], prOverrides = {}, currentOverrides = {},
  updateError, updateTitle, getError, statusError, manual = false} = {}) {
  const pr = {number: 4, title, state: 'open', commits: messages.length, head: {sha: 'current-head', ref: branch}, ...prOverrides};
  const calls = {gets: [], updates: [], statuses: [], paginations: [], errors: [], notices: [], warnings: []};
  const github = {
    rest: {
      pulls: {
        async get(params) {
          calls.gets.push(params);
          if (getError) throw getError;
          return {data: calls.gets.length === 1 ? pr : {...pr, ...currentOverrides}};
        },
        listCommits() {},
        async update(params) {
          calls.updates.push(params);
          if (updateError) throw updateError;
          return {data: {...pr, title: updateTitle ?? params.title}};
        },
      },
      repos: {
        async createCommitStatus(params) {
          calls.statuses.push(params);
          if (statusError) throw statusError;
          return {data: {}};
        },
      },
    },
    async paginate(method, params) {
      assert.equal(method, github.rest.pulls.listCommits);
      calls.paginations.push(params);
      return messages.map(message => ({commit: {message}}));
    },
  };
  const context = {
    repo: {owner: 'owner', repo: 'repo'}, serverUrl: 'https://github.com', runId: 123,
    payload: manual ? {inputs: {pull_request_number: '4'}} : {pull_request: {number: 4, title: 'stale event title', head: {sha: 'old-head'}}},
  };
  const core = {info() {}, notice: message => calls.notices.push(message), warning: message => calls.warnings.push(message),
    setFailed: message => calls.errors.push(message)};
  return {github, context, core, calls};
}

test('auto-renames from current metadata and passes the status in the same run', async () => {
  const f = fixture();
  await checkPullRequestTitle(f);
  assert.deepEqual(f.calls.errors, []);
  assert.deepEqual(f.calls.updates, [{owner: 'owner', repo: 'repo', pull_number: 4, title: 'fix: Preserve fractional snapshot timestamps'}]);
  assert.deepEqual(f.calls.statuses.map(status => status.state), ['pending', 'success']);
  assert.ok(f.calls.statuses.every(status => status.sha === 'current-head' && status.context === TITLE_STATUS));
  assert.equal(f.calls.statuses[1].target_url, 'https://github.com/owner/repo/actions/runs/123');
  assert.equal(f.calls.paginations[0].per_page, 100);
});

test('valid release PR titles pass without commit reads or edits, including manual dispatch', async () => {
  const f = fixture({title: 'chore(master): release 1.0.1', manual: true});
  await checkPullRequestTitle(f);
  assert.deepEqual(f.calls.errors, []);
  assert.equal(f.calls.updates.length, 0);
  assert.equal(f.calls.paginations.length, 0);
  assert.equal(f.calls.statuses.at(-1).state, 'success');
});

test('ambiguous types and incomplete commit lists fail without renaming', async () => {
  for (const options of [
    {title: 'Add icons', branch: 'codex/add-icons', messages: ['Add app icons']},
    {messages: ['feat: add UI', 'fix: repair UI']},
    {messages: ['fix: repair'], prOverrides: {commits: 251}},
  ]) {
    const f = fixture(options);
    await checkPullRequestTitle(f);
    assert.equal(f.calls.updates.length, 0);
    assert.equal(f.calls.statuses.at(-1).state, 'failure');
    assert.match(f.calls.errors[0], /Use type\(scope\): description/);
  }
});

test('title changes, new commits, or closure during API reads prevent stale edits', async () => {
  for (const currentOverrides of [{title: 'feat: the author chose a title'}, {head: {sha: 'new-head'}}, {state: 'closed'}]) {
    const f = fixture({currentOverrides});
    await checkPullRequestTitle(f);
    assert.equal(f.calls.updates.length, 0);
    assert.match(f.calls.errors[0], /PR changed/);
    assert.equal(f.calls.statuses.at(-1).state, 'failure');
    assert.equal(f.calls.statuses.at(-1).sha, 'current-head');
  }
});

test('API failures and unexpected rename responses cannot yield a passing check', async () => {
  for (const options of [{updateError: new Error('403 Forbidden')}, {updateTitle: 'Still invalid'}, {statusError: new Error('403 Forbidden')}]) {
    const f = fixture(options);
    await checkPullRequestTitle(f);
    assert.equal(f.calls.errors.length, 1);
    assert.equal(f.calls.statuses.at(-1).state, 'failure');
  }
  const f = fixture({getError: new Error('404 Not Found')});
  await checkPullRequestTitle(f);
  assert.deepEqual(f.calls.errors, ['404 Not Found']);
  assert.equal(f.calls.statuses.length, 0);
});

test('invalid manual inputs and closed PRs never mutate metadata or statuses', async () => {
  for (const input of ['', '0', '-1', '1.5', 'abc']) {
    const f = fixture({manual: true});
    f.context.payload.inputs.pull_request_number = input;
    await checkPullRequestTitle(f);
    assert.equal(f.calls.errors.length, 1);
    assert.equal(f.calls.gets.length, 0);
  }
  const f = fixture({prOverrides: {state: 'closed'}});
  await checkPullRequestTitle(f);
  assert.equal(f.calls.updates.length, 0);
  assert.equal(f.calls.statuses.length, 0);
});

test('shell and expression syntax in PR metadata is passed as literal API data', async () => {
  const title = 'Repair `commands` $(substitution) ${process.env.TOKEN} ${{ secrets.TOKEN }}';
  const f = fixture({title});
  await checkPullRequestTitle(f);
  assert.deepEqual(f.calls.errors, []);
  assert.equal(f.calls.updates[0].title, `fix: ${title}`);
});
