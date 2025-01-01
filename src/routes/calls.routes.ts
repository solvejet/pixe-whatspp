// src/routes/calls.routes.ts

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { callsController } from '@/controllers/calls.controller.js';
import { auth, checkPermission, rateLimit } from '@/middleware/auth.middleware.js';
import { auditMiddleware } from '@/middleware/audit.middleware.js';
import { validateRequest } from '@/middleware/validate-request.js';
import { callSchemas } from '@/schemas/call.schema.js';
import { env } from '@/config/env.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import {
  type InitiateCallRequest,
  type CustomerCallHistoryRequest,
  type StaffCallHistoryRequest,
  type CallByIdRequest,
  type CallStatsRequest,
  isWebhookRequest,
  type WebhookRequest,
  isWebhookTimestampValid,
} from '@/types/call.js';

const router = Router({
  strict: true,
  caseSensitive: true,
});

// Rate limiting configurations
const RATE_LIMITS = {
  INITIATE_CALL: { max: 10, window: 15 * 60 }, // 10 calls per 15 minutes
  GET_HISTORY: { max: 100, window: 15 * 60 }, // 100 requests per 15 minutes
  GET_STATS: { max: 50, window: 15 * 60 }, // 50 requests per 15 minutes
} as const;

/**
 * Type-safe controller wrapper
 */
function controllerHandler<T extends Request>(
  fn: (req: T, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req as T, res);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Verify Exotel webhook signature
 */
const verifyExotelWebhook = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!isWebhookRequest(req)) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid webhook request format', 401, true, {
        details: {
          headers: req.headers,
        },
      });
    }

    // Validate timestamp
    const timestamp = req.headers['x-exotel-timestamp'];
    if (!isWebhookTimestampValid(timestamp)) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Webhook timestamp expired', 401, true, {
        details: {
          timestamp,
          maxAge: '5 minutes',
        },
      });
    }

    // Verify signature
    const signature = req.headers['x-exotel-signature'];
    const rawBody = JSON.stringify(req.body);
    const verificationString = `${timestamp}.${rawBody}`;
    const hmac = crypto.createHmac('sha256', env.EXOTEL_API_TOKEN);
    hmac.update(verificationString);
    const calculatedSignature = hmac.digest('hex');

    if (calculatedSignature !== signature) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid webhook signature', 401, true, {
        details: {
          expected: calculatedSignature,
          received: signature,
        },
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Route Handlers
 */

// Initiate a call
router.post(
  '/initiate',
  auth,
  checkPermission(['calls:create']),
  rateLimit(RATE_LIMITS.INITIATE_CALL.max, RATE_LIMITS.INITIATE_CALL.window),
  validateRequest(callSchemas.initiateCall),
  auditMiddleware('call.initiate', 'data'),
  controllerHandler<InitiateCallRequest>(callsController.initiateCall),
);

// Handle Exotel webhook callback
router.post(
  '/callback',
  verifyExotelWebhook,
  validateRequest(callSchemas.callback),
  auditMiddleware('call.callback', 'data'),
  controllerHandler<WebhookRequest>(callsController.handleCallback),
);

// Get customer call history
router.get(
  '/customer/:customerId',
  auth,
  checkPermission(['calls:read']),
  rateLimit(RATE_LIMITS.GET_HISTORY.max, RATE_LIMITS.GET_HISTORY.window),
  validateRequest(callSchemas.getCustomerHistory),
  auditMiddleware('call.history.customer', 'data'),
  controllerHandler<CustomerCallHistoryRequest>(callsController.getCustomerCallHistory),
);

// Get staff call history
router.get(
  '/staff',
  auth,
  checkPermission(['calls:read']),
  rateLimit(RATE_LIMITS.GET_HISTORY.max, RATE_LIMITS.GET_HISTORY.window),
  validateRequest(callSchemas.getStaffHistory),
  auditMiddleware('call.history.staff', 'data'),
  controllerHandler<StaffCallHistoryRequest>(callsController.getStaffCallHistory),
);

// Get call by ID
router.get(
  '/:id',
  auth,
  checkPermission(['calls:read']),
  validateRequest(callSchemas.getCallById),
  auditMiddleware('call.details', 'data'),
  controllerHandler<CallByIdRequest>(callsController.getCallById),
);

// Get call statistics
router.get(
  '/statistics',
  auth,
  checkPermission(['calls:read']),
  rateLimit(RATE_LIMITS.GET_STATS.max, RATE_LIMITS.GET_STATS.window),
  validateRequest(callSchemas.getStatistics),
  auditMiddleware('call.statistics', 'data'),
  controllerHandler<CallStatsRequest>(callsController.getCallStatistics),
);

export default router;
