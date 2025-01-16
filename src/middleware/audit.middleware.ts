// src/middleware/audit.middleware.ts

import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '@/types/auth.js';
import { auditService } from '@/services/audit.service.js';
import { logger } from '@/utils/logger.js';

type ResponseBody = Record<string, unknown> | string;
type ResponseCallback = undefined | (() => void);

export const auditMiddleware = (
  action: string,
  category: 'auth' | 'user' | 'system' | 'data' | 'security',
) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    // Store the original end function
    const originalEnd = res.end;
    let responseBody: ResponseBody = '';

    // Override res.end with proper function overloads
    function newEnd(
      this: Response,
      chunk: unknown,
      encoding?: BufferEncoding | ResponseCallback,
      cb?: ResponseCallback,
    ): Response {
      if (chunk && typeof chunk !== 'function') {
        try {
          if (typeof chunk === 'string') {
            responseBody = JSON.parse(chunk) as Record<string, unknown>;
          } else if (Buffer.isBuffer(chunk)) {
            responseBody = JSON.parse(chunk.toString()) as Record<string, unknown>;
          }
        } catch {
          responseBody =
            typeof chunk === 'string'
              ? chunk
              : Buffer.isBuffer(chunk)
                ? chunk.toString()
                : String(chunk);
        }
      }

      // Handle the different call signatures
      if (typeof chunk === 'function' && isResponseCallback(chunk)) {
        // If chunk is a callback, call with proper signature
        return originalEnd.apply(this, ['', 'utf8' as BufferEncoding, chunk]);
      }

      if (typeof encoding === 'function' && isResponseCallback(encoding)) {
        // If encoding is a callback, use default encoding
        return originalEnd.apply(this, [chunk, 'utf8' as BufferEncoding, encoding]);
      }

      if (encoding !== undefined && typeof encoding !== 'function') {
        // If encoding is provided, use all parameters
        return originalEnd.apply(this, [chunk, encoding, cb]);
      }

      // Default case: provide default encoding
      return originalEnd.apply(this, [chunk, 'utf8' as BufferEncoding]);
    }

    // Type guard for response callback
    function isResponseCallback(fn: unknown): fn is () => void {
      return typeof fn === 'function';
    }

    // Bind the new end function to preserve context
    res.end = newEnd.bind(res) as typeof res.end;

    // Continue with the request
    next();

    // After response is sent, log the activity
    res.on('finish', () => {
      if (req.user) {
        auditService
          .log({
            userId: req.user.userId,
            action,
            category,
            details: {
              method: req.method,
              path: req.path,
              query: req.query,
              body: req.method !== 'GET' ? req.body : undefined,
              response: responseBody,
              statusCode: res.statusCode,
            },
            ipAddress:
              req.ip ??
              req.headers['x-forwarded-for']?.toString() ??
              req.socket.remoteAddress ??
              'unknown',
            userAgent: req.headers['user-agent'] ?? 'unknown',
            status: res.statusCode >= 400 ? 'failure' : 'success',
          })
          .catch((error) => {
            logger.error('Failed to log audit event:', {
              error,
              action,
              category,
              userId: req.user?.userId,
            });
          });
      }
    });
  };
};
