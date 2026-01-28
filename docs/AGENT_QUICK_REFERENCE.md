# Quick Reference for AI Agents

## Before Starting Work

1. **Claim the issue:** Comment "Working on this"
2. **Check conflicts:** Look for open PRs modifying same files
3. **Create branch:** `git checkout -b fix/123-description`

## During Work

- Write tests as you code
- No console.log (use proper logging)
- No hardcoded secrets
- Update issue with progress

## Before PR

- Tests pass ✅
- PR includes `Closes #123` ✅
- No conflicts with main ✅
- Files match issue scope ✅

## Critical: Database Migrations

- **Only ONE agent** works on migrations at a time
- Check latest migration number first
- Never modify existing migrations
- Test locally before PR

## If Conflicts

- Don't force push
- Rebase: `git pull origin main --rebase`
- Resolve carefully
- Test after resolving

## Emergency

- Broke something? Create fix PR immediately
- See broken code? Comment on PR, don't merge

**Full guide:** `docs/MULTI_AGENT_GUARDRAILS.md`
