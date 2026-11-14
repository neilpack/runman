import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiError } from '@runman/shared';

/** Throw this from a route to return a specific status code. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, res) => {
  const body: ApiError = { error: `Route not found: ${req.method} ${req.path}` };
  res.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(err);
  const body: ApiError = {
    error: status >= 500 ? 'Internal server error' : err.message,
    details: err instanceof HttpError ? err.details : undefined,
  };
  res.status(status).json(body);
};
