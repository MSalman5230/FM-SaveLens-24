# PR titles and releases

PR titles targeting `master` must use `type(scope): description`. The scope is optional; put `!` before `:` for a breaking change.

- `fix: preserve fractional snapshot timestamps` triggers a patch release.
- `feat(ui): add app branding` triggers a minor release.
- `feat(api)!: replace the snapshot format` triggers a major release.
- `docs: clarify installation` passes validation without starting a release.

Supported types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`, and `deps`. Types must be lowercase. Scopes contain letters, digits, `.`, `_`, `/`, or `-`. Use exactly one space after the colon. Descriptions must be nonempty and on one line, with no leading or trailing whitespace.

## Title validation

The **PR title** workflow checks new PRs, title edits, reopened PRs, new commits, and PRs marked ready for review. Invalid titles fail the check with format guidance in the workflow logs. Edit the title on GitHub to rerun the check.

For example, `FIX:repair timestamps` fails; enter `fix: repair timestamps` manually. Choose the type and any breaking-change marker explicitly. The workflow does not infer them from branches or commit messages, suggest a replacement title, or automatically rename PRs.

The workflow reads PR metadata, including fork PRs, and uses the built-in GitHub token to publish a **PR title** commit status. It runs only trusted code from the default branch. PR metadata is never changed and no PR comments are posted.

## Activation and merging

Merge the workflow and script into `master` to activate them. For existing PRs, use **Actions → PR title → Run workflow** on `master` and supply the PR number. Generated Release Please PRs receive this check automatically through the Release workflow.

After the first run, a repository administrator can make the **PR title** commit status required in the `master` branch rules. In **Settings → General → Pull Requests**, enable squash merging and set the default squash commit message to **Pull request title**. These repository settings are separate from the workflow files.

**Squash and merge using the validated PR title as the commit subject.** Release Please reads commit messages on `master`, so a valid PR title alone does not fix ordinary merge commits, rebased commits, or past history. If another merge method is used, the committed messages themselves must use Conventional Commits. The title policy also accepts documentation and maintenance changes that do not require a release.

Run the policy tests locally with `node --test tests/pr-title.test.mjs` after `npm ci`.
