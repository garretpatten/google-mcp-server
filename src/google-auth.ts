import { createServer, Server } from 'node:http';
import { readFileSync, writeFile } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { GoogleOAuthCredentials } from './config.js';
import type { HttpClient } from './http.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000;

/** Full read/write scopes required by this MCP server. */
export const GOOGLE_MCP_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
];

export class GoogleAuthError extends Error {}

export interface AccessTokenResult {
  accessToken: string;
}

export class GoogleAuthClient {
  private cachedAccessToken: string | null = null;
  private cachedExpiresAt: number = 0;

  constructor(
    private readonly http: HttpClient,
    private readonly credentials: GoogleOAuthCredentials,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.cachedAccessToken && Date.now() < this.cachedExpiresAt) {
      return this.cachedAccessToken;
    }

    const body = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      refresh_token: this.credentials.refreshToken,
      grant_type: 'refresh_token',
    }).toString();

    const response = await this.http.request(
      'POST',
      TOKEN_URL,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    );
    const parsed = parseJson(response.body);

    if (response.statusCode !== 200 || parsed.error) {
      const detail = String(
        parsed.error_description ?? parsed.error ?? `HTTP ${response.statusCode}`,
      );
      throw new GoogleAuthError(
        `Google OAuth token refresh failed: ${detail}. If the refresh token is ` +
          'invalid or revoked, re-run `npm run auth` to obtain a new one.',
      );
    }

    if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
      throw new GoogleAuthError('Google OAuth token response missing access_token');
    }

    const expiresIn = typeof parsed.expires_in === 'number' ? parsed.expires_in : 3600;
    this.cachedAccessToken = parsed.access_token;
    // Refresh 60 seconds before expiry to avoid clock skew races.
    this.cachedExpiresAt = Date.now() + Math.max(expiresIn - 60, 30) * 1000;
    return this.cachedAccessToken;
  }
}

export interface AuthorizationRedirect {
  code: string | null;
  error: string | null;
  state: string | null;
}

export interface RedirectListener {
  start(): Promise<number>;
  waitForAuthorization(timeoutMs: number): Promise<AuthorizationRedirect>;
  close(): Promise<void>;
}

/** Listens on a loopback address for the OAuth redirect after browser consent. */
export class LoopbackRedirectListener implements RedirectListener {
  private server: Server | null = null;

  async start(): Promise<number> {
    this.server = createServer();
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new GoogleAuthError('Could not start local authorization listener');
    }
    return address.port;
  }

  waitForAuthorization(timeoutMs: number): Promise<AuthorizationRedirect> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new GoogleAuthError('Authorization listener has not been started'));
        return;
      }
      const timer = setTimeout(() => {
        reject(new GoogleAuthError('Timed out waiting for Google authorization'));
      }, timeoutMs);

      this.server.on('request', (request, response) => {
        const params = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams;
        const code = params.get('code');
        const error = params.get('error');

        if (!code && !error) {
          response.writeHead(200, { 'Content-Type': 'text/plain' });
          response.end('Waiting for authorization...');
          return;
        }

        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(
          '<html><body><h1>Authorization complete</h1>' +
            '<p>You can close this tab and return to the terminal.</p></body></html>',
        );
        clearTimeout(timer);
        resolve({ code, error, state: params.get('state') });
      });
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

export function buildAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  scopes: string[],
): string {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTHORIZATION_URL}?${query.toString()}`;
}

export class GoogleAuthorizer {
  constructor(
    private readonly http: HttpClient,
    private readonly listener: RedirectListener,
    private readonly generateState: () => string = () => randomBytes(16).toString('hex'),
    private readonly timeoutMs: number = DEFAULT_AUTHORIZATION_TIMEOUT_MS,
  ) {}

  /** Opens the consent URL and exchanges the loopback redirect for a refresh token. */
  async authorize(credentials: GoogleOAuthCredentials): Promise<string> {
    if (!credentials.clientId || !credentials.clientSecret) {
      throw new GoogleAuthError('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
    }

    const port = await this.listener.start();
    const redirectUri = `http://127.0.0.1:${port}`;
    const state = this.generateState();
    const url = buildAuthorizationUrl(credentials.clientId, redirectUri, state, GOOGLE_MCP_SCOPES);

    process.stdout.write(
      'Open this URL in your browser to authorize the google-mcp-server:\n' + `${url}\n`,
    );

    let redirect: AuthorizationRedirect;
    try {
      redirect = await this.listener.waitForAuthorization(this.timeoutMs);
    } finally {
      await this.listener.close();
    }

    if (redirect.error) {
      throw new GoogleAuthError(`Google authorization failed: ${redirect.error}`);
    }
    if (redirect.state !== state) {
      throw new GoogleAuthError('Google authorization failed: state mismatch');
    }
    if (!redirect.code) {
      throw new GoogleAuthError('Google authorization failed: no authorization code received');
    }

    return this.exchangeCode(credentials, redirect.code, redirectUri);
  }

  private async exchangeCode(
    credentials: GoogleOAuthCredentials,
    code: string,
    redirectUri: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString();

    const response = await this.http.request(
      'POST',
      TOKEN_URL,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    );
    const parsed = parseJson(response.body);

    if (response.statusCode !== 200 || parsed.error) {
      const detail = String(
        parsed.error_description ?? parsed.error ?? `HTTP ${response.statusCode}`,
      );
      throw new GoogleAuthError(`Google OAuth code exchange failed: ${detail}`);
    }

    if (typeof parsed.refresh_token !== 'string' || parsed.refresh_token.length === 0) {
      throw new GoogleAuthError('Google OAuth code exchange did not return a refresh token');
    }

    return parsed.refresh_token;
  }
}

/** Persists a single key in the project .env file, preserving all other lines. */
export async function saveEnvValue(key: string, value: string): Promise<void> {
  const envFile = envFileLocation();
  let content = '';
  try {
    content = readFileSync(envFile, 'utf8');
  } catch {
    content = '';
  }

  const lines = content.split('\n').filter((line) => !line.startsWith(`${key}=`));
  lines.push(`${key}="${value}"`);

  await new Promise<void>((resolve, reject) => {
    writeFile(envFile, `${lines.join('\n').trimEnd()}\n`, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function envFileLocation(): string {
  const here = import.meta.dirname ?? process.cwd();
  // src/google-auth.ts (tsx) and dist/google-auth.js both sit one level below the root.
  return resolve(here, '..', '.env');
}

function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
