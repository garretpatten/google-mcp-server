import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Locates the project .env file whether running from `src/` via tsx or from
 * `dist/`, loads it without overriding already-set environment variables, and
 * resolves the Google OAuth credentials.
 */
export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function envFilePath(): string {
  const here = import.meta.dirname ?? process.cwd();
  return resolve(here, '..', '.env');
}

export function loadEnv(): void {
  const path = envFilePath();
  if (!existsSync(path)) {
    return;
  }
  try {
    process.loadEnvFile(path);
  } catch (error) {
    process.stderr.write(`Warning: failed to load ${path}: ${String(error)}\n`);
  }
}

export function loadCredentials(): GoogleOAuthCredentials {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN ?? '';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID, ' +
        'GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in .env (run `npm run auth` ' +
        'to obtain a refresh token).',
    );
  }

  return { clientId, clientSecret, refreshToken };
}
