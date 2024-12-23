// src/utils/error-service.ts
import { type ZodError } from 'zod';
import { logger } from './logger.js';

export enum ErrorCode {
  // Authentication & Authorization (1xxx)
  UNAUTHORIZED = 1001,
  INVALID_CREDENTIALS = 1002,
  TOKEN_EXPIRED = 1003,
  TOKEN_INVALID = 1004,
  INSUFFICIENT_PERMISSIONS = 1005,
  ACCOUNT_LOCKED = 1006,

  // Input Validation (2xxx)
  VALIDATION_ERROR = 2001,
  INVALID_INPUT = 2002,
  MISSING_REQUIRED_FIELD = 2003,
  INVALID_FORMAT = 2004,

  // Resource Errors (3xxx)
  RESOURCE_NOT_FOUND = 3001,
  RESOURCE_ALREADY_EXISTS = 3002,
  RESOURCE_CONFLICT = 3003,
  RESOURCE_DELETED = 3004,

  // Database Errors (4xxx)
  DATABASE_ERROR = 4001,
  TRANSACTION_FAILED = 4002,
  QUERY_FAILED = 4003,
  CONNECTION_ERROR = 4004,

  // External Service Errors (5xxx)
  SERVICE_UNAVAILABLE = 5001,
  EXTERNAL_API_ERROR = 5002,
  TIMEOUT = 5003,
  RATE_LIMIT_EXCEEDED = 5004,

  // Business Logic Errors (6xxx)
  BUSINESS_RULE_VIOLATION = 6001,
  INVALID_STATE = 6002,
  OPERATION_NOT_ALLOWED = 6003,

  // System Errors (7xxx)
  INTERNAL_SERVER_ERROR = 7001,
  NOT_IMPLEMENTED = 7002,
  CONFIGURATION_ERROR = 7003,

  // Data Processing Errors (8xxx)
  DATA_PROCESSING_ERROR = 8001,
  DATA_INTEGRITY_ERROR = 8002,
  DATA_FORMAT_ERROR = 8003,

  // Cache Errors (9xxx)
  CACHE_ERROR = 9001,
  CACHE_MISS = 9002,
  CACHE_INVALID = 9003,
}

export interface ErrorMetadata {
  code: ErrorCode;
  target?: string;
  details?: Record<string, unknown>;
  source?: string;
  timestamp?: Date;
}

export interface SerializedError {
  code: ErrorCode;
  message: string;
  statusCode: number;
  metadata?: ErrorMetadata;
  stack?: string;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly metadata?: ErrorMetadata;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    metadata?: Omit<ErrorMetadata, 'code'>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.metadata = metadata ? { ...metadata, code } : { code };
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InputValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.VALIDATION_ERROR, message, 400, true, { details });
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string, code: ErrorCode = ErrorCode.UNAUTHORIZED) {
    super(code, message, 401);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string) {
    super(ErrorCode.INSUFFICIENT_PERMISSIONS, message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(ErrorCode.RESOURCE_NOT_FOUND, `${resource} not found`, 404, true, { target: resource });
  }
}

export class ConflictError extends AppError {
  constructor(resource: string, details?: Record<string, unknown>) {
    super(ErrorCode.RESOURCE_CONFLICT, `${resource} already exists`, 409, true, {
      target: resource,
      details,
    });
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.DATABASE_ERROR, message, 500, false, { details });
  }
}

interface MongoError extends Error {
  code: number;
  keyPattern?: Record<string, unknown>;
  keyValue?: Record<string, unknown>;
}

export const errorHandler = {
  handle(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }

    // Handle Zod validation errors
    if (error instanceof Error && 'issues' in error) {
      const zodError = error as ZodError;
      return new InputValidationError('Validation failed', {
        errors: zodError.errors,
      });
    }

    // Handle MongoDB errors
    if ((error as Error).name === 'MongoError' || (error as Error).name === 'MongoServerError') {
      const mongoError = error as MongoError;
      if (mongoError.code === 11000) {
        return new ConflictError('Resource', {
          error: mongoError.message,
          duplicateKey: mongoError.keyValue,
        });
      }
      return new DatabaseError(mongoError.message, {
        mongoCode: mongoError.code,
        keyPattern: mongoError.keyPattern,
      });
    }

    // Handle unknown errors
    logger.error('Unhandled error:', error);
    return new AppError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      'An unexpected error occurred',
      500,
      false,
      { details: { originalError: error } },
    );
  },

  isOperationalError(error: Error): boolean {
    if (error instanceof AppError) {
      return error.isOperational;
    }
    return false;
  },

  formatZodError(error: ZodError): Record<string, unknown> {
    return {
      validation: error.errors.map((err) => ({
        path: err.path.join('.'),
        message: err.message,
        code: err.code,
      })),
    };
  },
};
