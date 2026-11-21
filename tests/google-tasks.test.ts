import { describe, expect, it } from 'vitest';
import { CREDENTIALS, MockHttpClient } from './helpers.js';
import { GoogleAuthClient } from '../src/google-auth.js';
import { GoogleTasksClient } from '../src/google-tasks.js';

function makeClient(http: MockHttpClient): GoogleTasksClient {
  return new GoogleTasksClient(http, new GoogleAuthClient(http, CREDENTIALS));
}

describe('GoogleTasksClient.listTaskLists', () => {
  it('maps list summaries across pages', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(200, {
      items: [{ id: 'list-1', title: 'Work' }],
      nextPageToken: 'p2',
    });
    http.respond(200, { items: [{ id: 'list-2', title: 'Home' }] });
    const client = makeClient(http);

    const lists = await client.listTaskLists();

    expect(lists).toEqual([
      { id: 'list-1', title: 'Work' },
      { id: 'list-2', title: 'Home' },
    ]);
    expect(new URL(http.requests[2].url).searchParams.get('pageToken')).toBe('p2');
  });
});

describe('GoogleTasksClient.listTasks', () => {
  it('sends filter flags and respects maxResults', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(200, { items: Array.from({ length: 5 }, (_, index) => ({ id: `t${index}` })) });
    const client = makeClient(http);

    const tasks = await client.listTasks({
      listId: 'list-1',
      showCompleted: false,
      showDeleted: true,
      showHidden: true,
      dueMin: '2026-01-01T00:00:00Z',
      maxResults: 3,
    });

    expect(tasks).toHaveLength(3);
    const url = new URL(http.lastUrl());
    expect(url.pathname).toBe('/tasks/v1/lists/list-1/tasks');
    expect(url.searchParams.get('showCompleted')).toBe('false');
    expect(url.searchParams.get('showDeleted')).toBe('true');
    expect(url.searchParams.get('showHidden')).toBe('true');
    expect(url.searchParams.get('dueMin')).toBe('2026-01-01T00:00:00Z');
  });

  it('defaults showCompleted to true and skips unset filters', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(200, { items: [] });
    const client = makeClient(http);

    await client.listTasks({ listId: 'list-1' });

    const url = new URL(http.lastUrl());
    expect(url.searchParams.get('showCompleted')).toBe('true');
    expect(url.searchParams.has('dueMin')).toBe(false);
  });
});

describe('GoogleTasksClient mutations', () => {
  it('creates a task with title, notes, and due date', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(200, { id: 't-new' });
    const client = makeClient(http);

    await client.createTask({
      listId: 'list-1',
      title: 'Buy milk',
      notes: '2%',
      due: '2026-01-02T09:00:00Z',
    });

    const request = http.requests[1];
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks');
    expect(JSON.parse(request.body ?? '{}')).toEqual({
      title: 'Buy milk',
      notes: '2%',
      due: '2026-01-02T09:00:00Z',
    });
  });

  it('updates only provided fields via PATCH', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(200, { id: 't-1', title: 'Renamed' });
    const client = makeClient(http);

    await client.updateTask({ listId: 'list-1', taskId: 't-1', title: 'Renamed' });

    const request = http.requests[1];
    expect(request.method).toBe('PATCH');
    expect(request.url).toBe('https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks/t-1');
  });

  it('rejects updates without a task id', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    const client = makeClient(http);

    await expect(client.updateTask({ listId: 'list-1' })).rejects.toThrow('taskId is required');
  });

  it('moves a task to a destination list', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(200, { id: 't-1', listId: 'list-2' });
    const client = makeClient(http);

    await client.moveTask('list-1', 't-1', { destinationListId: 'list-2' });

    const request = http.requests[1];
    expect(request.method).toBe('POST');
    expect(request.url).toBe(
      'https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks/t-1/move?destination=list-2',
    );
  });

  it('reorders a task under a parent', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(200, { id: 't-2' });
    const client = makeClient(http);

    await client.moveTask('list-1', 't-2', { parent: 't-1', previous: 't-0' });

    expect(http.lastUrl()).toContain('/tasks/t-2/move?parent=t-1&previous=t-0');
  });

  it('deletes a task', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(204, '');
    const client = makeClient(http);

    await client.deleteTask('list-1', 't-1');

    const request = http.requests[1];
    expect(request.method).toBe('DELETE');
    expect(request.url).toBe('https://tasks.googleapis.com/tasks/v1/lists/list-1/tasks/t-1');
  });

  it('surfaces API errors', async () => {
    const http = new MockHttpClient({ answerTokenRequests: true });
    http.respond(404, { error: { message: 'Requested entity was not found' } });
    const client = makeClient(http);

    await expect(client.deleteTask('list-1', 'missing')).rejects.toThrow(
      /HTTP 404.*Requested entity was not found/s,
    );
  });
});
