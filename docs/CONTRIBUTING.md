# Contributing to AutomateMyBlog Backend

Thank you for contributing! This guide will help you get started working on issues.

## 📋 For AI Coding Agents

**IMPORTANT: If you're an AI coding agent working on this project, please read these guides first:**

- **[Multi-Agent Guardrails](./MULTI_AGENT_GUARDRAILS.md)** - Essential rules for working with multiple agents simultaneously
- **[Agent Quick Reference](./AGENT_QUICK_REFERENCE.md)** - Quick checklist for before/during/after work
- **[Technical Guardrails](./TECHNICAL_GUARDRAILS.md)** - Automated enforcement and technical setup

**Key Rules for AI Agents:**
1. **Claim issues first** - Comment on issue before starting work
2. **Check for conflicts** - Look for open PRs modifying same files
3. **Database migrations** - Only ONE agent works on migrations at a time
4. **Follow branch naming** - Use `fix/123-description` format
5. **Write tests** - All PRs must include tests

See the [Multi-Agent Guardrails](./MULTI_AGENT_GUARDRAILS.md) for complete details.

## Getting Started

1. **Pick an Issue**
   - Browse the [Issues](https://github.com/james-frankel-123/automate-my-blog-backend/issues) page
   - Look for issues labeled `good first issue` or pick any issue that interests you
   - Comment on the issue to let others know you're working on it

2. **Set Up Your Environment**
   - Fork the repository (if you don't have write access)
   - Clone your fork: `git clone https://github.com/YOUR_USERNAME/automate-my-blog-backend.git`
   - Install dependencies: `pnpm install`
   - Set up environment variables (see `.env.example`)

3. **Create a Branch**
   ```bash
   git checkout -b fix/issue-number-short-description
   # Example: git checkout -b fix/123-add-retry-logic
   ```

4. **Work on the Issue**
   - **AI Agents:** Read [Multi-Agent Guardrails](./MULTI_AGENT_GUARDRAILS.md) first
   - Read the issue description carefully
   - Check the "References" section for related documentation
   - **Check for conflicts:** Look for open PRs modifying same files
   - **Database changes:** Coordinate migrations (see guardrails)
   - Implement the changes
   - Test your changes locally
   - Follow the code style and conventions (see below)

5. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "Fix: Add retry logic with exponential backoff (closes #123)"
   ```
   - Use clear, descriptive commit messages
   - Reference the issue number in your commit message

6. **Open a Pull Request**
   - Push your branch: `git push origin fix/issue-number-short-description`
   - Go to the repository on GitHub
   - Click "New Pull Request"
   - Select your branch
   - In the PR description, include: `Closes #123` (replace with your issue number)
   - This will automatically link the PR to the issue and close it when merged

## Code Style & Conventions

- **TypeScript**: Use strict mode, prefer `interface` over `type` for object shapes
- **Error Handling**: Always handle errors explicitly, use try-catch for async operations
- **Testing**: Add tests for new features (see `docs/testing-strategy.md`)
- **Documentation**: Update relevant docs if you change functionality
- **Commits**: Write clear, descriptive commit messages

## PR Requirements

Before opening a PR, make sure:
- [ ] **AI Agents:** Followed [Multi-Agent Guardrails](./MULTI_AGENT_GUARDRAILS.md)
- [ ] Your code follows the project's style guidelines
- [ ] You've tested your changes locally
- [ ] You've added tests if applicable
- [ ] Your PR description includes `Closes #<issue-number>`
- [ ] You've checked for any linting errors
- [ ] **Database migrations:** Checked migration number doesn't conflict
- [ ] **File conflicts:** No other PRs modifying same files

## CI/CD Checks

When you open a PR, the following automated checks will run:

- ✅ **Security Scan** - Checks for dependency vulnerabilities (`npm audit`)
- ✅ **Environment Variables** - Validates required env vars are documented in `.env.example`
- ✅ **Code Quality** - Checks for console.log statements and TODO/FIXME comments
- ✅ **Tests** - Runs the test suite (unit and integration tests)
- ✅ **PR Size Check** - Warns if PR exceeds 500 lines (non-blocking)
- ✅ **Schema Diff** - Shows database schema changes in PR comments (when database files change)

All checks must pass before your PR can be merged. The PR size check is a warning only and won't block merging.

## Getting Help

- Check existing issues and PRs for similar work
- Review the documentation in the `docs/` folder
- **AI Agents:** See [Agent Quick Reference](./AGENT_QUICK_REFERENCE.md) for common scenarios
- Ask questions in the issue comments

## Additional Resources

**For AI Coding Agents:**
- [Multi-Agent Guardrails](./MULTI_AGENT_GUARDRAILS.md) - Complete workflow rules
- [Agent Quick Reference](./AGENT_QUICK_REFERENCE.md) - Quick checklist
- [Technical Guardrails](./TECHNICAL_GUARDRAILS.md) - Automated enforcement setup

**For All Contributors:**
- [Testing Strategy](./testing-strategy.md) - Testing guidelines and setup
- [Backend Audit](./backend-audit.md) - Current state and known issues
- [Analytics & Growth Plan](./analytics-and-growth-plan.md) - Implementation roadmap
- [GitHub Actions Quick Wins](./github-actions-quick-wins.md) - CI/CD improvements

## Issue Categories

Issues are organized by category:
- **Analytics & Growth**: Event tracking, dashboard metrics, recommendations
- **Email**: SendGrid integration, email templates, preferences
- **Reliability**: Error handling, retry logic, logging, monitoring
- **Testing**: Test framework setup, test coverage
- **CI/CD**: GitHub Actions workflows (see [GitHub Actions Quick Wins](./github-actions-quick-wins.md) for implemented workflows)
- **Tech Debt**: Code improvements, optimizations

Pick issues that match your interests and skill level!

## Automated Workflows

This repository uses several automated GitHub Actions workflows:

- **Security Scanning** - Runs on every PR to check for dependency vulnerabilities
- **Environment Variable Validation** - Ensures required env vars are documented
- **Code Quality Checks** - Flags console.log and TODO/FIXME comments
- **Test Suite** - Runs automated tests on every PR
- **PR Size Check** - Warns about large PRs (non-blocking)
- **Dependency Update Check** - Weekly check for outdated packages (creates issues)
- **Database Schema Diff** - Shows schema changes in PR comments
- **Stale Issues** - Automatically manages stale issues

See [GitHub Actions Quick Wins](./github-actions-quick-wins.md) for details on all workflows.
