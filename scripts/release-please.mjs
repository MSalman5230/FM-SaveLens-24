import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {GitHub, Manifest} from 'release-please';

// The Rust strategy overrides the library's initial-version default. Apply an
// override only while the manifest has no release, so later commits bump normally.
export function configureInitialRelease(manifest) {
  if (!manifest.releasedVersions['.']) {
    manifest.repositoryConfig['.'].releaseAs = manifest.repositoryConfig['.'].initialVersion;
    if (manifest.repositoryConfig['.'].releaseAs !== '1.0.0') {
      throw new Error('The initial FM SaveLens 24 release must be 1.0.0');
    }
  }
  return manifest;
}

async function main() {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  if (!owner || !repo || !process.env.GITHUB_TOKEN || !process.env.GITHUB_OUTPUT) {
    throw new Error('Run this entry point inside the Release workflow');
  }
  const github = await GitHub.create({owner, repo, token: process.env.GITHUB_TOKEN});
  const manifest = configureInitialRelease(await Manifest.fromManifest(github, 'master'));
  const releases = (await manifest.createReleases()).filter(Boolean);
  // A fresh manifest avoids reusing pre-release state when building the next PR.
  const next = configureInitialRelease(await Manifest.fromManifest(github, 'master'));
  const prs = (await next.createPullRequests()).filter(Boolean);
  if (releases.length > 1) throw new Error('Expected one product release');
  const release = releases[0];
  const outputs = {
    release_created: String(Boolean(release)),
    tag_name: release?.tagName || '',
    sha: release?.sha || '',
    prs_created: String(prs.length > 0),
    prs: JSON.stringify(prs.map(pr => ({number: pr.number}))),
  };
  for (const [key, value] of Object.entries(outputs)) {
    if (value.includes('\n') || value.includes('\r')) throw new Error('Invalid workflow output');
    appendFileSync(process.env.GITHUB_OUTPUT, key + '=' + value + '\n');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
