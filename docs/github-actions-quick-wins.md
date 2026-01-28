# GitHub Actions Quick Wins

Here are some GitHub Actions workflows that are easy to set up and provide real value. Most of these take 5-30 minutes to implement and will save you time in the long run.

---

## 1. Dependency Security Scanning ⚡ (5 min)

This one's a no-brainer. Automatically scans your dependencies for known vulnerabilities on every PR. Takes 5 minutes to set up and catches security issues before they hit production. Once it's running, you don't have to think about it.

The workflow runs `npm audit` on every PR and blocks merges if it finds moderate or higher severity vulnerabilities. Super simple and prevents a whole class of security issues.

---

## 2. Environment Variable Validation ⚡ (10 min)

How many times have you deployed something and it failed because a required env var wasn't set? This checks that required env vars are documented in `.env.example` when PRs touch code that uses them. It's a simple check but saves a lot of "works on my machine" headaches.

The workflow verifies that `.env.example` exists and contains critical variables like `DATABASE_URL`, `OPENAI_API_KEY`, and `STRIPE_SECRET_KEY`. If any are missing, the PR gets blocked.

---

## 3. Code Quality Checks ⚡ (15 min)

This runs basic code quality checks on PRs - things like catching console.log statements (which you probably don't want in production) and flagging TODO/FIXME comments. It's not a full linter setup, but it catches the obvious stuff before code review. Helps maintain consistency without being too opinionated.

The workflow scans your code for console.log statements and flags TODO/FIXME comments. You can customize what it checks for - I included console.log and TODO checks, but you could add more rules based on your team's preferences.

---

## 4. Database Migration Validation ⚡ (20 min)

This one's important if you're doing database migrations. It validates SQL syntax on PRs that touch the `database/` directory. Broken migrations are a pain to fix in production, so catching syntax errors early is worth the setup time.

The workflow spins up a test Postgres instance and validates all SQL files in your database directory. It only runs when migration files are changed, so it doesn't slow down other PRs.

---

## 5. API Endpoint Smoke Tests ⚡ (30 min)

This is a basic smoke test - it starts your server and hits the `/health` endpoint to make sure nothing's completely broken. It's not comprehensive testing, but it catches server startup issues and basic endpoint failures. Good for catching "oops, I broke the server" moments before merge.

The workflow installs dependencies, starts the server, waits for it to be ready, and then tests the health endpoint. You can extend this to test more endpoints, but starting with the health check is a good baseline.

---

## 6. Auto-Deploy to Staging 🚀 (20 min)

This automatically deploys to a staging environment when code is merged to `main`. Having a staging environment that's always up-to-date is super useful for testing and demos. If you're using Vercel (which this project is), it's pretty straightforward to set up.

The workflow uses the Vercel GitHub Action to deploy to a preview environment whenever code is pushed to main. You'll need to set up Vercel secrets in your GitHub repo settings, but once that's done, deployments happen automatically.

---

## 7. PR Size Check ⚡ (5 min)

This warns when PRs are too large (I set it to 500+ lines). Large PRs are hard to review and more likely to have bugs. This doesn't block anything, just adds a comment warning that the PR might be too big. It's a gentle nudge to split things up.

The workflow calculates the diff size and adds a warning comment if the PR exceeds your threshold. You can adjust the threshold based on your team's preferences.

---

## 8. Dependency Update Check ⚡ (10 min)

This runs weekly (or on-demand) and checks if your dependencies are outdated. If they are, it creates a GitHub issue so you know about it. It's a good way to stay on top of updates without having to remember to check manually.

The workflow runs `npm outdated` on a schedule (weekly by default) and creates a GitHub issue if it finds outdated packages. You can adjust the schedule or make it more sophisticated if you want - maybe only flag security updates, or create separate issues for major vs minor updates.

---

## 9. Database Schema Diff Check ⚡ (15 min)

When someone changes database files, this shows a diff of what changed in the PR comments. It's helpful for reviewing schema changes - you can see exactly what tables/columns are being added/modified without having to dig through the SQL files. Simple but useful for visibility.

The workflow only runs when database files are changed, calculates the diff, and posts it as a summary in the GitHub Actions output. Makes it easy to see schema changes at a glance during code review.

---

## 10. Auto-Close Stale Issues 🔧 (5 min)

This automatically closes issues that haven't been updated in 60 days. It's optional - some teams like to keep all issues open, others prefer a cleaner tracker. If you want to keep things tidy, this helps.

The workflow runs daily and uses GitHub's stale action to mark issues as stale after 60 days, then closes them 7 days later if there's no activity. It gives people a chance to re-open if the issue is still relevant.

---

## What to Set Up First

If you're just getting started, I'd prioritize these:

**Week 1 (about 2 hours):**
1. Dependency Security Scanning - catches security issues automatically
2. Environment Variable Validation - prevents deployment failures
3. Code Quality Checks - catches obvious issues before review
4. PR Size Check - encourages smaller PRs

These are all quick wins that provide immediate value.

**Week 2 (about 3 hours):**
5. Database Migration Validation - prevents broken migrations
6. API Endpoint Smoke Tests - catches server startup issues
7. Auto-Deploy to Staging - always have a working staging env

These take a bit more setup but are worth it if you're doing migrations or want automated deployments.

**Week 3 (about 2 hours, nice to have):**
8. Dependency Update Check - stay on top of updates
9. Database Schema Diff Check - better visibility
10. Auto-Close Stale Issues - keep tracker clean

These are helpful but not critical.

---

## What You Get

**Immediate benefits:**
- Security vulnerabilities caught automatically (no more manual npm audit)
- Fewer "works on my machine" deployment failures
- Faster code review (automated checks catch obvious issues)

**Long-term benefits:**
- Better code quality over time
- Faster development cycles (less debugging production issues)
- Fewer production incidents
- Better visibility into what's changing

---

## Setup Time vs. Value

Here's a quick breakdown:

| Workflow | Setup Time | Value | Priority |
|----------|------------|-------|----------|
| Security Scan | 5 min | High | ⭐⭐⭐ |
| Env Var Check | 10 min | High | ⭐⭐⭐ |
| Code Quality | 15 min | Medium | ⭐⭐ |
| Migration Check | 20 min | High | ⭐⭐⭐ |
| Smoke Tests | 30 min | Medium | ⭐⭐ |
| Auto-Deploy | 20 min | High | ⭐⭐⭐ |
| PR Size Check | 5 min | Low | ⭐ |
| Dependency Check | 10 min | Medium | ⭐⭐ |
| Schema Diff | 15 min | Medium | ⭐⭐ |
| Stale Issues | 5 min | Low | ⭐ |

Total time for all workflows is about 2.5 hours, but you don't need to do them all at once. Start with the high-value ones (security scan, env var check) which take 15 minutes combined.

---

## Getting Started

1. Create a `.github/workflows/` directory in your repo
2. Set up the workflows you want (start with security scan and env var check)
3. Adjust the configs to match your setup (node version, file paths, thresholds, etc.)
4. Commit and push - GitHub will start running them automatically

You can add these incrementally - no need to set everything up at once. Start with what's most valuable for your workflow and add more as needed. Most of these are pretty standard GitHub Actions workflows, so you can find examples online if you need to customize them.
