# PR titles and releases

PR titles targeting `master` must use `type(scope): description`. The scope is optional; put `!` before `:` for a breaking change.

- `fix: preserve fractional snapshot timestamps` triggers a patch release.
- `feat(ui): add app branding` triggers a minor release.
- `feat(api)!: replace the snapshot format` triggers a major release.
- `docs: clarify installation` passes validation without starting a release.

Supported types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`, and `deps`. Scopes contain letters, digits, `.`, `_`, `/`, or `-`. Descriptions must be nonempty and on one line.

## Automatic corrections

The **PR title** workflow checks new PRs, title edits, reopened PRs, new commits, and PRs marked ready for review. It:

- Normalizes explicit prefixes: `FIX:repair timestamps` becomes `fix: repair timestamps`.
- Adds a missing prefix from a typed branch (`fix/timestamps`, `fix-timestamps`, or `codex/fix-timestamps`) or a complete set of commits with one consistent conventional type. Branch and commit types must not conflict.
- Preserves explicit breaking-change markers when inferring a title.
- Fails with instructions when the type is ambiguous. For example, `Add tests` alone does not establish whether the change is a feature or a test change. Unknown changes are never assigned `chore:` by default.

The workflow uses the built-in GitHub token to rename PRs, including fork PRs, and runs only trusted code from the default branch. If GitHub denies the rename, the check fails with the proposed title for a manual correction. A successful rename is validated in the same run. No PR comments are posted.

## Activation and merging

Merge the workflow and script into `master` to activate them. For existing PRs, use **Actions → PR title → Run workflow** on `master` and supply the PR number. Generated Release Please PRs receive this check automatically through the Release workflow.

After the first run, a repository administrator can make the **PR title** commit status required in the `master` branch rules. In **Settings → General → Pull Requests**, enable squash merging and set the default squash commit message to **Pull request title**. These repository settings are separate from the workflow files.

**Squash and merge using the validated PR title as the commit subject.** Release Please reads commit messages on `master`, so a valid PR title alone does not fix ordinary merge commits, rebased commits, or past history. If another merge method is used, the committed messages themselves must use Conventional Commits. The title policy also accepts documentation and maintenance changes that do not require a release.

Run the policy tests locally with `node --test tests/pr-title.test.mjs` after `npm ci`.
