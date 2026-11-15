/** A transport or gateway rejection with the metadata used for backoff. */
export class AIRequestError extends Error {
  readonly isRateLimit: boolean;

  constructor(message: string, readonly status: number, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'AIRequestError';
    this.isRateLimit = status === 429;
  }
}

export function parseRetryAfterMs(response: Response): number | undefined {
  const milliseconds = Number(response.headers.get('retry-after-ms'));
  if (Number.isFinite(milliseconds) && milliseconds > 0) return Math.round(milliseconds);

  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
  const remaining = Date.parse(header) - Date.now();
  return remaining > 0 ? remaining : undefined;
}

function httpErrorStatus(value: unknown): number | undefined {
  const status = typeof value === 'string' && /^[45]\d{2}$/.test(value) ? Number(value) : value;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status : undefined;
}

/** Some providers put the rejection inside a successful HTTP response. */
export function getAIGatewayError(data: unknown, response: Response): AIRequestError | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const envelope = data as { error?: unknown; type?: unknown };
  const error = envelope.error ?? (envelope.type === 'error' ? envelope : undefined);
  if (!error || (typeof error !== 'string' && (typeof error !== 'object' || Array.isArray(error)))) {
    return undefined;
  }

  const details: {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    type?: unknown;
    message?: unknown;
  } = typeof error === 'string' ? { message: error } : error;
  const classification = [details.code, details.type, details.status].filter(value => typeof value === 'string').join(' ');
  const message = typeof details.message === 'string' ? details.message : '';
  const rateLimited = /\b(?:throttl\w*|rate[_ -]?limit\w*|resource_exhausted|insufficient_quota|too[_ -]many[_ -]requests)\b/i.test(classification)
    || /\b(?:throttl\w*|too many requests|rate[ -]limit (?:exceeded|reached))\b/i.test(message);
  const status = httpErrorStatus(details.status) ?? httpErrorStatus(details.statusCode)
    ?? httpErrorStatus(details.code) ?? (rateLimited ? 429 : 502);

  // The provider may echo credentials or prompts in its response.
  return new AIRequestError(`AI gateway rejected the request (HTTP ${status})`, status, parseRetryAfterMs(response));
}

export async function readAIResponse(response: Response): Promise<unknown> {
  const data: unknown = await response.json();
  const gatewayError = getAIGatewayError(data, response);
  if (gatewayError) throw gatewayError;
  return data;
}
