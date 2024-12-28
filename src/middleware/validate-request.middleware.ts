import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { AppError, ErrorCode } from '@/utils/error-service.js';

/**
 * Middleware to validate common request parameters
 */
export const validateRequest = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    // Validate ID parameter if present
    if (req.params.id) {
      if (!Types.ObjectId.isValid(req.params.id)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid ID format', 400, true, {
          details: { id: req.params.id },
        });
      }
    }

    // Validate pagination parameters if present
    if (req.query.page) {
      const page = parseInt(req.query.page as string, 10);
      if (isNaN(page) || page < 1) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid page number', 400, true, {
          details: { page: req.query.page },
        });
      }
    }

    if (req.query.limit) {
      const limit = parseInt(req.query.limit as string, 10);
      if (isNaN(limit) || limit < 1 || limit > 100) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid limit value', 400, true, {
          details: { limit: req.query.limit },
        });
      }
    }

    // Validate content type for requests with body
    if (
      req.method !== 'GET' &&
      req.method !== 'DELETE' &&
      !req.is('multipart/form-data') &&
      !req.is('application/json')
    ) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid content type', 400, true, {
        details: {
          contentType: req.headers['content-type'],
          allowedTypes: ['multipart/form-data', 'application/json'],
        },
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Validate specific route parameters
 * Can be used as additional middleware for specific routes
 */
export const validateRouteParams = (params: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const missingParams = params.filter((param) => !(param in req.params));

      if (missingParams.length > 0) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Missing required parameters', 400, true, {
          details: {
            required: params,
            missing: missingParams,
          },
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
