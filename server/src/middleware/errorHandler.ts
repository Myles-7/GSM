import type { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger.js';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.errorFromError('errorHandler.global', 'Unhandled error', err);

  if (res.headersSent) {
    return _next(err);
  }

  const errWithMeta = err as Error & { statusCode?: unknown; status?: unknown; code?: string; type?: string };
  const requestedStatus = errWithMeta.statusCode ?? errWithMeta.status;
  const statusCode = typeof requestedStatus === 'number' && Number.isInteger(requestedStatus)
    && requestedStatus >= 400 && requestedStatus <= 599 ? requestedStatus : 500;
  const parserErrors: Record<string, { error: string; code: string }> = {
    'entity.parse.failed': { error: 'Invalid JSON request body', code: 'INVALID_JSON' },
    'entity.too.large': { error: 'Request body is too large', code: 'PAYLOAD_TOO_LARGE' },
    'encoding.unsupported': { error: 'Unsupported request encoding', code: 'UNSUPPORTED_ENCODING' },
    'charset.unsupported': { error: 'Unsupported request charset', code: 'UNSUPPORTED_CHARSET' },
    'request.aborted': { error: 'Request body was interrupted', code: 'REQUEST_ABORTED' },
  };
  const parserError = statusCode < 500 && errWithMeta.type
    && Object.hasOwn(parserErrors, errWithMeta.type) ? parserErrors[errWithMeta.type] : undefined;
  if (parserError) {
    res.status(statusCode).json(parserError);
    return;
  }
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error';
  const code = errWithMeta.code || 'INTERNAL_SERVER_ERROR';

  res.status(statusCode).json({ error: message, code });
}
