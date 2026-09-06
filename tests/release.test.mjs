import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import 'release-please';
import {parseConventionalCommits} from 'release-please/build/src/commit.js';
import {Rust} from 'release-please/build/src/strategies/rust.js';
import {Version} from 'release-please/build/src/version.js';
import {TagName} from 'release-please/build/src/util/tag-name.js';
import {mergeUpdates} from 'release-please/build/src/updaters/composite.js';
import {configureInitialRelease} from '../scripts/release-please.mjs';

const config = JSON.parse(readFileSync('release-please-config.json', 'utf8')).packages['.'];
const logger = {info(){}, warn(){}, error(){}, debug(){}};
const github = {
  repository: {owner:'MSalman5230', repo:'FM-SaveLens-24'},
  async getFileContentsOnBranch(path) {return {parsedContent:readFileSync(path,'utf8')};},
};
function strategy(initial) {
  const manifest = configureInitialRelease({
    releasedVersions: initial ? {} : {'.': Version.parse('1.0.0')},
    repositoryConfig: {'.': {initialVersion:config['initial-version']}},
  });
  return new Rust({
    github, targetBranch:'master', path:'.', logger,
    packageName:config['package-name'], extraFiles:config['extra-files'],
    initialVersion:config['initial-version'],
    releaseAs:manifest.repositoryConfig['.'].releaseAs,
    includeComponentInTag:false,
  });
}
const releaseAssetNames = [
  'FM-SaveLens-24-v2.3.4-windows-x64-portable.zip',
  'FM-SaveLens-24-v2.3.4-windows-x64-setup.exe',
  'FM-SaveLens-24-v2.3.4-linux-x86_64.AppImage',
  'FM-SaveLens-24-v2.3.4-linux-x86_64.flatpak',
  'FM-SaveLens-24-v2.3.4-macos-arm64.dmg',
  'FM-SaveLens-24-v2.3.4-macos-x86_64.dmg',
];
function withReleaseAssets(run) {
  const root = mkdtempSync(join(tmpdir(), 'fm-savelens-assets-'));
  const dist = join(root, 'dist');
  try {
    mkdirSync(dist);
    writeFileSync(join(root, 'package.json'), JSON.stringify({version:'2.3.4'}));
    for (const name of releaseAssetNames) writeFileSync(join(dist, name), 'abc');
    const validate = () => execFileSync(process.execPath,
      [join(process.cwd(), 'scripts/release-assets.mjs')], {cwd:root, stdio:'pipe'});
    run({dist, validate});
  } finally {rmSync(root, {recursive:true, force:true});}
}

test('Release assets require six packages and generate repeatable SHA-256 checksums', () => {
  withReleaseAssets(({dist, validate}) => {
    const expected = [...releaseAssetNames].sort().map(name =>
      `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  ${name}\n`).join('');
    assert.match(validate().toString(), /All 6 release packages verified/);
    assert.equal(readFileSync(join(dist, 'SHA256SUMS.txt'), 'utf8'), expected);
    writeFileSync(join(dist, 'SHA256SUMS.txt'), 'stale checksums\n');
    validate();
    assert.equal(readFileSync(join(dist, 'SHA256SUMS.txt'), 'utf8'), expected);
  });
});

for (const missing of releaseAssetNames) {
  test(`Release assets reject missing ${missing}`, () => {
    withReleaseAssets(({dist, validate}) => {
      rmSync(join(dist, missing));
      assert.throws(validate, error => error.status !== 0 && error.stderr.toString().includes(missing));
      assert.equal(existsSync(join(dist, 'SHA256SUMS.txt')), false);
    });
  });
}

test('Release assets reject unexpected downloads', () => {
  withReleaseAssets(({dist, validate}) => {
    writeFileSync(join(dist, 'unexpected.zip'), 'abc');
    assert.throws(validate, error => error.status !== 0 && error.stderr.toString().includes('unexpected.zip'));
    assert.equal(existsSync(join(dist, 'SHA256SUMS.txt')), false);
  });
});

test('Cargo.lock keeps LF line endings with Windows Git checkout settings', () => {
  const root=mkdtempSync(join(tmpdir(),'fm-savelens-checkout-'));
  const git=(...args)=>execFileSync('git',['-c','core.autocrlf=true',...args],{cwd:root,stdio:'pipe'});
  try {
    writeFileSync(join(root,'.gitattributes'),readFileSync('.gitattributes'));
    writeFileSync(join(root,'Cargo.lock'),readFileSync('Cargo.lock','utf8').replace(/\r\n/g,'\n'));
    git('init');
    git('add','.gitattributes','Cargo.lock');
    git('checkout-index','--force','--prefix=checkout/','Cargo.lock');
    assert.ok(!readFileSync(join(root,'checkout/Cargo.lock'),'utf8').includes('\r'),
      'Release Please requires LF in Cargo.lock, including on Windows runners');
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('Release Please starts at 1.0.0 and subsequently bumps patch, minor and major', async () => {
  const commit = (type, breaking=false) => parseConventionalCommits([{sha:'abc', message:type+(breaking?'!':'')+': test'}],logger)[0];
  assert.equal((await strategy(true).buildNewVersion([commit('feat')])).toString(),'1.0.0');
  for(const [commits, expected] of [
    [[commit('fix')],'1.0.1'], [[commit('feat')],'1.1.0'], [[commit('feat',true)],'2.0.0'],
  ]) {
    const value = await strategy(false).buildNewVersion(commits,{tag:new TagName(Version.parse('1.0.0')),sha:'base',notes:''});
    assert.equal(value.toString(),expected);
  }
});
test('Actual Release Please updaters synchronize every application manifest and lockfile', async () => {
  const rust = strategy(false), version=Version.parse('2.3.4');
  const updates = mergeUpdates([
    ...await rust.buildUpdates({newVersion:version, changelogEntry:'## 2.3.4\n\nTest release'}),
    ...await rust.extraFileUpdates(version,new Map()),
  ]);
  const root=mkdtempSync(join(tmpdir(),'fm-savelens-versions-'));
  try {
    for(const update of updates) {
      const content=update.updater.updateContent(existsSync(update.path)?readFileSync(update.path,'utf8'):undefined,logger);
      mkdirSync(dirname(join(root,update.path)),{recursive:true});
      writeFileSync(join(root,update.path),content);
    }
    execFileSync(process.execPath,[join(process.cwd(),'scripts/check-versions.mjs'),'v2.3.4'],{cwd:root});
    assert.match(readFileSync(join(root,'src-tauri/Cargo.toml'),'utf8'),/version = "2\.3\.4"/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
