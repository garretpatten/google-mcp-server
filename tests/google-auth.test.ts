import { describe, expect, it } from 'vitest';
import { AUTH_TOKEN_RESPONSE, CREDENTIALS, MockHttpClient } from './helpers.js';
import {
  buildAuthorizationUrl,
  GoogleAuthClient,
  GoogleAuthError,
  GoogleAuthorizer,
  GOOGLE_MCP_SCOPES,
  LoopbackRedirectListener,
  type AuthorizationRedirect,
} from '../src/google-auth.js';

describe('GoogleAuthClient', () => {
  it('refreshes the token and sends the expected form body', async () => {
    const http = new MockHttpClient();
    http.respond(200, AUTH_TOKEN_RESPONSE());
    const client = new GoogleAuthClient(http, CREDENTIALS);

    const token = await client.getAccessToken();

    expect(token).toBe('at-1');
    const request = http.requests[0];
    expect(request.url).toBe('https://oauth2.googleapis.com/token');
    expect(request.body).toContain('client_id=client-id');
    expect(request.body).toContain('grant_type=refresh_token');
    expect(request.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('caches the access token until expiry', async () => {
    const http = new MockHttpClient();
    http.respond(200, AUTH_TOKEN_RESPONSE(3600));
    const client = new GoogleAuthClient(http, CREDENTIALS);

    await client.getAccessToken();
    await client.getAccessToken();

    expect(http.requests).toHaveLength(1);
  });

  it('includes a descriptive error when the refresh fails', async () => {
    const http = new MockHttpClient();
    http.respond(400, { error: 'invalid_grant', error_description: 'Token has expired' });
    http.respond(400, { error: 'invalid_grant', error_description: 'Token has expired' });
    const client = new GoogleAuthClient(http, CREDENTIALS);

    await expect(client.getAccessToken()).rejects.toThrow(GoogleAuthError);
    await expect(client.getAccessToken()).rejects.toThrow(
      /Token has expired.*re-run `npm run auth`/s,
    );
  });

  it('rejects responses missing an access token', async () => {
    const http = new MockHttpClient();
    http.respond(200, { expires_in: 3600 });
    const client = new GoogleAuthClient(http, CREDENTIALS);

    await expect(client.getAccessToken()).rejects.toThrow('missing access_token');
  });
});

describe('buildAuthorizationUrl', () => {
  it('requests offline access with the full read/write scopes', () => {
    const url = buildAuthorizationUrl('cid', 'http://127.0.0.1:9', 'state-1', GOOGLE_MCP_SCOPES);
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(parsed.searchParams.get('client_id')).toBe('cid');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
    expect(parsed.searchParams.get('state')).toBe('state-1');
    expect(parsed.searchParams.get('scope')).toBe(GOOGLE_MCP_SCOPES.join(' '));
    expect(parsed.searchParams.get('scope')).toContain('auth/calendar');
    expect(parsed.searchParams.get('scope')).toContain('auth/tasks');
  });
});

class FakeRedirectListener {
  readonly startedPorts: number[] = [];
  readonly closed: boolean[] = [];
  private responder: (() => AuthorizationRedirect) | null = null;

  setResponder(responder: () => AuthorizationRedirect): void {
    this.responder = responder;
  }

  async start(): Promise<number> {
    this.startedPorts.push(49152 + this.startedPorts.length);
    return this.startedPorts[this.startedPorts.length - 1];
  }

  async waitForAuthorization(): Promise<AuthorizationRedirect> {
    if (!this.responder) {
      throw new Error('No responder configured');
    }
    return this.responder();
  }

  async close(): Promise<void> {
    this.closed.push(true);
  }
}

describe('GoogleAuthorizer', () => {
  const credentials = { ...CREDENTIALS, refreshToken: '' };

  it('exchanges the authorization code and validates state', async () => {
    const http = new MockHttpClient();
    http.respond(200, { access_token: 'x', refresh_token: 'new-refresh' });
    const listener = new FakeRedirectListener();
    listener.setResponder(() => ({ code: 'auth-code', error: null, state: 'expected-state' }));

    let usedUrl = '';
    const authorizer = new GoogleAuthorizer(
      http as never,
      listener as never,
      () => 'expected-state',
    );
    const originalWarn = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown): boolean => {
      usedUrl = String(chunk);
      return true;
    };
    try {
      const token = await authorizer.authorize(credentials);
      expect(token).toBe('new-refresh');
    } finally {
      process.stdout.write = originalWarn;
    }

    expect(usedUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
    const parsed = new URL(usedUrl.trim().split('\n').pop() ?? '');
    expect(parsed.searchParams.get('state')).toBe('expected-state');
    expect(parsed.searchParams.get('scope')).toBe(GOOGLE_MCP_SCOPES.join(' '));
    expect(listener.closed).toHaveLength(1);

    const exchange = http.requests[0];
    expect(exchange.url).toBe('https://oauth2.googleapis.com/token');
    expect(exchange.body).toContain('grant_type=authorization_code');
    expect(exchange.body).toContain('code=auth-code');
    expect(exchange.body).toContain('redirect_uri=' + encodeURIComponent('http://127.0.0.1:49152'));
  });

  it('throws when Google reports an error', async () => {
    const http = new MockHttpClient();
    const listener = new FakeRedirectListener();
    listener.setResponder(() => ({ code: null, error: 'access_denied', state: 's' }));

    const authorizer = new GoogleAuthorizer(http as never, listener as never, () => 's');
    await expect(authorizer.authorize(credentials)).rejects.toThrow('access_denied');
  });

  it('throws on state mismatch', async () => {
    const http = new MockHttpClient();
    const listener = new FakeRedirectListener();
    listener.setResponder(() => ({ code: 'c', error: null, state: 'other' }));

    const authorizer = new GoogleAuthorizer(http as never, listener as never, () => 's');
    await expect(authorizer.authorize(credentials)).rejects.toThrow('state mismatch');
  });

  it('fails when the code exchange returns no refresh token', async () => {
    const http = new MockHttpClient();
    http.respond(200, { access_token: 'only-access' });
    const listener = new FakeRedirectListener();
    listener.setResponder(() => ({ code: 'c', error: null, state: 's' }));

    const authorizer = new GoogleAuthorizer(http as never, listener as never, () => 's');
    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'did not return a refresh token',
    );
  });

  it('fails fast when client credentials are missing', async () => {
    const http = new MockHttpClient();
    const listener = new FakeRedirectListener();
    const authorizer = new GoogleAuthorizer(http as never, listener as never);

    await expect(
      authorizer.authorize({ clientId: '', clientSecret: '', refreshToken: '' }),
    ).rejects.toThrow('Set GOOGLE_CLIENT_ID');
    expect(listener.startedPorts).toHaveLength(0);
  });
});

describe('LoopbackRedirectListener', () => {
  it('captures the code and closes cleanly', async () => {
    const listener = new LoopbackRedirectListener();
    const port = await listener.start();
    expect(port).toBeGreaterThan(0);

    const pending = listener.waitForAuthorization(5_000);
    const response = await fetch(`http://127.0.0.1:${port}/?code=abc&state=xyz`);
    expect(await response.text()).toContain('Authorization complete');

    expect(await pending).toEqual({ code: 'abc', error: null, state: 'xyz' });
    await listener.close();
  });

  it('ignores unrelated requests until the redirect arrives', async () => {
    const listener = new LoopbackRedirectListener();
    const port = await listener.start();

    const pending = listener.waitForAuthorization(5_000);
    const filler = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    expect(await filler.text()).toContain('Waiting for authorization');

    await fetch(`http://127.0.0.1:${port}/?code=done&state=s`);
    const redirect = await pending;
    expect(redirect.code).toBe('done');
    await listener.close();
  });

  it('rejects when authorization does not arrive in time', async () => {
    const listener = new LoopbackRedirectListener();
    const _port = await listener.start();
    await expect(listener.waitForAuthorization(50)).rejects.toThrow(
      'Timed out waiting for Google authorization',
    );
    await listener.close();
  });
});
