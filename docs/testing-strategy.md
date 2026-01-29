# Testing Strategy - Pre-Implementation

Before we start adding analytics, SendGrid, and recommendations, we need a safety net. Right now there are no automated tests - the test script just echoes an error. That means any changes we make could break production and we wouldn't know until users complain.

---

## Current State

The situation is:
- No test framework installed
- No automated test suite
- Test script just prints "Error: no test specified"
- There are manual test scripts (`test-*.js` files) but they're not run automatically
- Some one-off test files for specific features, but nothing comprehensive

The risk here is obvious - if we make changes without tests, we could break production and not realize it until users report issues. That's not a great place to be.

---

## What to Test First

I'd prioritize tests in this order:

### 1. Critical Path Tests

These are the core flows that absolutely cannot break. If any of these fail, the product doesn't work or you lose money.

**Authentication & Authorization:**
Start here because if auth breaks, nothing else matters. Test user registration, login, JWT validation, session management, and that users can only access their own organizations. The audit found some potential issues with data access boundaries, so this is important.

**Content Generation Pipeline:**
This is the core product - if blog generation breaks, you have no product. Test the website analysis endpoint, blog generation endpoint, blog post CRUD, and organization context loading. These are complex flows with lots of moving parts, so they're prone to breakage.

**Billing:**
Money stuff. Test Stripe webhook handling, subscription creation/updates, and credit tracking. If billing breaks, you lose revenue and users get angry.

Why these first? They're the money-making features. Auth breaks = users can't log in. Generation breaks = product doesn't work. Billing breaks = you lose revenue.

### 2. Data Integrity Tests

Test database operations - multi-tenant isolation (users can't see other orgs' data), foreign key constraints, session adoption (anonymous → authenticated), and referral system data consistency.

The audit found potential issues with data access boundaries, so we need to verify org/user filtering actually works. This is important for security and data integrity.

### 3. API Contract Tests

Test that endpoints return what they're supposed to - request/response schemas, error handling (400, 401, 404, 500), required vs optional fields, rate limiting behavior.

When we add analytics tracking and SendGrid, we'll be touching a lot of endpoints. These tests ensure we're not breaking existing API contracts that the frontend depends on.

### 4. Integration Tests

Test external services - OpenAI API calls (with mocks), Stripe webhook processing, database connection handling, web scraping (with test URLs).

These are the most likely to fail in production. The audit found no retry logic, so we need to test error handling and make sure things fail gracefully.

---

## Test Framework Options

**Jest** (recommended)
Most popular for Node.js, good mocking support, built-in coverage, easy to set up. It's battle-tested and has great tooling. The ecosystem is huge, so you'll find examples and help easily.

**Vitest**
Faster than Jest, Jest-compatible API, good for ES modules (which this project uses). If speed becomes an issue later, you can migrate from Jest pretty easily.

**Node Test Runner** (built-in)
No dependencies, simple but limited. Good for basic tests but you'll probably outgrow it quickly.

I'd start with Jest. It's the safe choice and you can always migrate to Vitest later if you need more speed. The setup time is about the same either way.

---

## Test Structure

I'd organize tests like this:

