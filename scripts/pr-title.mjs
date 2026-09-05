export const TITLE_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert', 'deps'];
export const TITLE_STATUS = 'PR title';

const headerPattern = new RegExp(`^(?:${TITLE_TYPES.join('|')})(?:\\([a-zA-Z0-9._/-]+\\))?!?: \\S(?:[^\\r\\n]*\\S)?$`);
const guidance = `Use type(scope): description (scope is optional), for example "fix: preserve fractional snapshot timestamps" or "feat: add app branding". Allowed types: ${TITLE_TYPES.join(', ')}. Use ! before : for a breaking change. Squash and merge using the validated PR title.`;

/** Validate the title exactly as entered, without normalizing or inferring a prefix. */
export function isValidTitle(title) {
  return typeof title === 'string' && !/[\x00-\x1f\x7f]/.test(title) && headerPattern.test(title);
}

/** Check current PR metadata and publish a commit status without editing the PR. */
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
      core.info('The PR is closed; no title check is needed.');
      return;
    }
    await status('pending', 'Checking the Conventional Commit title');
    if (!isValidTitle(pr.title)) {
      throw new Error(`The PR title is invalid. Edit the PR title manually. ${guidance}`);
    }

    // Recheck metadata before publishing success; a changed title or head needs a new run.
    const {data: current} = await github.rest.pulls.get(params);
    if (current.state !== 'open' || current.title !== pr.title || current.head.sha !== pr.head.sha) {
      throw new Error('The PR changed while checking its title. Run the PR title workflow again for the current PR.');
    }
    // Attach a stable status to the PR head, including manual dispatches.
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
