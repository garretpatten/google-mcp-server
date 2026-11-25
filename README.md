<!-- markdownlint-disable MD033 MD041 -->

<p align="center">
  <img src="https://img.shields.io/badge/google%20mcp-server-4285F4?style=for-the-badge&logo=googlecalendar&logoColor=white" alt="Google MCP Server project badge" />
</p>

<h1 align="center">Google MCP Server</h1>

<p align="center"><strong>Google Calendar and Google Tasks for <a href="https://opencode.ai">opencode</a>, over the Model Context Protocol.</strong></p>

<p align="center">
A stdio MCP server exposing <strong>read/write</strong> access to Google Calendar
(personal, shared, and subscribed) and every Google Tasks list,<br />
authenticating with a published Google OAuth app.
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/garretpatten/google-mcp-server?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/transport-stdio-34A853?style=flat-square&logo=modelcontextprotocol&logoColor=white" alt="stdio transport" />
  <img src="https://img.shields.io/badge/runtime-node%20%3E%3D%2024-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 24+" />
  <a href="https://m8ven.ai/mcp/garretpatten/google-mcp-server?s=readme"
      ><img src="https://m8ven.ai/badge/mcp/garretpatten/google-mcp-server?variant=live" alt="M8ven ⚡ Live: C · Emerging"
  /></a>
</p>

<p align="center">
  <a href="https://github.com/garretpatten/google-mcp-server/actions/workflows/tests.yaml"
      ><img src="https://img.shields.io/github/actions/workflow/status/garretpatten/google-mcp-server/tests.yaml?branch=master&label=tests&logo=github&style=flat-square" alt="Tests workflow status"
  /></a>
  <a href="https://github.com/garretpatten/google-mcp-server/actions/workflows/quality-checks.yaml"
      ><img src="https://img.shields.io/github/actions/workflow/status/garretpatten/google-mcp-server/quality-checks.yaml?branch=master&label=quality&logo=github&style=flat-square" alt="Quality checks workflow status"
  /></a>
  <a href="https://github.com/garretpatten/google-mcp-server/actions/workflows/security-guardrails.yaml"
      ><img src="https://img.shields.io/github/actions/workflow/status/garretpatten/google-mcp-server/security-guardrails.yaml?branch=master&label=security&logo=github&style=flat-square" alt="Security guardrails workflow status"
  /></a>
</p>

<!-- markdownlint-enable MD033 MD041 -->

---

## Overview

[garretpatten/google-mcp-server](https://github.com/garretpatten/google-mcp-server) is a
[Model Context Protocol](https://modelcontextprotocol.io) server that lets an AI agent
read and organize Google Calendar and Google Tasks. It is consumed by the opencode
configuration on this machine and reuses the same OAuth app as
[system-scripts/backups](https://github.com/garretpatten/system-scripts).

## Features

- **Calendars** — personal, shared, and subscribed calendars all surface through the
  Google Calendar `calendarList`.
  - List calendars and events (time ranges, text search), read single events.
  - Create, update, delete events; respond to invitations (RSVP).
- **Tasks** — every task list is supported.
  - List task lists and tasks (completed/deleted/hidden filters), read tasks.
  - Create, update, complete, move, and delete tasks.
- **Safe by default** — reads run without prompting; opencode asks before any write
  tool (create, update, delete, RSVP, move).
- **Lightweight** — plain REST calls via `fetch` over stdio; no heavy Google client SDK.

## Quick start

### Prerequisites

- Node.js >= 24
- Google Cloud OAuth client (client ID and secret) — the same published app used by
  `system-scripts/backups`

### Installation

1. **Clone and install**

   ```sh
   git clone https://github.com/garretpatten/google-mcp-server
   cd google-mcp-server
   npm install
   ```

2. **Configure OAuth** — copy `.env.example` to `.env` and set `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`.

3. **Authorize once** — run the interactive consent flow; the browser opens with the
   full read/write Calendar and Tasks scopes and the refresh token is written back to
   `.env`:

   ```sh
   npm run auth
   ```

4. **Build**

   ```sh
   npm run build
   ```

## opencode integration

Add the server to `opencode.jsonc`:

```jsonc
"mcp": {
  "google": {
    "type": "local",
    "command": ["node", "/home/garret/Projects/google-mcp-server/dist/index.js"],
    "enabled": true
  }
}
```

Read tools are allowed without prompting; write tools are configured to ask in the
opencode permission settings.

## Tools

| Tool                    | Type  | Description                                              |
| ----------------------- | ----- | -------------------------------------------------------- |
| `calendar_list`         | read  | List accessible calendars (personal, shared, subscribed) |
| `calendar_events`       | read  | List events in a calendar with time range/search         |
| `calendar_event`        | read  | Get a single event                                       |
| `calendar_create_event` | write | Create an event                                          |
| `calendar_update_event` | write | Update an event                                          |
| `calendar_delete_event` | write | Delete an event                                          |
| `calendar_respond`      | write | Accept/decline an invitation (RSVP)                      |
| `tasks_lists`           | read  | List task lists                                          |
| `tasks_list_tasks`      | read  | List tasks in a task list                                |
| `tasks_create`          | write | Create a task                                            |
| `tasks_update`          | write | Update a task                                            |
| `tasks_complete`        | write | Mark a task completed                                    |
| `tasks_move`            | write | Move a task to another list/position                     |
| `tasks_delete`          | write | Delete a task                                            |

## Security

OAuth credentials live in the git-ignored `.env`. The server refreshes access tokens
automatically and never logs secrets. `npm run auth` writes `.env` with owner-only
(0600) permissions; if you create the file by hand, run `chmod 600 .env`. If the
refresh token is revoked, run `npm run auth` again.

See [SECURITY.md](SECURITY.md) for reporting a vulnerability.

## Development

```sh
npm test
npm run typecheck
npm run lint:eslint
```

## License

[MIT](LICENSE)
