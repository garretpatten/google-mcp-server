import { GoogleApiBase } from './google-api.js';
import type { HttpClient } from './http.js';
import type { AuthenticatedClient } from './google-calendar.js';

const API_ROOT = 'https://tasks.googleapis.com/tasks/v1';

export interface TaskListSummary {
  id: string;
  title: string;
}

export interface TaskQuery {
  listId: string;
  showCompleted?: boolean;
  showDeleted?: boolean;
  showHidden?: boolean;
  dueMin?: string;
  dueMax?: string;
  completedMin?: string;
  completedMax?: string;
  maxResults?: number;
}

export interface TaskInput {
  listId: string;
  taskId?: string;
  title?: string;
  notes?: string;
  /** RFC 3339 timestamp, e.g. 2026-01-02T09:00:00Z */
  due?: string;
  status?: 'needsAction' | 'completed';
}

export class GoogleTasksClient extends GoogleApiBase {
  constructor(http: HttpClient, auth: AuthenticatedClient) {
    super(http, auth);
  }

  /** Lists every task list the authenticated user can access. */
  async listTaskLists(): Promise<TaskListSummary[]> {
    const items = await this.fetchPagedCollection(`${API_ROOT}/users/@me/lists`, {
      maxResults: '1000',
    });
    return items.map((item) => {
      const id = typeof item.id === 'string' ? item.id : '';
      const title = typeof item.title === 'string' ? item.title : id;
      return { id, title };
    });
  }

  async listTasks(query: TaskQuery): Promise<Record<string, unknown>[]> {
    const params: Record<string, string> = {
      maxResults: '100',
      showCompleted: query.showCompleted === false ? 'false' : 'true',
      showDeleted: query.showDeleted === true ? 'true' : 'false',
      showHidden: query.showHidden === true ? 'true' : 'false',
    };
    if (query.dueMin) {
      params.dueMin = query.dueMin;
    }
    if (query.dueMax) {
      params.dueMax = query.dueMax;
    }
    if (query.completedMin) {
      params.completedMin = query.completedMin;
    }
    if (query.completedMax) {
      params.completedMax = query.completedMax;
    }
    const items = await this.fetchPagedCollection(
      `${API_ROOT}/lists/${encodeURIComponent(query.listId)}/tasks`,
      params,
    );
    // Tasks come back depth-first; keep at most maxResults entries.
    return items.slice(0, query.maxResults ?? 100);
  }

  async getTask(listId: string, taskId: string): Promise<Record<string, unknown>> {
    return this.getJson(
      `${API_ROOT}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    );
  }

  async createTask(input: TaskInput): Promise<Record<string, unknown>> {
    return this.writeJson(
      'POST',
      `${API_ROOT}/lists/${encodeURIComponent(input.listId)}/tasks`,
      buildTaskBody(input),
    );
  }

  async updateTask(input: TaskInput): Promise<Record<string, unknown>> {
    if (!input.taskId) {
      throw new Error('taskId is required to update a task');
    }
    return this.writeJson(
      'PATCH',
      `${API_ROOT}/lists/${encodeURIComponent(input.listId)}/tasks/${encodeURIComponent(input.taskId)}`,
      buildTaskBody(input),
    );
  }

  /** Moves a task (optionally under a parent or after a sibling) or to another list. */
  async moveTask(
    listId: string,
    taskId: string,
    options: { parent?: string; previous?: string; destinationListId?: string },
  ): Promise<Record<string, unknown>> {
    const query = new URLSearchParams();
    if (options.parent) {
      query.set('parent', options.parent);
    }
    if (options.previous) {
      query.set('previous', options.previous);
    }
    if (options.destinationListId) {
      query.set('destination', options.destinationListId);
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.writeJson(
      'POST',
      `${API_ROOT}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/move${suffix}`,
    );
  }

  async deleteTask(listId: string, taskId: string): Promise<void> {
    await this.writeJson(
      'DELETE',
      `${API_ROOT}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    );
  }
}

function buildTaskBody(input: TaskInput): Record<string, unknown> {
  const task: Record<string, unknown> = {};
  if (input.title !== undefined) {
    task.title = input.title;
  }
  if (input.notes !== undefined) {
    task.notes = input.notes;
  }
  if (input.due !== undefined) {
    task.due = input.due;
  }
  if (input.status !== undefined) {
    task.status = input.status;
  }
  return task;
}
