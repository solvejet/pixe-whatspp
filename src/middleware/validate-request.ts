// src/middleware/validate-request.ts
import type { Request, Response, NextFunction } from 'express';
import type { AnyZodObject, ZodError } from 'zod';
import { AppError, ErrorCode } from '@/utils/error-service.js';

/**
 * Type guard to check if an error is a Zod error
 */
function isZodError(error: unknown): error is ZodError {
  return error instanceof Error && 'issues' in error && Array.isArray((error as ZodError).issues);
}

/**
 * Middleware to validate requests using Zod schemas
 */
export const validateRequest = (schema: AnyZodObject) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error: unknown) {
      if (isZodError(error)) {
        const validationErrors = error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));

        next(
          new AppError(ErrorCode.VALIDATION_ERROR, 'Validation failed', 400, true, {
            details: {
              errors: validationErrors,
              count: validationErrors.length,
            },
          }),
        );
      } else {
        // Handle unexpected errors
        next(
          new AppError(
            ErrorCode.INTERNAL_SERVER_ERROR,
            'An unexpected error occurred during validation',
            500,
            false,
            {
              details: {
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            },
          ),
        );
      }
    }
  };
};
