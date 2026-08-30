---
name: "pr-description"
description: "Write a pull request title and description for the current branch using this repo's convention. Use whenever asked for a PR title, PR body, or PR description."
argument-hint: "Optional: base branch (default: main) or extra context"
user-invocable: true
disable-model-invocation: false
---

# PR title and description

Produce a PR title and body for the current branch against its base (default `main`).
First run `git log --oneline <base>..HEAD` and `git diff --stat <base>..HEAD` to see the
full scope — the PR summarizes the whole branch, not the latest commit.

## Title

Same prefix convention as commit messages (see the `commit-message` skill for the prefix
table): `<prefix>: <summary>`, optional `<prefix>(<scope>):`. Pick the prefix for the
branch's primary purpose. It should read as the message this branch would carry if
squash-merged.

Examples:

```
feat(001): Open Any URL — HyppoVisor's browser + MCP primitive
fix: make a fresh clone build and launch on Node 26
docs: restructure the MCP setup guide
```

## Description

Markdown. Include the sections that apply; omit the ones that don't. Keep it scannable —
a reviewer should get the shape in 30 seconds.

```markdown
## Summary

One short paragraph: what this branch delivers and why. Name the feature / spec if there
is one.

## What's in this PR

Grouped bullets by area (governance, spec artifacts, implementation, tooling, …). Link
files or spec sections. This is the map, not the full story.

## Testing

What was run and the result — `npm test`, `npm run test:e2e`, `npm run build`, lint.
Call out anything verified manually and anything that could NOT be verified.

## Notable decisions

Design calls a reviewer should know about, especially where the branch revised an earlier
decision (link the spec/research section it changes). Skip if there are none.

## Follow-ups

Known work deliberately left out of this PR, marked not-blocking.
```

## Rules

- The Summary states the outcome plainly — no hedging, no "attempts to".
- Under "Testing", report failures and skipped steps honestly; don't imply green if it
  isn't.
- If the branch touched the constitution or a spec decision, "Notable decisions" MUST
  mention it and link the section.
- Don't paste large diffs or full file contents into the body.
- Match the depth to the branch: a one-commit fix gets a title + a two-line Summary, not
  the full skeleton.

## Steps

1. `git log --oneline <base>..HEAD` and `git diff --stat <base>..HEAD`.
2. Choose the title prefix from the branch's primary purpose.
3. Draft the title.
4. Fill only the description sections that apply.
5. Output the title and body in fenced blocks, ready to paste into the PR.
