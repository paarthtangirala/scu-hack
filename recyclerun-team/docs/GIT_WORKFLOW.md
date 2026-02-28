# RecycleRun — Git Workflow

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Protected. Merge via PR only. Demo-ready always. |
| `dev` | Integration branch. All features merge here first. |
| `feat/anisha/*` | Anisha's feature branches |
| `feat/soham/*` | Soham's feature branches |
| `feat/paarth/*` | Paarth's feature branches |
| `feat/atharva/*` | Atharva's feature branches |
| `feat/sara/*` | Sara's feature branches |

## Workflow

```bash
# 1. Always start from dev
git checkout dev && git pull origin dev

# 2. Create your branch
git checkout -b feat/anisha/driver-map

# 3. Work, commit often
git add frontend/src/components/driver/
git commit -m "feat(driver): add stop card animation"

# 4. Push and open PR to dev
git push origin feat/anisha/driver-map
# Open PR: feat/anisha/driver-map → dev

# 5. After code review, merge to dev
# 6. Before demo: dev → main (team lead only)
```

## Merge Conflict Prevention Rules

These rules are the reason conflicts are rare:

| Developer | Files they own exclusively |
|-----------|--------------------------|
| Anisha | `frontend/src/` (all of it) |
| Soham | `backend/services/` + `backend/app.py` |
| Paarth | `backend/models/` + `backend/tests/` |
| Atharva | `backend/routes/` + `backend/utils/` |
| Sara | `frontend/src/services/` + `frontend/src/hooks/` + `frontend/src/utils/` |

**Key rule: never edit a file outside your ownership zone without team lead approval.**

## Commit Message Format

```
feat(scope): short description
fix(scope): what was broken
chore(scope): non-feature work
test(scope): adding tests
```

Examples:
- `feat(optimizer): add copper-wire priority boost`
- `fix(voice): handle Twilio timeout gracefully`
- `feat(ui): animate truck fill meter`
