# Agent guidance

This repository is a **Model Context Protocol (MCP) server** exposing Google
Calendar and Google Tasks with read/write access over stdio. It is consumed
by the opencode configuration on this machine and uses the published Google
OAuth app shared with `system-scripts/backups`.

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
