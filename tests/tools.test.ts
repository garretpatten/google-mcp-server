import { describe, expect, it } from 'vitest';
import { CREDENTIALS, MockHttpClient } from './helpers.js';
import { GoogleAuthClient } from '../src/google-auth.js';
import { GoogleCalendarClient } from '../src/google-calendar.js';
import { GoogleTasksClient } from '../src/google-tasks.js';
import {
  buildTools,
  READ_TOOL_NAMES,
  ToolArgumentError,
  type ToolDefinition,
} from '../src/tools.js';

function makeTools(): { tools: ToolDefinition[]; http: MockHttpClient } {
  const http = new MockHttpClient({ answerTokenRequests: true });
  const calendar = new GoogleCalendarClient(http, new GoogleAuthClient(http, CREDENTIALS));
  const tasks = new GoogleTasksClient(http, new GoogleAuthClient(http, CREDENTIALS));
  return { tools: buildTools(calendar, tasks), http };
}

describe('buildTools', () => {
  it('exposes exactly the documented tools', () => {
    const { tools } = makeTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'calendar_list',
      'calendar_events',
      'calendar_event',
      'calendar_create_event',
      'calendar_update_event',
      'calendar_delete_event',
      'calendar_respond',
      'tasks_lists',
      'tasks_list_tasks',
      'tasks_create',
      'tasks_update',
      'tasks_complete',
      'tasks_move',
      'tasks_delete',
    ]);
  });

  it('defines JSON object schemas for every tool', () => {
    const { tools } = makeTools();
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(10);
      expect(Object.keys(tool.inputSchema.properties).length).toBeGreaterThanOrEqual(0);
    }
  });

  it('declares all four MCP annotations on every tool', () => {
    const { tools } = makeTools();
    for (const tool of tools) {
      for (const hint of [
        'readOnlyHint',
        'destructiveHint',
        'idempotentHint',
        'openWorldHint',
      ] as const) {
        expect(typeof tool.annotations[hint], `${tool.name}.${hint}`).toBe('boolean');
      }
    }
  });

  it('marks read tools read-only, writes non-read-only, and every tool open-world', () => {
    const { tools } = makeTools();
    for (const tool of tools) {
      expect(tool.annotations.openWorldHint).toBe(true);
      expect(tool.annotations.readOnlyHint, tool.name).toBe(READ_TOOL_NAMES.has(tool.name));
    }
  });

  it('marks delete tools destructive and create tools non-idempotent', () => {
    const { tools } = makeTools();
    for (const name of ['calendar_delete_event', 'tasks_delete']) {
      const tool = tools.find((candidate) => candidate.name === name)!;
      expect(tool.annotations.destructiveHint, name).toBe(true);
    }
    for (const name of ['calendar_create_event', 'tasks_create']) {
      const tool = tools.find((candidate) => candidate.name === name)!;
      expect(tool.annotations.idempotentHint, name).toBe(false);
    }
  });
});

describe('READ_TOOL_NAMES', () => {
  it('contains only read-prefixed tools that exist', () => {
    const { tools } = makeTools();
    const names = new Set(tools.map((tool) => tool.name));
    for (const name of READ_TOOL_NAMES) {
      expect(names.has(name)).toBe(true);
    }
  });
});

describe('tool argument validation', () => {
  it('requires required string arguments', async () => {
    const { tools } = makeTools();
    const listEvents = tools.find((tool) => tool.name === 'calendar_events')!;

    await expect(listEvents.handler({})).rejects.toThrow(ToolArgumentError);
    await expect(listEvents.handler({})).rejects.toThrow("'calendarId'");
  });

  it('rejects non-number maxResults and out-of-range values', async () => {
    const { tools } = makeTools();
    const listEvents = tools.find((tool) => tool.name === 'calendar_events')!;

    await expect(listEvents.handler({ calendarId: 'primary', maxResults: 'ten' })).rejects.toThrow(
      'must be a number',
    );
    await expect(listEvents.handler({ calendarId: 'primary', maxResults: 0 })).rejects.toThrow(
      'between 1 and 100',
    );
  });

  it('rejects invalid enum values', async () => {
    const { tools } = makeTools();
    const respond = tools.find((tool) => tool.name === 'calendar_respond')!;

    await expect(
      respond.handler({ calendarId: 'primary', eventId: 'e1', response: 'maybe' }),
    ).rejects.toThrow('must be one of');
  });

  it('requires create events to have start and end', async () => {
    const { tools } = makeTools();
    const create = tools.find((tool) => tool.name === 'calendar_create_event')!;

    await expect(create.handler({ calendarId: 'primary', title: 'No time' })).rejects.toThrow(
      "Both 'start' and 'end' are required",
    );
  });
});

describe('tool handlers call the clients', () => {
  it('calendar_list returns trimmed calendar data', async () => {
    const { tools, http } = makeTools();
    http.respond(200, {
      items: [{ id: 'primary', summary: 'Me', primary: true, accessRole: 'owner' }],
    });
    const handler = tools.find((tool) => tool.name === 'calendar_list')!;

    const output = JSON.parse(await handler.handler({})) as {
      calendars: { id: string }[];
    };
    expect(output.calendars).toEqual([
      { id: 'primary', summary: 'Me', accessRole: 'owner', primary: true },
    ]);
  });

  it('calendar_events trims event fields', async () => {
    const { tools, http } = makeTools();
    http.respond(200, {
      items: [
        {
          id: 'e1',
          summary: 'Event',
          status: 'confirmed',
          start: { dateTime: '2026-01-01T09:00:00Z' },
          end: { dateTime: '2026-01-01T10:00:00Z' },
          htmlLink: 'https://calendar.google.com/…',
          creator: { email: 'x@example.com' },
        },
      ],
    });
    const handler = tools.find((tool) => tool.name === 'calendar_events')!;

    const output = JSON.parse(await handler.handler({ calendarId: 'primary' })) as {
      count: number;
      events: Record<string, unknown>[];
    };
    expect(output.count).toBe(1);
    expect(output.events[0]).not.toHaveProperty('creator');
  });

  it('tasks_lists returns task lists', async () => {
    const { tools, http } = makeTools();
    http.respond(200, { items: [{ id: 'l1', title: 'Errands' }] });
    const handler = tools.find((tool) => tool.name === 'tasks_lists')!;

    const output = JSON.parse(await handler.handler({})) as { taskLists: unknown[] };
    expect(output.taskLists).toEqual([{ id: 'l1', title: 'Errands' }]);
  });

  it('tasks_complete forces completed status', async () => {
    const { tools, http } = makeTools();
    http.respond(200, { id: 't1', status: 'completed' });
    const handler = tools.find((tool) => tool.name === 'tasks_complete')!;

    await handler.handler({ listId: 'l1', taskId: 't1' });
    const patch = http.requests[1];
    expect(patch.method).toBe('PATCH');
    expect(JSON.parse(patch.body ?? '{}')).toEqual({ status: 'completed' });
  });

  it('tasks_delete issues a DELETE and reports the id', async () => {
    const { tools, http } = makeTools();
    http.respond(204, '');
    const handler = tools.find((tool) => tool.name === 'tasks_delete')!;

    const output = JSON.parse(await handler.handler({ listId: 'l1', taskId: 't1' })) as {
      deleted: string;
    };
    expect(output).toEqual({ deleted: 't1' });
    expect(http.requests[1].method).toBe('DELETE');
  });
});
