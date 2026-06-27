const AUTH_SESSION_KEY = 'azure-storage-manager.auth.session';
const AUTH_ACCESS_TOKEN_KEY = 'azure-storage-manager.auth.access-token';
const AUTH_REFRESH_TOKEN_KEY = 'azure-storage-manager.auth.refresh-token';
const AUTH_SESSION_DATA_KEY = 'azure-storage-manager.auth.session-data';

function isBrowser() {
  return typeof window !== 'undefined';
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message = body && typeof body === 'object' && body.message
      ? body.message
      : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return body;
}

function getStoredJson(key) {
  if (!isBrowser()) {
    return null;
  }

  const value = window.localStorage.getItem(key);
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function setStoredJson(key, value) {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

function clearStoredKeys(keys) {
  if (!isBrowser()) {
    return;
  }

  for (const key of keys) {
    window.localStorage.removeItem(key);
  }
}

function resolveRedirectUri(authConfig) {
  const configured = String(authConfig?.variables?.VITE_REDIRECT_URI || '').trim();

  if (!isBrowser()) {
    return configured;
  }

  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(window.location.hostname)) {
    return `${window.location.origin}/callback`;
  }

  return configured || `${window.location.origin}/callback`;
}

function buildAuthUrl(path, authConfig) {
  const baseUrl = normalizeBaseUrl(authConfig?.variables?.VITE_AUTH_URL);
  const appId = String(authConfig?.variables?.VITE_AUTH_APP_ID || '').trim();
  const apiKey = String(authConfig?.variables?.VITE_AUTH_API_KEY || '').trim();
  const redirectUri = resolveRedirectUri(authConfig);

  if (!baseUrl) {
    throw new Error('VITE_AUTH_URL is not configured');
  }

  if (!appId) {
    throw new Error('VITE_AUTH_APP_ID is not configured');
  }

  if (!apiKey) {
    throw new Error('VITE_AUTH_API_KEY is not configured');
  }

  const url = new URL(path.replace(/^\/+/, ''), `${baseUrl}/`);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('api_key', apiKey);
  return url.toString();
}

function getSessionExpiry(session) {
  const claimExpiry = Number(session?.claims?.exp || session?.session?.claims?.exp || 0);
  if (Number.isFinite(claimExpiry) && claimExpiry > 0) {
    return claimExpiry * 1000;
  }

  const expiresAt = session?.expiresAt || session?.session?.expires_at || null;
  if (!expiresAt) {
    return null;
  }

  const parsed = new Date(expiresAt).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildLoginUrl(authConfig) {
  return buildAuthUrl('login', authConfig);
}

export function buildRegisterUrl(authConfig) {
  return buildAuthUrl('register-tenant', authConfig);
}

export async function loadAuthConfig(apiBaseUrl) {
  const baseUrl = normalizeBaseUrl(apiBaseUrl);
  return fetchJson(`${baseUrl}/api/auth/config`);
}

export async function exchangeAuthCode(apiBaseUrl, code) {
  const baseUrl = normalizeBaseUrl(apiBaseUrl);
  return fetchJson(`${baseUrl}/api/auth/exchange-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });
}

export async function verifyAuthToken(apiBaseUrl, token) {
  const baseUrl = normalizeBaseUrl(apiBaseUrl);
  return fetchJson(`${baseUrl}/api/auth/verify-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  });
}

export function normalizeAuthSession(exchangeResponse, verificationResponse, authConfig = null) {
  const exchangeData = exchangeResponse?.data || {};
  const verificationData = verificationResponse?.data || {};

  return {
    accessToken: String(exchangeData.access_token || '').trim(),
    refreshToken: String(exchangeData.refresh_token || '').trim(),
    tokenType: String(exchangeData.token_type || 'Bearer').trim(),
    expiresIn: exchangeData.expires_in ?? null,
    expiresAt: verificationData.expires_at || null,
    valid: Boolean(verificationData.valid),
    claims: verificationData.claims || {},
    user: verificationData.user || null,
    tenant: verificationData.tenant || null,
    application: verificationData.application || null,
    environment: verificationData.environment || null,
    session: verificationData,
    authConfig: authConfig ? {
      projectName: String(authConfig.project_name || '').trim(),
      updatedAt: authConfig.updated_at || null,
    } : null,
    createdAt: new Date().toISOString(),
  };
}

export function persistAuthSession(session) {
  if (!isBrowser()) {
    return session;
  }

  setStoredJson(AUTH_SESSION_KEY, session);

  if (session?.accessToken) {
    window.localStorage.setItem(AUTH_ACCESS_TOKEN_KEY, session.accessToken);
  }

  if (session?.refreshToken) {
    window.localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, session.refreshToken);
  }

  if (session?.session) {
    setStoredJson(AUTH_SESSION_DATA_KEY, session.session);
  }

  return session;
}

export function clearAuthSession() {
  clearStoredKeys([
    AUTH_SESSION_KEY,
    AUTH_ACCESS_TOKEN_KEY,
    AUTH_REFRESH_TOKEN_KEY,
    AUTH_SESSION_DATA_KEY,
  ]);
}

export function isSessionExpired(session) {
  const expiry = getSessionExpiry(session);
  return expiry ? Date.now() >= expiry : false;
}

export function getStoredAuthSession() {
  const session = getStoredJson(AUTH_SESSION_KEY);
  if (!session) {
    return null;
  }

  if (isSessionExpired(session)) {
    clearAuthSession();
    return null;
  }

  return session;
}

export function buildAuthHeaders() {
  const session = getStoredAuthSession();
  if (!session) {
    return {};
  }

  const headers = {};

  if (session.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const tenantId = session?.tenant?.id || session?.claims?.tenant_id;
  if (tenantId) {
    headers['X-Tenant-ID'] = tenantId;
  }

  const tenantName = session?.tenant?.name || session?.claims?.tenant_name;
  if (tenantName) {
    headers['X-Tenant-Name'] = tenantName;
  }

  const userId = session?.user?.id || session?.claims?.sub;
  if (userId) {
    headers['X-User-ID'] = userId;
  }

  const userEmail = session?.user?.email || session?.claims?.email;
  if (userEmail) {
    headers['X-User-Email'] = userEmail;
  }

  return headers;
}

export function getSessionDisplayName(session) {
  return session?.user?.name || session?.claims?.name || 'Usuario';
}

export function getTenantDisplayName(session) {
  return session?.tenant?.name || session?.claims?.tenant_name || 'Tenant';
}
