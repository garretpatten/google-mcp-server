import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { GoogleCalendarClient, EventInput } from './google-calendar.js';
import type { GoogleTasksClient, TaskInput } from './google-tasks.js';

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** MCP tool annotations; every tool declares all four hints explicitly. */
  annotations: ToolAnnotations;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

const MAX_LIST_RESULTS = 100;

export class ToolArgumentError extends Error {}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ToolArgumentError(`Missing required string argument '${key}'`);
  }
  return value;
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolArgumentError(`Argument '${key}' must be a string`);
  }
  return value;
}

function optBool(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ToolArgumentError(`Argument '${key}' must be a boolean`);
  }
  return value;
}

function optNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolArgumentError(`Argument '${key}' must be a number`);
  }
  return value;
}

function optEnum(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
): string | undefined {
  const value = optStr(args, key);
  if (value === undefined) {
    return undefined;
  }
  if (!allowed.includes(value)) {
    throw new ToolArgumentError(`Argument '${key}' must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function optStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ToolArgumentError(`Argument '${key}' must be an array of strings`);
  }
  return value as string[];
}

const calendarRef = {
  type: 'string',
  description:
    'Calendar identifier. Use calendar_list to discover ids: the primary calendar, ' +
    'shared calendars others granted access to, and subscribed calendars all appear.',
};

const schema = {
  type: 'object',
  properties: {
    calendarId: calendarRef,
    eventId: { type: 'string', description: 'Event identifier' },
  },
  required: ['calendarId', 'eventId'],
  additionalProperties: false,
} satisfies JsonSchema;

const taskRefSchema: JsonSchema = {
  type: 'object',
  properties: {
    listId: { type: 'string', description: 'Task list id from tasks_lists' },
    taskId: { type: 'string', description: 'Task identifier' },
  },
  required: ['listId', 'taskId'],
  additionalProperties: false,
};

const eventSchema: JsonSchema = {
  type: 'object',
  properties: {
    calendarId: calendarRef,
    eventId: { type: 'string', description: 'Event identifier' },
    title: { type: 'string' },
    description: { type: 'string' },
    location: { type: 'string' },
    start: {
      type: 'string',
      description: 'Start time: date (2026-01-02) for all-day or ISO 8601 date-time otherwise',
    },
    end: { type: 'string', description: 'End time, same format as start' },
    allDay: { type: 'boolean', description: 'Treat start/end as all-day dates' },
    timezone: {
      type: 'string',
      description: 'IANA time zone for date-time values, e.g. America/New_York',
    },
    attendees: {
      type: 'array',
      items: { type: 'string' },
      description: 'Attendee email addresses',
    },
  },
  additionalProperties: false,
};

function trimEvent(event: Record<string, unknown>): Record<string, unknown> {
  const raw = event as {
    id?: unknown;
    summary?: unknown;
    status?: unknown;
    htmlLink?: unknown;
    start?: unknown;
    end?: unknown;
    attendees?: unknown;
  };
  const trimmed: Record<string, unknown> = {
    id: raw.id,
    summary: raw.summary,
    status: raw.status,
    start: raw.start,
    end: raw.end,
    htmlLink: raw.htmlLink,
  };
  if (raw.attendees !== undefined) {
    trimmed.attendees = raw.attendees;
  }
  return trimmed;
}

function trimTask(task: Record<string, unknown>): Record<string, unknown> {
  const raw = task as {
    id?: unknown;
    title?: unknown;
    status?: unknown;
    due?: unknown;
    notes?: unknown;
    parent?: unknown;
    completed?: unknown;
  };
  const trimmed: Record<string, unknown> = {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    due: raw.due,
    completed: raw.completed,
    parent: raw.parent,
  };
  if (raw.notes !== undefined) {
    trimmed.notes = raw.notes;
  }
  return trimmed;
}

export function buildTools(
  calendar: GoogleCalendarClient,
  tasks: GoogleTasksClient,
): ToolDefinition[] {
  const calendarEventInput = (args: Record<string, unknown>): EventInput => ({
    calendarId: str(args, 'calendarId'),
    eventId: optStr(args, 'eventId'),
    title: optStr(args, 'title'),
    description: optStr(args, 'description'),
    location: optStr(args, 'location'),
    start: optStr(args, 'start'),
    end: optStr(args, 'end'),
    allDay: optBool(args, 'allDay'),
    timezone: optStr(args, 'timezone'),
    attendees: optStringArray(args, 'attendees'),
  });

  const taskInput = (args: Record<string, unknown>): TaskInput => ({
    listId: str(args, 'listId'),
    taskId: optStr(args, 'taskId'),
    title: optStr(args, 'title'),
    notes: optStr(args, 'notes'),
    due: optStr(args, 'due'),
    status: optEnum(args, 'status', ['needsAction', 'completed']) as TaskInput['status'],
  });

  return [
    {
      name: 'calendar_list',
      description:
        'List all Google calendars accessible to the account: the primary calendar, ' +
        'calendars shared with the user, and subscribed calendars. Returns id, summary, ' +
        'access role, and whether the calendar is primary.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        const calendars = await calendar.listCalendars();
        return JSON.stringify({ calendars }, null, 2);
      },
    },
    {
      name: 'calendar_events',
      description:
        'List events in a Google calendar within an optional time range, optionally ' +
        'filtered by a text query. Works for personal, shared, and subscribed calendars.',
      inputSchema: {
        type: 'object',
        properties: {
          calendarId: calendarRef,
          timeMin: { type: 'string', description: 'Lower bound (ISO 8601/RFC 3339), inclusive' },
          timeMax: { type: 'string', description: 'Upper bound (ISO 8601/RFC 3339), exclusive' },
          query: { type: 'string', description: 'Free-text search across events' },
          maxResults: {
            type: 'number',
            description: `Maximum events to return (1-${MAX_LIST_RESULTS}, default 100)`,
          },
          orderBy: { type: 'string', description: 'Sort order', enum: ['startTime', 'updated'] },
          showDeleted: { type: 'boolean', description: 'Include cancelled events' },
        },
        required: ['calendarId'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (args) => {
        const maxResults = optNumber(args, 'maxResults') ?? MAX_LIST_RESULTS;
        if (maxResults < 1 || maxResults > MAX_LIST_RESULTS) {
          throw new ToolArgumentError(`'maxResults' must be between 1 and ${MAX_LIST_RESULTS}`);
        }
        const events = await calendar.listEvents({
          calendarId: str(args, 'calendarId'),
          timeMin: optStr(args, 'timeMin'),
          timeMax: optStr(args, 'timeMax'),
          query: optStr(args, 'query'),
          maxResults,
          showDeleted: optBool(args, 'showDeleted'),
          orderBy: optEnum(args, 'orderBy', ['startTime', 'updated']) as
            'startTime' | 'updated' | undefined,
        });
        return JSON.stringify({ count: events.length, events: events.map(trimEvent) }, null, 2);
      },
    },
    {
      name: 'calendar_event',
      description: 'Get full details of a single Google Calendar event.',
      inputSchema: schema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (args) => {
        const event = await calendar.getEvent(str(args, 'calendarId'), str(args, 'eventId'));
        return JSON.stringify(event, null, 2);
      },
    },
    {
      name: 'calendar_create_event',
      description:
        'Create an event in a Google calendar. Use date strings (2026-01-02) for all-day ' +
        'events, or ISO 8601 date-times otherwise.',
      inputSchema: {
        ...eventSchema,
        required: ['calendarId', 'title'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      handler: async (args) => {
        const input = calendarEventInput(args);
        if (!input.title) {
          throw new ToolArgumentError("Missing required string argument 'title'");
        }
        if (!input.start || !input.end) {
          throw new ToolArgumentError("Both 'start' and 'end' are required");
        }
        const event = await calendar.createEvent(input);
        return JSON.stringify(trimEvent(event), null, 2);
      },
    },
    {
      name: 'calendar_update_event',
      description:
        'Update fields of an existing Google Calendar event. Only provided fields change.',
      inputSchema: {
        ...eventSchema,
        required: ['calendarId', 'eventId'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (args) => {
        const event = await calendar.updateEvent(calendarEventInput(args));
        return JSON.stringify(trimEvent(event), null, 2);
      },
    },
    {
      name: 'calendar_delete_event',
      description: 'Delete (cancel) a Google Calendar event.',
      inputSchema: schema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (args) => {
        await calendar.deleteEvent(str(args, 'calendarId'), str(args, 'eventId'));
        return JSON.stringify({ deleted: str(args, 'eventId') });
      },
    },
    {
      name: 'calendar_respond',
      description:
        "Respond to a Google Calendar invitation: set the user's RSVP to accepted, " +
        'declined, or tentative.',
      inputSchema: {
        type: 'object',
        properties: {
          calendarId: calendarRef,
          eventId: { type: 'string' },
          response: {
            type: 'string',
            description: 'RSVP to send',
            enum: ['accepted', 'declined', 'tentative', 'needsAction'],
          },
        },
        required: ['calendarId', 'eventId', 'response'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (args) => {
        const response = optEnum(args, 'response', [
          'accepted',
          'declined',
          'tentative',
          'needsAction',
        ]);
        if (!response) {
          throw new ToolArgumentError("Missing required string argument 'response'");
        }
        const event = await calendar.respond(
          str(args, 'calendarId'),
          str(args, 'eventId'),
          response as 'accepted' | 'declined' | 'tentative' | 'needsAction',
        );
        return JSON.stringify({ eventId: event.id, responseStatus: response }, null, 2);
      },
    },
    {
      name: 'tasks_lists',
      description:
        'List all Google Tasks lists for the account. Returns id and title; use an id ' +
        'with tasks_list_tasks.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async () => {
        const lists = await tasks.listTaskLists();
        return JSON.stringify({ taskLists: lists }, null, 2);
      },
    },
    {
      name: 'tasks_list_tasks',
      description: 'List tasks in a Google Tasks list, including nested subtasks in order.',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Task list id from tasks_lists' },
          showCompleted: {
            type: 'boolean',
            description: 'Include completed tasks (default true)',
          },
          showDeleted: { type: 'boolean', description: 'Include deleted tasks' },
          showHidden: { type: 'boolean', description: 'Include hidden tasks' },
          dueMin: { type: 'string', description: 'RFC 3339 lower bound on due date' },
          dueMax: { type: 'string', description: 'RFC 3339 upper bound on due date' },
          maxResults: {
            type: 'number',
            description: `Maximum tasks to return (1-${MAX_LIST_RESULTS}, default 100)`,
          },
        },
        required: ['listId'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (args) => {
        const maxResults = optNumber(args, 'maxResults') ?? MAX_LIST_RESULTS;
        if (maxResults < 1 || maxResults > MAX_LIST_RESULTS) {
          throw new ToolArgumentError(`'maxResults' must be between 1 and ${MAX_LIST_RESULTS}`);
        }
        const items = await tasks.listTasks({
          listId: str(args, 'listId'),
          showCompleted: optBool(args, 'showCompleted'),
          showDeleted: optBool(args, 'showDeleted'),
          showHidden: optBool(args, 'showHidden'),
          dueMin: optStr(args, 'dueMin'),
          dueMax: optStr(args, 'dueMax'),
          maxResults,
        });
        return JSON.stringify({ count: items.length, tasks: items.map(trimTask) }, null, 2);
      },
    },
    {
      name: 'tasks_create',
      description: 'Create a task in a Google Tasks list.',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Task list id from tasks_lists' },
          title: { type: 'string' },
          notes: { type: 'string', description: 'Notes describing the task' },
          due: { type: 'string', description: 'Due date, RFC 3339 (e.g. 2026-01-02T09:00:00Z)' },
        },
        required: ['listId', 'title'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      handler: async (args) => {
        const task = await tasks.createTask(taskInput(args));
        return JSON.stringify(trimTask(task), null, 2);
      },
    },
    {
      name: 'tasks_update',
      description: 'Update fields of an existing Google Tasks task.',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          taskId: { type: 'string' },
          title: { type: 'string' },
          notes: { type: 'string' },
          due: { type: 'string', description: 'RFC 3339 due date' },
          status: {
            type: 'string',
            description: 'Task status',
            enum: ['needsAction', 'completed'],
          },
        },
        required: ['listId', 'taskId'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (args) => {
        const task = await tasks.updateTask(taskInput(args));
        return JSON.stringify(trimTask(task), null, 2);
      },
    },
    {
      name: 'tasks_complete',
      description: 'Mark a Google Tasks task as completed.',
      inputSchema: taskRefSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (args) => {
        const task = await tasks.updateTask({
          ...taskInput(args),
          status: 'completed',
        });
        return JSON.stringify(trimTask(task), null, 2);
      },
    },
    {
      name: 'tasks_move',
      description:
        'Move a task: reorder within a list (previous/parent), or move it to another ' +
        'task list (destinationListId).',
      inputSchema: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Current task list id' },
          taskId: { type: 'string' },
          parent: { type: 'string', description: 'Destination parent task id for subtasks' },
          previous: {
            type: 'string',
            description: 'Task id after which the moved task is positioned',
          },
          destinationListId: { type: 'string', description: 'Destination task list id' },
        },
        required: ['listId', 'taskId'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (args) => {
        const listId = str(args, 'listId');
        const taskId = str(args, 'taskId');
        const task = await tasks.moveTask(listId, taskId, {
          parent: optStr(args, 'parent'),
          previous: optStr(args, 'previous'),
          destinationListId: optStr(args, 'destinationListId'),
        });
        return JSON.stringify(trimTask(task), null, 2);
      },
    },
    {
      name: 'tasks_delete',
      description: 'Delete a task from a Google Tasks list.',
      inputSchema: taskRefSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (args) => {
        const listId = str(args, 'listId');
        const taskId = str(args, 'taskId');
        await tasks.deleteTask(listId, taskId);
        return JSON.stringify({ deleted: taskId });
      },
    },
  ];
}

export const READ_TOOL_NAMES = new Set([
  'calendar_list',
  'calendar_events',
  'calendar_event',
  'tasks_lists',
  'tasks_list_tasks',
]);
