import type { HttpClient } from './http.js';

export interface AuthenticatedGoogleClient {
  getAccessToken(): Promise<string>;
}

const API_ERRORS_MAX_ITEMS = 3;

/** Normalizes an error body from a Google REST API into a single message. */
export function describeApiError(statusCode: number, body: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof parsed.error === 'object' && parsed.error?.message) {
      detail = parsed.error.message;
    } else if (typeof parsed.error === 'string') {
      detail = parsed.error;
    }
  } catch {
    detail = body.slice(0, 200);
  }
  const message = detail || `HTTP ${statusCode}`;
  return `Google API error (HTTP ${statusCode}): ${message}`;
}

export class GoogleApiError extends Error {}

/** Shared plumbing for Google REST API clients: bearer auth, paging, errors. */
export abstract class GoogleApiBase {
  constructor(
    protected readonly http: HttpClient,
    protected readonly auth: AuthenticatedGoogleClient,
  ) {}

  protected async getJson(url: string): Promise<Record<string, unknown>> {
    const token = await this.auth.getAccessToken();
    const response = await this.http.request('GET', url, {
      Authorization: `Bearer ${token}`,
    });
    if (response.statusCode !== 200) {
      throw new GoogleApiError(describeApiError(response.statusCode, response.body));
    }
    try {
      return JSON.parse(response.body) as Record<string, unknown>;
    } catch {
      throw new GoogleApiError(`Google API returned invalid JSON for ${url}`);
    }
  }

  protected async writeJson(
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ): Promise<Record<string, unknown>> {
    const token = await this.auth.getAccessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await this.http.request(
      method,
      url,
      headers,
      payload === undefined ? undefined : JSON.stringify(payload),
    );
    if (response.statusCode >= 400) {
      throw new GoogleApiError(describeApiError(response.statusCode, response.body));
    }
    if (response.body.length === 0) {
      return {};
    }
    try {
      return JSON.parse(response.body) as Record<string, unknown>;
    } catch {
      throw new GoogleApiError(`Google API returned invalid JSON for ${method} ${url}`);
    }
  }

  /** Fetches every page of a paged Google collection endpoint. */
  protected async fetchPagedCollection(
    endpoint: string,
    params: Record<string, string>,
    itemsKey = 'items',
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    let pageToken: string | null = null;

    while (true) {
      const query = new URLSearchParams(params);
      if (pageToken) {
        query.set('pageToken', pageToken);
      }
      const page = await this.getJson(`${endpoint}?${query.toString()}`);
      const items = page[itemsKey];
      if (Array.isArray(items)) {
        results.push(...(items as Record<string, unknown>[]));
      }

      const next = page.nextPageToken;
      if (typeof next !== 'string' || next.length === 0) {
        break;
      }
      pageToken = next;
    }

    return results;
  }

  protected maxErrorDetail(errors: unknown): string {
    if (Array.isArray(errors) && errors.length > 0) {
      const shown = errors
        .slice(0, API_ERRORS_MAX_ITEMS)
        .map((item) => JSON.stringify(item))
        .join('; ');
      const more =
        errors.length > API_ERRORS_MAX_ITEMS
          ? ` (+${errors.length - API_ERRORS_MAX_ITEMS} more)`
          : '';
      return `${shown}${more}`;
    }
    return '';
  }
}