- `tests/unit/` - Test individual functions/services in isolation
- `tests/integration/` - Test API endpoints and database operations
- `tests/e2e/` - Test full user flows (add these later, they're slower)

Start with unit and integration tests. E2E tests are nice but they're slow and flaky, so save those for later when you have the basics covered.

---

## Minimum Viable Test Suite

Before making changes, at minimum you need:

**Must Have:**

1. **Auth Tests** - Registration creates user and organization, login returns valid JWT, protected routes require auth, users can only access their own data. This is critical - if auth breaks, everything breaks.

2. **Content Generation Tests** - Generation endpoint accepts valid input, returns blog post structure, saves to database correctly, handles errors gracefully. This is the core product, so it needs to work.

3. **Database Tests** - Multi-tenant isolation works, foreign keys prevent orphaned records, session adoption doesn't break data. The audit found potential issues here, so verify it works.

**Should Have:**

4. **API Contract Tests** - All endpoints return expected structure, error responses are consistent, required fields are validated. When we add new features, these ensure we don't break existing contracts.

5. **Integration Tests** - Stripe webhooks process correctly, database connections handle failures, external API calls have retries. These are the things that fail in production.

---

## Implementation Plan

### Foundation

**Setup**
Install Jest and testing dependencies, set up a test database (separate from production), create test utilities (helpers, mocks), configure test scripts in package.json. This is the boring infrastructure work, but it's necessary.

**Critical Path Tests**
Write auth tests (registration, login, JWT), write content generation smoke tests, write database isolation tests. These are the most important ones - get these working first.

**CI Integration**
Add test step to GitHub Actions, set up test database in CI, ensure tests run on PRs. Once this is done, tests run automatically and catch issues before merge.

### Coverage Expansion

Add API contract tests for all endpoints, integration tests for external services, error handling tests, edge case tests. Expand coverage gradually - don't try to test everything at once.

---

## Test Coverage Goals

Don't obsess over coverage percentages, but here are some targets:

**Before implementing changes:** 60%+ coverage on critical paths (auth, generation, billing), 40%+ overall coverage. This gives you a safety net.

**After implementing analytics/growth features:** 70%+ coverage on critical paths, 50%+ overall coverage. As you add features, add tests.

**Long-term:** 80%+ coverage on critical paths, 60%+ overall coverage. This is a good place to be - you don't need 100% coverage, just enough to catch real issues.

---

## What NOT to Test (Yet)

Skip these for now - they're nice to have but not essential:

- Full E2E tests (too slow, flaky, hard to maintain)
- Visual regression tests (not applicable for backend)
- Performance tests (add later when you have performance issues)
- Load tests (add when you're scaling)

Focus on what matters: unit tests for business logic, integration tests for API endpoints, database operation tests. These give you the most bang for your buck.

---

## Testing Best Practices

**Do:**
- Test behavior, not implementation - test what the code does, not how it does it
- Use descriptive test names - "should register user and create organization" is better than "test1"
- Mock external services (OpenAI, Stripe) - don't hit real APIs in tests
- Test error cases, not just happy paths - errors happen, test them
- Keep tests fast - unit tests should run in < 5 seconds total

**Don't:**
- Test framework code - Jest works, you don't need to test it
- Test third-party libraries - they have their own tests
- Write tests that depend on each other - each test should be independent
- Use real API keys in tests - use mocks or test keys

---

## Risk Assessment

**Without Tests:**
High risk of breaking production, no way to verify changes work, hard to refactor safely, bugs discovered by users (not ideal). This is where you are now.

**With Basic Test Suite:**
Medium risk - can catch most issues, can verify critical paths work, can refactor with some confidence, bugs caught before production. This is a good starting point.

**With Comprehensive Test Suite:**
Low risk - high confidence in changes, can verify all functionality, can refactor safely, bugs caught in development. This is the goal, but you don't need to get here immediately.

---

## Recommendation

Yes, build tests first. Here's why:

1. **Safety Net** - The audit found reliability issues. Tests will catch regressions when we fix them.

2. **Confidence** - Adding analytics tracking and SendGrid touches a lot of code. Tests ensure we don't break existing functionality.

3. **Speed** - Tests actually speed up development long-term. You can make changes faster when you know tests will catch mistakes.

4. **Documentation** - Tests serve as living documentation of how the system works. New developers can read tests to understand the codebase.

**Minimum:** At least get auth and content generation tests in place before touching those areas. Those are the highest-risk changes - if you break auth, users can't log in. If you break generation, the product doesn't work.

---

## Quick Start

1. **Install Jest** - `npm install --save-dev jest @jest/globals`

2. **Add test scripts to package.json** - Add `test`, `test:watch`, and `test:coverage` scripts that run Jest with NODE_ENV=test

3. **Create your first test** - Start with an auth test in `tests/integration/api/auth.test.js`. Test user registration first - it's straightforward and you'll learn the patterns.

4. **Set up test database** - Use a separate test database (don't use production!), reset between tests (or use transactions), seed with test data so tests are predictable.

The first test is the hardest - once you have the pattern down, the rest come easier.

---

## Next Steps

1. Decide on test framework (Jest is the safe choice)
2. Set up test infrastructure (database, mocks, helpers)
3. Write critical path tests (auth, generation)
4. Add to CI (GitHub Actions - there's a workflow for this in the quick wins doc)
5. Then proceed with analytics/growth implementation

The time invested in tests will pay off when you're making changes and know they won't break production. It feels like extra work upfront, but it's worth it.
