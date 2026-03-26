import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import type { HttpLogger } from 'pino-http';
import { logger } from '../shared/logger.js';

const require = createRequire(import.meta.url);
const pinoHttp = require('pino-http') as (
  opts?: Record<string, unknown>,
) => HttpLogger<IncomingMessage, ServerResponse>;

export function requestIdMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const h = req.headers['x-request-id'];
  const id =
    typeof h === 'string' && h.trim().length > 0 ? h.trim() : randomUUID();
  req.id = id;
  next();
}

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req: IncomingMessage) => String(req.id),
  customProps: (req: IncomingMessage) => ({
    requestId: req.id,
  }),
});
