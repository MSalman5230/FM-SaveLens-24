export const TITLE_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert', 'deps'];
export const TITLE_STATUS = 'PR title';

const headerPattern = new RegExp(`^(${TITLE_TYPES.join('|')})(\\([a-z0-9._/-]+\\))?(!)?: *(\\S[^\\r\\n]*)$`, 'i');
const branchPattern = new RegExp(`^(?:codex/)?(${TITLE_TYPES.join('|')})(!)?[/_-].+`);
const guidance = `Use type(scope): description (scope is optional), for example "fix: preserve fractional snapshot timestamps" or "feat: add app branding". Allowed types: ${TITLE_TYPES.join(', ')}. Use ! before : for a breaking change. Squash and merge using the validated PR title.`;

function parseTitle(title) {
  if (typeof title !== 'string' || /[\x00-\x1f\x7f]/.test(title)) return null;
  const match = title.trim().match(headerPattern);
  if (!match) return null;
  const [, type, scope = '', breaking = '', description] = match;
  return {
    type: type.toLowerCase(),
    breaking: Boolean(breaking),
    title: `${type.toLowerCase()}${scope}${breaking}: ${description.trim()}`,
  };
}

export function isValidTitle(title) {
  return typeof title === 'string' && parseTitle(title)?.title === title;
}

// Infer only from explicit Conventional Commit types. Prose such as "Add tests"
// must not silently become a feature release, and mixed types need a human choice.
export function proposeTitle({title, branch = '', messages = []}) {
  const parsed = parseTitle(title);
  if (parsed) return {title: parsed.title, reason: 'normalized the existing conventional prefix'};
  if (typeof title !== 'string' || !title.trim() || /[\x00-\x1f\x7f]/.test(title)) {
    return {error: 'The PR title must be a nonempty single line.'};
  }
  if (/^[a-z][a-z-]*(?:\([^)]*\))?!?\s*:/i.test(title.trim())) {
    return {error: 'The existing prefix, scope, or description is invalid.'};
  }

  const commits = messages.filter(message => !/^Merge (?:pull request #\d+\b|branch |remote-tracking branch )/.test(message));
  const headers = commits.map(message => parseTitle(message.split(/\r?\n/, 1)[0]));
  const branchType = branch.match(branchPattern);
  const types = new Set(headers.filter(Boolean).map(header => header.type));
  if (branchType) types.add(branchType[1]);
  if (types.size !== 1 || (!branchType && (!headers.length || headers.some(header => !header)))) {
    return {error: 'Cannot infer one change type from the branch and commit messages. Choose a prefix explicitly.'};
  }
  const breaking = Boolean(branchType?.[2]) || headers.some(header => header?.breaking) ||
    commits.some(message => /(?:^|\n)BREAKING[ -]CHANGE: *\S/.test(message));
  return {
    title: `${[...types][0]}${breaking ? '!' : ''}: ${title.trim()}`,
    reason: branchType ? 'inferred the type from the branch and commit messages' : 'inferred the type from all commit messages',
  };
}

export async function checkPullRequestTitle({github, context, core}) {
  const pullNumber = Number(context.payload.pull_request?.number ?? context.payload.inputs?.pull_request_number);
  if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) {
    core.setFailed('A positive pull_request_number is required.');
    return;
  }
  const params = {...context.repo, pull_number: pullNumber};
  let pr;
  const status = (state, description) => github.rest.repos.createCommitStatus({
    ...context.repo, sha: pr.head.sha, context: TITLE_STATUS, state, description,
    target_url: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
  });

  try {
    // Read current metadata rather than an old event payload or rerun snapshot.
    ({data: pr} = await github.rest.pulls.get(params));
    if (pr.state !== 'open') {
      core.info('The PR is closed; no title change is needed.');
      return;
    }
    await status('pending', 'Checking the Conventional Commit title');
    let proposal = proposeTitle({title: pr.title});
    if (!proposal.title) {
      const commits = await github.paginate(github.rest.pulls.listCommits, {...params, per_page: 100});
      // GitHub caps this endpoint at 250 commits. Never classify a partial list.
      if (commits.length !== pr.commits) throw new Error(`Cannot infer a title from an incomplete commit list. ${guidance}`);
      proposal = proposeTitle({title: pr.title, branch: pr.head.ref, messages: commits.map(commit => commit.commit.message)});
    }
    if (!proposal.title) throw new Error(`${proposal.error} ${guidance}`);

    // Do not overwrite a title or classify a head that changed during API reads.
    const {data: current} = await github.rest.pulls.get(params);
    if (current.state !== 'open' || current.title !== pr.title || current.head.sha !== pr.head.sha) {
      throw new Error('The PR changed while checking its title. Run the PR title workflow again for the current PR.');
    }
    if (proposal.title !== pr.title) {
      let updated;
      try {
        ({data: updated} = await github.rest.pulls.update({...params, title: proposal.title}));
      } catch (error) {
        throw new Error(`Could not automatically rename the PR (${error.message}). Set its title to ${JSON.stringify(proposal.title)} manually. ${guidance}`);
      }
      if (updated.title !== proposal.title || !isValidTitle(updated.title)) {
        throw new Error('GitHub did not return the expected valid title after the update. Rerun the PR title workflow.');
      }
      core.notice(`PR #${pullNumber}: ${proposal.reason}. Title: ${JSON.stringify(updated.title)}`);
    }
    // GITHUB_TOKEN title edits do not trigger another edited workflow. Validate
    // here and attach a stable status to the PR head, including manual dispatches.
    await status('success', 'Valid PR title; squash and merge using this title');
    core.info(`PR #${pullNumber} has a valid Conventional Commit title.`);
  } catch (error) {
    if (pr?.state === 'open') {
      try {
        await status('failure', 'Choose a conventional title; see the workflow logs');
      } catch (statusError) {
        core.warning(`Could not publish the PR title status: ${statusError.message}`);
      }
    }
    core.setFailed(error.message);
  }
}
