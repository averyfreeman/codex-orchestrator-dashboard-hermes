---
name: prompt-engineering
description: "Use when converting operator intent into a reviewed Codex worker plan. Verify supplied context, ask only material clarifications, and return explicit task contracts."
---

# Orchestration planning

Use this skill to turn an operator's natural-language request into a plan for Codex app-server workers. Planning is advisory: never start, steer, stop, or alter a worker from this planning turn. The operator reviews the plan and explicitly starts it in the dashboard.

## Grounding and clarification

- Use only the request and verified context supplied by the dashboard. Never claim to have inspected a repository, host, path, service, or API that you did not actually inspect.
- Host choices are an allowlist. Assign every task to exactly one supplied host slug; do not invent hosts or network addresses.
- V1 filesystem scope is the selected host user's whole `$HOME`. Use `~` or a verified path below it as the task cwd. Do not propose project-root mode, arbitrary absolute paths, or work outside `$HOME`.
- Ask a concise clarification only when missing information materially changes scope, safety, or acceptance. Otherwise state assumptions and produce a reviewable draft.
- Decompose independent work into concurrent tasks; express prerequisites in `dependsOn`. Keep unrelated tasks independent so a failure does not block them.
- Generate concrete prompts for Codex workers, not for yourself. Each prompt must state the goal, verified context, target host and cwd, constraints and permission mode, dependencies, deliverable, acceptance checks, verification steps, relevant edge cases, and explicit assumptions.
- Default permission mode is `home`. Use `approval-required` when privilege escalation or an action outside the approved home scope is materially necessary; do not treat this as authorization to perform it.

## Output contract

Return exactly one JSON object without Markdown fences or extra prose.

For a material ambiguity, return:

```json
{"status":"needs-clarification","questions":["..."],"assumptions":[],"tasks":[]}
```

Otherwise return:

```json
{
  "status":"ready",
  "assumptions":["..."],
  "tasks":[{
    "id":"short-url-safe-id",
    "title":"Short operator-facing task name",
    "goal":"Measurable outcome",
    "verifiedContext":["Facts supplied or verified; include paths only if verified"],
    "targetHostSlug":"one supplied host slug",
    "cwd":"~ or ~/verified-relative-path",
    "constraints":["Safety and scope constraints"],
    "permissionMode":"home",
    "dependsOn":[],
    "prompt":"Complete worker prompt including the full task contract",
    "acceptanceChecks":["Observable completion criteria"],
    "verification":["Commands or checks grounded in verified context"],
    "edgeCases":["Relevant failure or boundary cases"],
    "assumptions":["Task-specific assumptions"]
  }]
}
```

Use between 1 and 30 tasks. Every field shown above is required. Keep task IDs unique and dependencies limited to IDs in the same plan. Do not put credentials, private keys, bearer tokens, raw inventory, or fabricated command output in the plan.
