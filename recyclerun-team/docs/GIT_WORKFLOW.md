# RecycleRun Git Workflow

This is the team-standard workflow for hackathon speed without breaking demos.

## Branch Strategy

| Branch | Purpose | Rule |
|---|---|---|
| `main` | Always demo-ready and stable | Merge from `pre-master` only (PR) |
| `pre-master` | Integration and testing branch | All feature PRs target this branch |
| `feature/<scope>-<short-name>` | Task branch per ticket | Branch from latest `pre-master`, short-lived |
| `hotfix/<short-name>` | Emergency fix for `main` | Branch from `main`, then sync back to `pre-master` |

## One-Time Setup

Run once if `pre-master` does not exist:

```bash
git checkout main
git pull origin main
git checkout -b pre-master
git push -u origin pre-master
```

## Daily Developer Flow

```bash
# 1) Sync local integration branch
git checkout pre-master
git pull --rebase origin pre-master

# 2) Create a feature branch from pre-master
git checkout -b feature/optimizer-priority

# 3) Work and commit in small increments
git add .
git commit -m "feat(optimizer): prioritize high-value materials"

# 4) Push branch and open PR to pre-master
git push -u origin feature/optimizer-priority
# PR: feature/optimizer-priority -> pre-master
```

## PR and Merge Rules

For `feature/* -> pre-master`:

1. Use a PR (no direct pushes to `pre-master`).
2. Require passing checks: backend tests, frontend build, lint.
3. Require at least one teammate review.
4. Prefer **Squash and merge** (clean history, easier rollback).
5. Delete feature branch after merge.

For `pre-master -> main`:

1. Team lead opens PR at release checkpoints.
2. Confirm smoke tests pass on `pre-master` first.
3. Merge only when demo-critical flows work end-to-end.

## Release Cadence (Hackathon)

1. Merge features to `pre-master` continuously.
2. Cut releases from `pre-master` to `main` 1-2 times per day.
3. Tag each release on `main`:

```bash
git checkout main
git pull origin main
git tag -a v0.2-demo -m "Demo checkpoint v0.2"
git push origin v0.2-demo
```

## Hotfix Workflow

If `main` breaks near demo time:

```bash
# 1) Branch from main
git checkout main
git pull origin main
git checkout -b hotfix/fix-driver-crash

# 2) Fix and push
git add .
git commit -m "fix(driver): prevent crash on empty route"
git push -u origin hotfix/fix-driver-crash
```

Open PR `hotfix/* -> main`, merge fast after review/checks, then sync fix back:

```bash
git checkout pre-master
git pull origin pre-master
git merge origin/main
git push origin pre-master
```

## Branch Protection Settings

Configure in GitHub for both `main` and `pre-master`:

1. Require pull request before merging.
2. Require status checks to pass before merging.
3. Require at least one approval.
4. Block force pushes.
5. Include administrators.

## Commit Message Convention

```text
feat(scope): short description
fix(scope): short description
test(scope): short description
chore(scope): short description
docs(scope): short description
```

Examples:

- `feat(optimizer): add stop value scoring`
- `fix(api): return 400 for invalid material type`
- `docs(workflow): define pre-master release flow`

## Non-Negotiable Team Rules

1. No direct commits to `main` or `pre-master`.
2. Keep feature branches under 1-2 days.
3. Rebase from `pre-master` before requesting review.
4. Every PR must include test steps.
