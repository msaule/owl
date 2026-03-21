import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolveHomePath } from '../config/index.js';

export const GOOGLE_SCOPES = {
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.readonly'
};

export function readCredentials(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Missing credentials file at ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeCredentials(filePath, credentials) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
}

function openBrowser(url) {
  const commands =
    process.platform === 'win32'
      ? [['cmd', ['/c', 'start', '', url]]]
      : process.platform === 'darwin'
        ? [['open', [url]]]
        : [['xdg-open', [url]]];

  for (const [command, args] of commands) {
    try {
      spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

function startGoogleCallbackServer(expectedState, timeoutMs = 300_000) {
  let settled = false;
  let timeout = null;
  let resolveCode;
  let rejectCode;
  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    if (requestUrl.pathname !== '/google/oauth/callback') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const error = requestUrl.searchParams.get('error');
    const state = requestUrl.searchParams.get('state');
    const code = requestUrl.searchParams.get('code');

    if (error) {
      response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<h1>OWL Google setup failed</h1><p>You can close this tab and return to the terminal.</p>');
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        rejectCode(new Error(`Google OAuth failed: ${error}`));
      }
      server.close();
      return;
    }

    if (!code || state !== expectedState) {
      response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<h1>OWL Google setup failed</h1><p>The callback state did not match.</p>');
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        rejectCode(new Error('Google OAuth callback state mismatch'));
      }
      server.close();
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<h1>OWL is connected</h1><p>You can close this tab and return to the terminal.</p>');

    if (!settled) {
      settled = true;
      clearTimeout(timeout);
      resolveCode(code);
    }
    server.close();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          rejectCode(new Error('Timed out waiting for Google OAuth consent'));
        }
        server.close();
      }, timeoutMs);

      const address = server.address();
      resolve({
        redirectUri: `http://127.0.0.1:${address.port}/google/oauth/callback`,
        codePromise
      });
    });
  });
}

async function exchangeAuthorizationCode({ clientId, clientSecret, code, redirectUri }) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to exchange Google authorization code: ${await response.text()}`);
  }

  return response.json();
}

export async function authorizeGoogle({
  clientId,
  clientSecret,
  scopes,
  credentialsPath,
  timeoutMs = 300_000,
  onPending
}) {
  const resolvedCredentialsPath = resolveHomePath(credentialsPath);
  const state = randomUUID();
  const normalizedScopes = Array.from(new Set((scopes || []).filter(Boolean)));
  const { redirectUri, codePromise } = await startGoogleCallbackServer(state, timeoutMs);
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: normalizedScopes.join(' '),
    state
  }).toString();

  const browserOpened = openBrowser(authorizationUrl.toString());
  onPending?.({
    authorizationUrl: authorizationUrl.toString(),
    redirectUri,
    browserOpened
  });

  const code = await codePromise;
  const tokenPayload = await exchangeAuthorizationCode({
    clientId,
    clientSecret,
    code,
    redirectUri
  });

  const credentials = {
    clientId,
    clientSecret,
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token,
    expiresAt: new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString(),
    scope: tokenPayload.scope || normalizedScopes.join(' ')
  };

  writeCredentials(resolvedCredentialsPath, credentials);
  return credentials;
}

export async function refreshGoogleToken(credentialsPath) {
  const credentials = readCredentials(credentialsPath);
  if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
    return credentials;
  }

  if (credentials.expiresAt && new Date(credentials.expiresAt).getTime() > Date.now() + 60_000) {
    return credentials;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh Google token: ${await response.text()}`);
  }

  const payload = await response.json();
  const updated = {
    ...credentials,
    accessToken: payload.access_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString()
  };

  fs.writeFileSync(credentialsPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return updated;
}

export async function googleFetch(credentialsPath, url) {
  const credentials = await refreshGoogleToken(credentialsPath);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${credentials.accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Google API error ${response.status}: ${await response.text()}`);
  }

  return response.json();
}
