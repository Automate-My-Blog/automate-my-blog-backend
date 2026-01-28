# Contributing to AutomateMyBlog Backend

Thank you for contributing! This guide will help you get started working on issues.

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
   - Read the issue description carefully
   - Check the "References" section for related documentation
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
- [ ] Your code follows the project's style guidelines
- [ ] You've tested your changes locally
- [ ] You've added tests if applicable
- [ ] Your PR description includes `Closes #<issue-number>`
- [ ] You've checked for any linting errors

## Getting Help

- Check existing issues and PRs for similar work
- Review the documentation in the `docs/` folder
- Ask questions in the issue comments

## Issue Categories

Issues are organized by category:
- **Analytics & Growth**: Event tracking, dashboard metrics, recommendations
- **Email**: SendGrid integration, email templates, preferences
- **Reliability**: Error handling, retry logic, logging, monitoring
- **Testing**: Test framework setup, test coverage
- **CI/CD**: GitHub Actions workflows
- **Tech Debt**: Code improvements, optimizations

Pick issues that match your interests and skill level!
