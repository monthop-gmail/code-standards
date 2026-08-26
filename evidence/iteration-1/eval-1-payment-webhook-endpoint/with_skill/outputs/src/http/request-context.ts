import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlates every log line of one delivery; echoed back so support can quote it. */
      requestId: string;
    }
  }
}

const REQUEST_ID_HEADER = 'x-request-id';
const INBOUND_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Reuses an inbound request id only when it looks sane — an unvalidated header
 * would let a caller inject newlines or megabytes into every log line.
 */
export function requestContext(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const inbound = req.get(REQUEST_ID_HEADER);
    req.requestId = inbound && INBOUND_ID_PATTERN.test(inbound) ? inbound : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, req.requestId);
    next();
  };
}
