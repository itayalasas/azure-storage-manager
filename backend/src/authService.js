const AUTH_CONFIG_URL = String(process.env.AUTH_ENV_URL || '').trim();
const AUTH_CONFIG_ACCESS_KEY = String(process.env.AUTH_ENV_ACCESS_KEY || '').trim();
const AUTH_CONFIG_CACHE_MS = Number(process.env.AUTH_CONFIG_CACHE_MS || 60_000);

let cachedAuthConfig = null;
let cachedAuthConfigAt = 0;

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseJsonBody(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function parseResponse(response, label) {
  const text = await response.text();
  const body = parseJsonBody(text);

  if (!response.ok) {
    const message = body && typeof body === 'object'
      ? String(
        body.message
        || body.error?.message
        || body.error
        || body.detail
        || `${label} failed (${response.status})`,
      )
      : `${label} failed (${response.status})`;
    throw createHttpError(response.status, message);
  }

  return body;
}

function sanitizeAuthConfig(config) {
  const variables = config?.variables || {};

  return {
    project_name: String(config?.project_name || '').trim(),
    description: String(config?.description || '').trim(),
    variables: {
      VITE_AUTH_API_KEY: String(variables.VITE_AUTH_API_KEY || '').trim(),
      VITE_AUTH_APP_ID: String(variables.VITE_AUTH_APP_ID || '').trim(),
      VITE_AUTH_URL: String(variables.VITE_AUTH_URL || '').trim(),
      VITE_REDIRECT_URI: String(variables.VITE_REDIRECT_URI || '').trim(),
    },
    updated_at: config?.updated_at || null,
  };
}

async function fetchAuthConfig(force = false) {
  if (
    !force
    && cachedAuthConfig
    && Number.isFinite(cachedAuthConfigAt)
    && AUTH_CONFIG_CACHE_MS > 0
    && (Date.now() - cachedAuthConfigAt) < AUTH_CONFIG_CACHE_MS
  ) {
    return cachedAuthConfig;
  }

  if (!AUTH_CONFIG_URL) {
    throw createHttpError(500, 'AUTH_ENV_URL is not configured');
  }

  if (!AUTH_CONFIG_ACCESS_KEY) {
    throw createHttpError(500, 'AUTH_ENV_ACCESS_KEY is not configured');
  }

  const response = await fetch(AUTH_CONFIG_URL, {
    headers: {
      'X-Access-Key': AUTH_CONFIG_ACCESS_KEY,
    },
  });

  const config = await parseResponse(response, 'auth config');
  cachedAuthConfig = config;
  cachedAuthConfigAt = Date.now();
  return config;
}

function getAuthVariables(config) {
  return config?.variables || {};
}

function getAuthAppId(config, overrideAppId) {
  const variables = getAuthVariables(config);
  return String(overrideAppId || variables.VITE_AUTH_APP_ID || '').trim();
}

function getRequiredConfigValue(config, key) {
  const variables = getAuthVariables(config);
  const value = String(variables[key] || '').trim();
  if (!value) {
    throw createHttpError(500, `${key} is not configured`);
  }
  return value;
}

function getRequiredConfigValueFromAny(config, keys) {
  for (const key of keys) {
    const variables = getAuthVariables(config);
    const value = String(variables[key] || '').trim();
    if (value) {
      return value;
    }
  }

  throw createHttpError(500, `${keys.join(' or ')} is not configured`);
}

export async function getAuthConfig() {
  return sanitizeAuthConfig(await fetchAuthConfig());
}

export async function exchangeAuthCode({ code, applicationId } = {}) {
  const resolvedCode = String(code || '').trim();
  if (!resolvedCode) {
    throw createHttpError(400, 'Code is required');
  }

  const config = await fetchAuthConfig();
  const endpoint = getRequiredConfigValue(config, 'AUTH_VALIDA_TOKEN');
  const resolvedApplicationId = getAuthAppId(config, applicationId);

  if (!resolvedApplicationId) {
    throw createHttpError(500, 'VITE_AUTH_APP_ID is not configured');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code: resolvedCode,
      application_id: resolvedApplicationId,
    }),
  });

  return parseResponse(response, 'auth exchange');
}

export async function verifyAuthToken({ token, applicationId } = {}) {
  const resolvedToken = String(token || '').trim();
  if (!resolvedToken) {
    throw createHttpError(400, 'Token is required');
  }

  const config = await fetchAuthConfig();
  const endpoint = getRequiredConfigValue(config, 'AUTH_TOKEN_VALIDA');
  const resolvedApplicationId = getAuthAppId(config, applicationId);
  const apiKey = getRequiredConfigValueFromAny(config, ['VITE_AUTH_API_KEY', 'API_KEY']);

  if (!resolvedApplicationId) {
    throw createHttpError(500, 'VITE_AUTH_APP_ID is not configured');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      token: resolvedToken,
      application_id: resolvedApplicationId,
      api_key: apiKey,
    }),
  });

  return parseResponse(response, 'auth verify');
}
