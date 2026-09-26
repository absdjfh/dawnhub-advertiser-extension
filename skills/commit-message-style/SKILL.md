---
name: commit-message-style
description: Propose commit messages for Dawnhub Advertiser Tools that follow this repository's established wording and format. Use when the user asks for a commit message for the current uncommitted changes.
---

# Commit Message Style

Use the fixed conventions below, fixed on 2026-08-02. Do not inspect `git log` or other committed files.

## Input scope

Inspect only current uncommitted work:

1. Read `git status --short`.
2. Read the staged and unstaged diffs for the listed tracked files.
3. Read an untracked file only when it appears in `git status --short` and is part of the proposed commit.

Do not inspect prior commits, branch history, unrelated committed source files, or external issues. Do not stage, commit, amend, or push.

## Conventions

- Start with a capitalized imperative verb or concise present-tense outcome: `Add`, `Fix`, `Support`, `Update`, `Remove`, `Prevent`, `Show`, `Include`, `Keep`, or `Improve`.
- Describe the primary user-visible capability, bug fix, or maintenance outcome in plain English.
- For a purely technical change with no user-visible outcome, use `Chore: ` followed by a short description. Use it for internal maintenance such as tooling, dependency, CI, or test-only changes. Treat chore commits as intentionally omitted from automated release notes.
- Do not use Conventional Commit prefixes, scopes, ticket IDs, or a trailing period by default. `Chore:` is the exception for purely technical changes.
- Keep the subject short and direct. Use one sentence only; do not add a body unless the user asks.

Examples of the established style:

- `Add duplicate buyers detection for "Check all VIPs"`
- `Fix styles on low-width screens`
- `Show errors when spreadsheet fails to load`
- `Update node version on CI`
- `Chore: update test dependencies`

## Output

Return one recommended commit subject in a code span. Offer alternatives only when the current changes have two equally valid primary outcomes. If the diff contains unrelated features, say that it should be split and give one subject per coherent change.
