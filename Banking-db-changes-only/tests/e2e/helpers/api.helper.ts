import { APIRequestContext, APIResponse, expect } from '@playwright/test';

export interface ApiRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  data?: any;
  params?: Record<string, string | number | boolean>;
  timeout?: number;
}

/**
 * Normalizes an API route, collapsing consecutive slashes and deduplicating repeated prefixes.
 * E.g. /api/webhooks/api/webhooks -> /api/webhooks
 */
export function normalizeApiPath(rawPath: string): string {
  let path = (rawPath || '/').trim();
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  path = path.replace(/\/+/g, '/');

  // Deduplicate repeated prefix segments (e.g. /api/webhooks/api/webhooks)
  const prefixMatch = path.match(/^(\/[^\/]+(?:\/[^\/]+)*?)\1(\/.*)?$/);
  if (prefixMatch) {
    path = prefixMatch[1] + (prefixMatch[2] || '');
  }
  return path;
}

/**
 * Returns role-specific authorization and request headers from runtime environment.
 */
export function getApiRoleHeaders(role: string = 'CUSTOMER'): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
  };
  const normRole = (role || '').toUpperCase();
  if (normRole === 'ANONYMOUS' || normRole === 'PUBLIC' || normRole === 'NONE') {
    return headers;
  }

  const token =
    process.env[`PLAYWRIGHT_${normRole}_API_TOKEN`] ||
    process.env[`TEST_${normRole}_TOKEN`] ||
    process.env[`PLAYWRIGHT_AUTH_${normRole}_TOKEN`] ||
    process.env.PLAYWRIGHT_API_TOKEN ||
    '';

  const cookie =
    process.env[`PLAYWRIGHT_AUTH_${normRole}_COOKIE`] ||
    process.env.PLAYWRIGHT_SESSION_COOKIE ||
    '';

  const customHeaderName = process.env.PLAYWRIGHT_API_HEADER || 'Authorization';

  if (token) {
    if (customHeaderName.toLowerCase() === 'authorization') {
      headers['Authorization'] = token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
    } else {
      headers[customHeaderName] = token;
    }
  }

  if (cookie) {
    headers['Cookie'] = cookie;
  }

  return headers;
}

/**
 * Dispatches an API request with timeout interceptor and 502/503/504 server unavailable detection.
 */
export async function executeApiRequest(
  request: APIRequestContext,
  baseURL: string | undefined,
  method: string,
  rawPath: string,
  options: ApiRequestOptions = {}
): Promise<APIResponse> {
  const cleanPath = normalizeApiPath(rawPath);
  const targetUrl = (baseURL || '').replace(/\/+$/, '') + cleanPath;
  const timeoutMs = options.timeout || 15000;

  let response: APIResponse;
  try {
    response = await request.fetch(targetUrl, {
      method: method.toUpperCase(),
      headers: options.headers || {},
      data: options.data,
      params: options.params,
      timeout: timeoutMs,
      failOnStatusCode: false,
    });
  } catch (err: any) {
    const errStr = err.message || String(err);
    if (errStr.includes('timeout') || errStr.includes('timed out')) {
      throw new Error(`API_TIMEOUT: Request to ${targetUrl} [${method}] exceeded ${timeoutMs}ms: ${errStr}`);
    }
    throw err;
  }

  const status = response.status();
  if (status === 503 || status === 502 || status === 504) {
    throw new Error(`APPLICATION_UNAVAILABLE: Target route returned HTTP ${status} (${targetUrl})`);
  }

  return response;
}
