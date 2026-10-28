---
name: koto
description: Use Koto's CLI for Koto setup, coding-agent orchestration, and preparing or reviewing Koto project plans and sessions.
---

# Koto

Use Koto's published CLI as the orchestration engine. This skill guides its use;
Koto owns account discovery, plans, agent sessions, review and integration.

## Use the published CLI

Resolve the actual project first. Create a private empty invocation directory
outside the project and run every command below with that directory as its
working directory. Pass absolute project, task, plan and session paths. This
prevents npm from selecting a same-named package in the current project instead
of the published release. Keep the invocation directory separate from artifacts.

Run the pinned package instead of a possibly unrelated global `koto` executable:

```sh
npx --yes --registry=https://registry.npmjs.org/ --package=@mehrdadz/koto@3.0.0-alpha.0 -- koto --version
```

Use that full prefix for every Koto call. Node.js 22+ and Git are prerequisites.
Respect the host's network and execution permissions; report a blocked package
fetch rather than substituting another engine or claiming a CLI operation ran.
Use finite command deadlines and retain the actual output and exit status.

## Choose the requested workflow

- **Prepare or check a plan:** read [the CLI workflow](references/cli-workflow.md),
  inspect the actual project, create its task specification, then run the real
  `plan build` and `plan check` commands. Return the files and readiness result.
  A plan-only request ends there, before agent launch.
- **Run project work or inspect a saved session:** read the same reference for
  explicit start, status, contribution review and token-approved integration.
  Use existing user authorization; requesting a plan alone does not authorize
  launching agents, spending provider usage or integrating their work.
- **Onboard, select subscriptions or add local models:** run the pinned command
  with no arguments in a real terminal the user can operate. Koto discovers
  native Codex/ChatGPT and Claude Code logins; no provider API key is required.
  Select the actual project at Koto's prompt; the invocation directory is not it.
  Let the user perform native sign-in and approve any client/model installation.
  Local models are optional. The normal CLI remembers the selected setup.

## Keep the user's boundaries

Keep native credentials with their native clients. Preserve their permission
checks; use a user-operated terminal when native approval/input is needed.
Authorize only the requested operation: launch, integration, model acquisition,
account changes and publication are distinct actions. A skill invocation does
not grant permission to deploy, publish, alter accounts or bypass approvals.
Keep plans, prompts, native output and session paths private. Preserve existing
project changes and retained failure/cleanup records.

Report what actually happened: a generated plan is not a launch; preflight is
not authentication or model access; process completion is not useful correct
work. Show blocking prerequisites and the next applicable action. After a
plan-only request, report the absolute artifact paths and leave execution to
the user's requested next step.
