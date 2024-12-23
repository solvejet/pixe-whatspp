// src/middleware/error-handler.ts
import type { Request, Response, NextFunction } from 'express';
import type { ParsedQs } from 'qs';
import type { ErrorMetadata } from '@/utils/error-service.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { logger } from '@/utils/logger.js';
import type { ZodError } from 'zod';

/**
 * Base type definitions
 */
type ParamsDictionary = Record<string, string>;

export interface ApiErrorResponse {
  status: 'error';
  message: string;
  code?: string;
  errors?: Array<{
    field?: string;
    message: string;
    code?: string;
    details?: Record<string, unknown>;
  }>;
  stack?: string;
}

export interface ApiSuccessResponse<T> {
  status: 'success';
  message?: string;
  data: T;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Enhanced Express types
 */
export interface CustomResponse extends Response {
  json(body: ApiResponse<unknown>): this;
  send(body: ApiResponse<unknown>): this;
}

export interface ExtendedRequest<
  P = ParamsDictionary,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = ParsedQs,
> extends Request<P, ResBody, ReqBody, ReqQuery> {
  method: string;
  path: string;
  originalUrl: string;
  ip: string;
  headers: {
    'user-agent'?: string;
    [key: string]: string | string[] | undefined;
  };
}

export interface ErrorDetail {
  field?: string;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Type guards
 */
function isZodError(error: unknown): error is ZodError {
  return error instanceof Error && 'issues' in error && Array.isArray((error as ZodError).issues);
}

function convertMetadataToRecord(
  metadata: ErrorMetadata | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  return {
    code: metadata.code,
    target: metadata.target,
    details: metadata.details,
    source: metadata.source,
    timestamp: metadata.timestamp,
  };
}

/**
 * Async handler wrapper
 */
export function asyncHandler<
  P = ParamsDictionary,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = ParsedQs,
>(
  fn: (
    req: ExtendedRequest<P, ResBody, ReqBody, ReqQuery>,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown>,
) {
  return function (
    req: ExtendedRequest<P, ResBody, ReqBody, ReqQuery>,
    res: Response,
    next: NextFunction,
  ): void {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Error handling utilities
 */
const formatErrorDetails = (error: unknown): ErrorDetail[] => {
  if (isZodError(error)) {
    return error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
  }

  if (error instanceof AppError) {
    return [
      {
        message: error.message,
        code: error.code.toString(),
        details: convertMetadataToRecord(error.metadata),
      },
    ];
  }

  if (error instanceof Error) {
    return [
      {
        message: error.message,
        code: ErrorCode.INTERNAL_SERVER_ERROR.toString(),
      },
    ];
  }

  return [
    {
      message: 'An unknown error occurred',
      code: ErrorCode.INTERNAL_SERVER_ERROR.toString(),
    },
  ];
};

const getErrorStatusCode = (error: unknown): number => {
  if (error instanceof AppError) {
    return error.statusCode;
  }

  if (isZodError(error)) {
    return 400;
  }

  if (error instanceof Error && 'code' in error) {
    const errorCode = (error as { code: string }).code;
    switch (errorCode) {
      case 'ECONNREFUSED':
        return 503;
      case 'ETIMEDOUT':
        return 504;
      default:
        return 500;
    }
  }

  return 500;
};

/**
 * Response formatters
 */
export function successResponse<T>(
  res: Response,
  data: T,
  message = 'Success',
  statusCode = 200,
): Response {
  return res.status(statusCode).json({
    status: 'success',
    message,
    data,
  } as ApiSuccessResponse<T>);
}

export function errorResponse(
  res: Response,
  error: unknown,
  message = 'An error occurred',
  statusCode?: number,
): Response {
  const errStatusCode = statusCode || getErrorStatusCode(error);
  const errors = formatErrorDetails(error);

  const response: ApiErrorResponse = {
    status: 'error',
    message,
    errors,
    code: errors[0]?.code?.toString(),
    ...(process.env.NODE_ENV === 'development' && {
      stack: error instanceof Error ? error.stack : undefined,
    }),
  };

  return res.status(errStatusCode).json(response);
}

/**
 * Error handling middleware
 */
export const errorHandler = (
  err: unknown,
  req: ExtendedRequest,
  res: Response,
  _next: NextFunction,
): void => {
  logger.error('Error:', {
    error: err,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  if (err instanceof AppError) {
    errorResponse(res, err, err.message, err.statusCode);
    return;
  }

  if (isZodError(err)) {
    errorResponse(res, err, 'Validation failed', 400);
    return;
  }

  errorResponse(
    res,
    err,
    process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : (err as Error).message,
    500,
  );
};

export const notFound = (req: ExtendedRequest, res: Response): void => {
  errorResponse(
    res,
    new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Route not found', 404),
    `Route ${req.originalUrl} not found`,
    404,
  );
};

const handleUncaughtErrors = (error: Error): void => {
  logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...', error);
  process.exit(1);
};

export const setupGlobalErrorHandlers = (): void => {
  process.on('uncaughtException', handleUncaughtErrors);
  process.on('unhandledRejection', (error: Error) => {
    handleUncaughtErrors(error);
  });
};
