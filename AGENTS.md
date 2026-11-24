# Agent guidance

This repository is a **Model Context Protocol (MCP) server** exposing Google
Calendar and Google Tasks with read/write access over stdio. It is consumed
by the opencode configuration on this machine and uses the published Google
OAuth app shared with `system-scripts/backups`.

## Repository standards

[garretpatten/github-standards](https://github.com/garretpatten/github-standards) is the
**canonical source of truth** for how every `garretpatten` repository must be structured
and maintained: license, security policy, contributing, community files, README
branding, CODEOWNERS, branch protection, pull requests, signed commits, Dependabot,
dependency hygiene, secret hygiene, workflow permissions, action pinning, repository
metadata, CI and quality, and exceptions.

- **Before starting any task**, read the current standards from the source of truth
  rather than from memory or a cached copy — they change over time. The standards index
  is at <https://github.com/garretpatten/github-standards#standards-files>; fetch raw
  files from
  `https://raw.githubusercontent.com/garretpatten/github-standards/master/<standard>.md`
  (via web fetch, `curl`, or `gh api`) and read every standard relevant to the task.
- **While working**, apply the standards to every change: workflows, dependency files,
  community files, repository metadata, and commit practices must conform to the
  standards as they exist at the time of the change.
- **When you detect drift** — this repository lagging behind a standard that changed —
  bring the repository back in line as part of normal work and call it out in your
  summary. If an update would be large or ambiguous, propose it instead of applying it
  silently.
- **Before finishing**, confirm the work satisfies the
  [verification](https://github.com/garretpatten/github-standards/blob/master/verification.md)
  standard and that local checks pass.
- For a full compliance review, use the `github-audit` skill, which audits a repository
  against these standards and reports numbered findings.

## Layout

- **`src/`** — TypeScript (ESM, NodeNext) sources
  - `index.ts` — MCP stdio server entry point and tool registration
  - `config.ts` — `.env` loading and credential resolution
  - `http.ts` — minimal fetch-based HTTP client
  - `google-auth.ts` — OAuth token refresh and one-time interactive
    authorization (loopback redirect), adapted from
    `system-scripts/backups/src/google-auth.ts`
  - `google-calendar.ts` — Google Calendar API client
  - `google-tasks.ts` — Google Tasks API client
  - `tools.ts` — MCP tool definitions, JSON schemas, and handlers
  - `auth-cli.ts` — `npm run auth` entry point for the consent flow
- **`tests/`** — Vitest unit tests (HTTP is mocked; no live Google calls)

## Conventions

- TypeScript ESM with `NodeNext` module resolution; import specifiers include
  the `.js` extension.
- Match the logging/error style of `system-scripts/backups`: clear error
  messages, no secrets in logs.
- Keep tool names grouped by prefix (`calendar_*`, `tasks_*`); read tools
  start with `calendar_list`, `calendar_events`, `calendar_event`,
  `tasks_lists`, `tasks_list_tasks` and are allowed in opencode; everything
  else prompts.
- Prettier (100 cols, single quotes), ESLint, markdownlint-cli2, and yamllint
  are enforced in CI.

## What to do when editing

1. Read the touched module and its tests before changing behavior.
2. Keep API pagination handling consistent with the existing clients.
3. Run `npm test` and `npm run typecheck` after changes.
4. Update `README.md` when tools, setup, or behavior change.

## Out of scope

- Do not add tooling beyond what is already configured without a strong
  reason.
- Never commit `.env`, tokens, or client secrets.
