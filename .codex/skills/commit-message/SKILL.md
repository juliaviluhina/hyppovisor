---
name: commit-message
description: Write or amend commit messages for this repository using its prefix convention and required attribution footer.
---

# Commit messages

Use this skill when the user asks to commit changes or draft a commit message.

## Workflow

1. Inspect the staged diff and status. If nothing is staged and no target was given, inspect
   `git diff` and `git status` before drafting.
2. Choose one prefix that describes the primary purpose: `feat`, `fix`, `refactor`, `perf`,
   `test`, `build`, `docs`, `chore`, `license`, `spec`, `plan`, `tasks`, or `constitution`.
3. Use `prefix(scope): summary` only when the scope adds clarity. Feature numbers such as `018`
   are valid scopes.
4. Write an imperative, lowercase subject of about 70 characters or fewer, without a period.
5. Add a short body when the reason or tradeoff is not obvious from the subject. Explain why;
   do not restate the diff.
6. Preserve the repository's attribution footer on every commit. Copy the exact footer values
   from a recent commit unless the user provides different ones:

   ```text
   Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
   Claude-Session: <session url>
   ```

When asked to commit, perform the commit after reviewing the staged scope. Do not stage unrelated
files without user authorization.
