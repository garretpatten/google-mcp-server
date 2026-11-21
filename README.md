# google-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
**Google Calendar** and **Google Tasks** with read/write access over stdio.
It is consumed by the [opencode](https://opencode.ai) configuration on this
machine, and authenticates with the published Google OAuth app used by
[system-scripts/backups](https://github.com/garretpatten/system-scripts).

## Features

- **Calendars** — personal, shared, and subscribed calendars are all visible
  through the Google Calendar API `calendarList`.
  - List calendars and events (time ranges, text search), read single events.
  - Create, update, delete events; respond to invitations (RSVP).
- **Tasks** — every task list is supported.
  - List task lists and tasks (completed/deleted/hidden filters), read tasks.
  - Create, update, complete, move, and delete tasks.

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and set `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` (same values as `system-scripts/.env`).

3. Run the one-time interactive consent flow. The browser opens with the
   full read/write Calendar and Tasks scopes; the resulting refresh token is
   written back to `.env`:

   ```sh
   npm run auth
   ```

4. Build:

   ```sh
   npm run build
   ```

## opencode integration

Add to `opencode.jsonc`:

```jsonc
"mcp": {
  "google": {
    "type": "local",
    "command": ["node", "/home/garret/Projects/google-mcp-server/dist/index.js"],
    "enabled": true
  }
}
```

Read tools are allowed without prompting; write tools are configured to ask
in the opencode permission settings.

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

OAuth credentials live in the git-ignored `.env`. The server refreshes
access tokens automatically and never logs secrets. If the refresh token is
revoked, run `npm run auth` again.

See [SECURITY.md](SECURITY.md) for reporting a vulnerability.

## Development

```sh
npm test
npm run typecheck
```

## License

[MIT](LICENSE)
