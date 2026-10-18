/**
 * Backend log sanitization utility — masks all sensitive data at write time.
 * Logic mirrors the frontend sanitizer but lives in the server bundle.
 */

// Sensitive field names that trigger masking
const SENSITIVE_FIELD_NAMES = new Set([
  'apiKey', 'api_key', 'api_key_encrypted', 'password', 'password_encrypted',
  'secret', 'token', 'githubToken', 'accessToken', 'authorization',
  'x-api-key', 'credentials', 'passwd', 'pwd', 'backendApiSecret',
  'cookie', 'set-cookie', 'mcp_token', 'mcpToken', 'authToken', 'auth_token', 'auth_token_encrypted', 'ct0',
]);

// URL query param keys to redact
const SENSITIVE_URL_PARAMS = [
  'key', 'api_key', 'apikey', 'token', 'access_token', 'secret', 'client_secret',
  'password', 'auth', 'auth_token', 'ct0', 'cookie', 'set-cookie',
];

// Patterns for token/key detection
const GITHUB_TOKEN_RE = /^gh[pousr]_[a-zA-Z0-9]{20,}$/;
const GITHUB_PAT_RE = /^github_pat_[a-zA-Z0-9_]{20,}$/;
const GENERIC_SECRET_RE = /^[a-zA-Z0-9+/=_-]{20,}$/;
const COMMIT_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/**
 * Mask a secret string: show only last 4 chars.
 */
export function maskSecret(value: string): string {
  if (!value || value.length <= 4) return '****';
  return '***' + value.slice(-4);
}

/**
 * Mask an email: keep domain, mask local part.
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return '***@***';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const maskedLocal = local.length <= 2 ? '**' : local[0] + '***';
  return maskedLocal + '@' + domain;
}

/**
 * Redact sensitive query params from a URL string.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) { parsed.username = '***'; parsed.password = '***'; }
    parsed.hash = '';
    for (const [key] of parsed.searchParams) {
      if (SENSITIVE_URL_PARAMS.includes(key.toLowerCase())) {
        parsed.searchParams.set(key, '***');
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function isGitHubToken(value: string): boolean {
  return GITHUB_TOKEN_RE.test(value);
}

function looksLikeSecret(value: string): boolean {
  if (COMMIT_SHA_RE.test(value)) return false;
  return value.length >= 20 && GENERIC_SECRET_RE.test(value);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Recursively sanitize an object for logging.
 */
export function sanitizeForLog(input: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return sanitizeString(input);
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (typeof input === 'object') {
    if (seen.has(input as object)) return '[Circular]';
    seen.add(input as object);
    const result = Array.isArray(input)
      ? input.map((v) => sanitizeForLog(v, seen))
      : sanitizeObject(input as Record<string, unknown>, seen);
    seen.delete(input as object);
    return result;
  }
  return sanitizeString(String(input));
}

function sanitizeString(value: string): string {
  if (isGitHubToken(value)) return maskSecret(value);
  if (GITHUB_PAT_RE.test(value)) return maskSecret(value);
  if (value.startsWith('gsm_mcp_')) return maskSecret(value);
  if (looksLikeSecret(value)) return maskSecret(value);
  if (EMAIL_RE.test(value)) return maskEmail(value);
  if (value.startsWith('http://') || value.startsWith('https://')) return redactUrl(value);
  if (value.startsWith('Bearer ') || value.startsWith('bearer ')) return value.slice(0, 7) + maskSecret(value.slice(7));
  if (value.startsWith('Basic ') || value.startsWith('basic ')) return value.slice(0, 6) + '***';
  return redactInline(value);
}

function sanitizeObject(obj: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELD_NAMES.has(key) || SENSITIVE_FIELD_NAMES.has(lowerKey)) {
      result[key] = typeof value === 'string' ? maskSecret(value) : '****';
      continue;
    }
    if (lowerKey.includes('password') || lowerKey.includes('passwd') || lowerKey.includes('pwd')) {
      result[key] = typeof value === 'string' ? maskSecret(value) : '****';
      continue;
    }
    if (lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('apikey')) {
      result[key] = typeof value === 'string' ? maskSecret(value) : '****';
      continue;
    }
    if (typeof value === 'object' && value !== null && (lowerKey === 'headers' || lowerKey === 'header')) {
      result[key] = sanitizeHeaders(value as Record<string, unknown>, seen);
      continue;
    }
    // Safe identifiers are allowed only in a declared repository field; credential keys were handled above.
    if (['full_name', 'fullName', 'repository', 'repo'].includes(key) && typeof value === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value)) {
      result[key] = value; continue;
    }
    result[key] = sanitizeForLog(value, seen);
  }
  return result;
}

function sanitizeHeaders(headers: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'cookie' || lowerKey === 'set-cookie') {
      result[key] = '***';
    } else if (lowerKey === 'authorization' || lowerKey === 'x-api-key') {
      result[key] = typeof value === 'string' && /^(Bearer|Basic) /i.test(value) ? sanitizeString(value) : typeof value === 'string' ? maskSecret(value) : '****';
    } else {
      result[key] = sanitizeForLog(value, seen);
    }
  }
  return result;
}

/**
 * Sanitize an Error object for logging.
 */
export function sanitizeError(err: unknown): { message: string; stack?: string; name?: string } {
  const isErrorLike = err instanceof Error
    || (typeof DOMException !== 'undefined' && err instanceof DOMException);
  if (!isErrorLike) return { message: redactInline(sanitizeString(String(err))) };
  const { name, message, stack } = err as Error;
  return {
    name: redactInline(sanitizeString(String(name ?? ''))).slice(0, 120),
    message: redactInline(sanitizeString(String(message ?? ''))),
    stack: stack ? redactInline(sanitizeString(String(stack))).slice(0, 8000) : undefined,
  };
}

export function redactInline(text: string): string {
  return String(text)
    .replace(/https?:\/\/[^\s"'<>]+/g, (url) => redactUrl(url))
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, (value) => maskSecret(value))
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, (value) => maskSecret(value))
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, (value) => maskSecret(value))
    .replace(/\bgsm_mcp_\S+/g, (value) => maskSecret(value))
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[redacted private key]')
    .replace(/((?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|ct0|password|secret)\s*[:=]\s*["']?)[^\s"';,]+/gi, '$1[redacted]')
    .replace(/[^@\s"'<>]+@[^@\s"'<>]+\.[A-Za-z]{2,}/g, (value) => maskEmail(value));
}

/** Privacy boundary for diagnostic persistence/export: project bodies are never journaled. */
export function sanitizeDiagnosticData(input: unknown): unknown {
  const clean = sanitizeForLog(input);
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^(requestBody|responseBody|body|payload|prompt|messages|stdout|stdin|html|attachments?|embeddings?|vectors?|content|note|notes)$/i.test(key))
      .map(([key, item]) => [key, walk(item)]));
    return value;
  };
  return walk(clean);
}
