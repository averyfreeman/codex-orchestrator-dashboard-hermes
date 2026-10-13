# Issue tracker: GitHub

Issues and specs live in GitHub Issues at `averyfreeman/codex-orchestrator-dashboard-hermes`. Run `gh` from the repository root; outside it, use `-R averyfreeman/codex-orchestrator-dashboard-hermes`.

## Conventions

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --json number,title,body,labels,comments`
- List: `gh issue list --state open`
- Link a child with GitHub sub-issues where supported; otherwise put `Part of #<parent>` in the child body.
- Track blockers with native issue dependencies; otherwise record `Blocked by: #<number>` in the issue.
- Add/remove labels with `gh issue edit`; comment with `gh issue comment`; close with `gh issue close`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

External pull requests are not an intake source for issue triage.

## When a skill says “publish to the issue tracker”

Create a GitHub issue.

## When a skill says “fetch the relevant ticket”

Read it with `gh issue view`.

## Wayfinding operations

Use one map issue labeled `wayfinder:map` with child issues for tickets. Use native GitHub dependencies for blockers where available; otherwise record blocker issue numbers in the body. Claim work by assignment and resolve it with an issue comment and closure.
