import type { HttpResult, HttpClient } from '../src/http.js';

export interface RecordedRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface MockHttpClientOptions {
  /** Answer POSTs to the token endpoint automatically with a valid token. */
  answerTokenRequests?: boolean;
}

/** Queues responses and records every request for assertions. */
export class MockHttpClient implements HttpClient {
  readonly requests: RecordedRequest[] = [];
  private readonly options: MockHttpClientOptions;
  private queue: HttpResult[] = [];

  constructor(options: MockHttpClientOptions = {}) {
    this.options = options;
  }

  respond(statusCode: number, body: string | unknown = {}): void {
    this.queue.push({ statusCode, body: typeof body === 'string' ? body : JSON.stringify(body) });
  }

  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<HttpResult> {
    this.requests.push({ method, url, headers, body });
    // Token refreshes are answered automatically so tests only queue API calls.
    if (this.options.answerTokenRequests && url === 'https://oauth2.googleapis.com/token') {
      return { statusCode: 200, body: AUTH_TOKEN_RESPONSE() };
    }
    const next = this.queue.shift();
    if (!next) {
      throw new Error(`MockHttpClient has no queued response for ${method} ${url}`);
    }
    return next;
  }

  lastUrl(): string {
    return this.requests[this.requests.length - 1]?.url ?? '';
  }
}

export const AUTH_TOKEN_RESPONSE = (expiresIn: number = 3600): string =>
  JSON.stringify({ access_token: 'at-1', expires_in: expiresIn });

export const CREDENTIALS = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token',
};
