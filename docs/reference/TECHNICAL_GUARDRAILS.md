# Technical Guardrails for Multi-Agent Workflows

These are technical implementations to enforce the guardrails automatically.

## ✅ Currently Implemented Automated Checks

The following automated checks are **already implemented** via GitHub Actions:

- ✅ **Security Scanning** (`.github/workflows/security-scan.yml`) - Checks for dependency vulnerabilities
- ✅ **Environment Variable Validation** (`.github/workflows/env-var-validation.yml`) - Ensures required env vars are documented
- ✅ **Code Quality Checks** (`.github/workflows/code-quality.yml`) - Flags console.log and TODO/FIXME comments
- ✅ **Test Suite** (`.github/workflows/test.yml`) - Runs automated tests on PRs
- ✅ **PR Size Check** (`.github/workflows/pr-size-check.yml`) - Warns about large PRs (500+ lines)
- ✅ **Dependency Update Check** (`.github/workflows/dependency-check.yml`) - Weekly checks for outdated packages
- ✅ **Database Schema Diff** (`.github/workflows/schema-diff.yml`) - Shows schema changes in PR comments
- ✅ **Stale Issues** (`.github/workflows/stale-issues.yml`) - Automatically manages stale issues

See [GitHub Actions Quick Wins](./github-actions-quick-wins.md) for details on all implemented workflows.

## 1. Branch Protection Rules (GitHub Settings)

**Recommended settings:**

- ✅ Require pull request reviews before merging
- ✅ Require status checks to pass before merging
- ✅ Require branches to be up to date before merging
- ✅ Require linear history (no merge commits)
- ✅ Do not allow force pushes
- ✅ Do not allow deletions

**How to set up:**
1. Go to Settings → Branches
2. Add rule for `main` branch
3. Enable above options

## 2. Pre-commit Hooks

**Install husky and lint-staged:**

```bash
pnpm add -D husky lint-staged
npx husky install
```

**Create `.husky/pre-commit`:**
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run lint-staged
npx lint-staged

# Run tests
npm test
```

**Add to `package.json`:**
```json
{
  "lint-staged": {
    "*.{js,ts}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{sql}": [
      "echo 'Check migration syntax manually'"
    ]
  }
}
```

**Why:** Catches issues before commit, prevents bad code from entering repo.

## 3. PR Template

**Create `.github/pull_request_template.md`:**

```markdown
## Description
<!-- Describe your changes -->

## Related Issue
<!-- Link to issue: Closes #123 -->

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Files Changed
<!-- List files you modified -->

## Testing
- [ ] Tests added/updated
- [ ] All tests pass locally
- [ ] Tested manually

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No console.log statements
- [ ] No hardcoded secrets
- [ ] Environment variables documented

## Database Changes
- [ ] Migration created (if applicable)
- [ ] Migration tested locally
- [ ] Rollback migration included (if breaking)
```

**Why:** Ensures consistent PR quality and required information.

## 4. Issue Templates

**Create `.github/ISSUE_TEMPLATE/feature.md`:**

```markdown
---
name: Feature Request
about: Request a new feature
title: '[FEATURE] '
labels: enhancement
assignees: ''
---

## Description
<!-- Describe the feature -->

## Files That Will Be Modified
<!-- List files you expect to touch -->

## Dependencies
<!-- Other issues/PRs this depends on -->

## Testing Plan
<!-- How will this be tested -->
```

**Why:** Ensures issues have required information for agents to work effectively.

## 5. Automated Dependency Checking

**GitHub Action to check for dependency conflicts:**

```yaml
name: Check Dependency Conflicts
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: |
          git fetch origin main:main
          git diff main...HEAD -- package.json | grep -E "^\+.*:" || echo "No dependency changes"
```

**Why:** Alerts when PRs modify dependencies that might conflict.

## 6. File Lock Detection

**GitHub Action to detect overlapping file changes:**

```yaml
name: Detect File Conflicts
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Check for overlapping changes
        run: |
          # Get files changed in this PR
          FILES=$(git diff --name-only origin/main...HEAD)
          
          # Check other open PRs for same files
          # (This would need GitHub API integration)
          echo "Files changed: $FILES"
```

**Why:** Warns when multiple PRs modify same files.

## 7. Migration Number Validation

**GitHub Action to validate migration numbers:**

```yaml
name: Validate Migration Numbers
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Check migration numbers
        run: |
          # Get latest migration number
          LATEST=$(ls database/*.sql | grep -E '^[0-9]+_' | sort -V | tail -1 | cut -d'_' -f1)
          
          # Check new migrations
          for file in $(git diff --name-only origin/main...HEAD | grep '\.sql$'); do
            NUM=$(echo $file | cut -d'_' -f1)
            if [ "$NUM" -le "$LATEST" ]; then
              echo "ERROR: Migration number $NUM conflicts with existing migrations"
              exit 1
            fi
          done
```

**Why:** Prevents migration number conflicts automatically.

## 8. API Contract Testing

**Automated API contract validation:**

```yaml
name: API Contract Tests
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Test API contracts
        run: |
          # Start server
          npm start &
          sleep 5
          
          # Run contract tests
          npm run test:contracts
```

**Why:** Ensures API changes don't break existing contracts.

## 9. Code Coverage Requirements

**Enforce minimum test coverage:**

```yaml
name: Coverage Check
on: [pull_request]
jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm test -- --coverage
      - run: |
          COVERAGE=$(npm test -- --coverage --json | jq '.coverageMap.total.lines.pct')
          if [ $(echo "$COVERAGE < 60" | bc) -eq 1 ]; then
            echo "Coverage too low: $COVERAGE%"
            exit 1
          fi
```

**Why:** Ensures tests are written with new code.

## 10. Secret Scanning

**GitHub's built-in secret scanning:**

- Already enabled by default
- Scans for API keys, passwords, tokens
- Blocks PRs with secrets

**Why:** Prevents accidental secret exposure.

## Implementation Priority

**High Priority (Do First):**
1. Branch protection rules
2. PR template
3. Issue templates
4. Pre-commit hooks

**Medium Priority:**
5. Migration number validation
6. Dependency conflict checking
7. API contract testing

**Low Priority (Nice to Have):**
8. File lock detection
9. Coverage requirements
10. Advanced conflict detection

## Setup Commands

```bash
# Install pre-commit hooks
pnpm add -D husky lint-staged
npx husky install

# Create PR template
mkdir -p .github
# (Copy template from above)

# Create issue templates
mkdir -p .github/ISSUE_TEMPLATE
# (Copy templates from above)
```

---

**Note:** These technical guardrails complement the process guardrails in `MULTI_AGENT_GUARDRAILS.md`. Use both together for maximum effectiveness.
