# Recent updates

Short summary of recent changes to CI and deployment.

**Migration validation**  
When you change any file in `database/`, CI runs all migrations against a test Postgres instance. If any SQL fails, the PR fails. See [GitHub Actions Quick Wins](./github-actions-quick-wins.md).

**Smoke test**  
On every push and PR, CI starts the server and calls `GET /health`. If the server doesn’t start or health returns an error, the run fails. See [GitHub Actions Quick Wins](./github-actions-quick-wins.md).

**Vercel: only build production**  
We only deploy from `main`. PRs and other branches should not trigger a Vercel build. In the Vercel project, set **Ignore Build Step** to the inline command in [Vercel: Only Build Production](./vercel-preview-builds.md) so only production builds run.
