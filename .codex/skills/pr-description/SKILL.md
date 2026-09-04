---
name: pr-description
description: Write a pull-request title and body for the current repository branch from its complete diff against the base branch.
---

# Pull request description

Use this skill when the user asks for a PR title, PR body, or PR description.

## Workflow

1. Determine the base branch, defaulting to `main`.
2. Inspect the whole branch with `git log --oneline <base>..HEAD` and
   `git diff --stat <base>..HEAD`; summarize the branch, not only its latest commit.
3. Choose the title prefix using the repository convention (`feat`, `fix`, `refactor`, `perf`,
   `test`, `build`, `docs`, `chore`, `license`, `spec`, `plan`, `tasks`, or `constitution`).
4. Use an imperative, concise title: `<prefix>: <summary>` or
   `<prefix>(<scope>): <summary>`.

## Body structure

Include only sections that apply:

```markdown
## Summary

<Plain statement of the outcome and why it matters.>

## What's in this PR

- <Grouped change with relevant file or spec paths.>

## Testing

- `<command>` — <result>
- Manual checks — <result>
- <Honest note about anything not run or blocked>

## Notable decisions

- <Compatibility, design, or spec decisions reviewers should know.>

## Follow-ups

- <Known, deliberately deferred work; mark it non-blocking.>
```

Keep the body scannable. Do not paste large diffs. Report failures and skipped checks honestly;
never imply a green result for a command that was not run successfully. If the branch changes a
spec decision, link the relevant spec path and explain the decision in `Notable decisions`.
