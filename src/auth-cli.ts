#!/usr/bin/env node
import { loadEnv } from './config.js';
import { FetchHttpClient } from './http.js';
import {
  GoogleAuthorizer,
  GoogleAuthClient,
  LoopbackRedirectListener,
  saveEnvValue,
} from './google-auth.js';

async function main(): Promise<void> {
  loadEnv();

  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) {
    throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
  }

  const http = new FetchHttpClient();
  const authorizer = new GoogleAuthorizer(http, new LoopbackRedirectListener());
  const refreshToken = await authorizer.authorize({ clientId, clientSecret, refreshToken: '' });

  // Verify the new refresh token works before persisting it.
  const auth = new GoogleAuthClient(http, { clientId, clientSecret, refreshToken });
  await auth.getAccessToken();

  await saveEnvValue('GOOGLE_REFRESH_TOKEN', refreshToken);
  process.stdout.write('Saved GOOGLE_REFRESH_TOKEN to .env\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
