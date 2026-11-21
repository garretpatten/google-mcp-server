export interface HttpResult {
  statusCode: number;
  body: string;
}

export interface HttpClient {
  request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<HttpResult>;
}

export class FetchHttpClient implements HttpClient {
  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<HttpResult> {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    return { statusCode: response.status, body: text };
  }
}
