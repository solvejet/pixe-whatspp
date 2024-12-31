// src/routes/call.routes.ts

import type { Router as ExpressRouter, Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import crypto from 'crypto';
import { callsController } from '@/controllers/calls.controller.js';
import { auth, checkPermission, rateLimit } from '@/middleware/auth.middleware.js';
import { auditMiddleware } from '@/middleware/audit.middleware.js';
import { validateRequest } from '@/middleware/validate-request.js';
import { callSchemas } from '@/schemas/call.schema.js';
import { env } from '@/config/env.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import type {
  WebhookRequest,
  InitiateCallRequest,
  CustomerCallHistoryRequest,
  StaffCallHistoryRequest,
  CallByIdRequest,
  CallStatsRequest,
} from '@/types/call.js';

const router: ExpressRouter = Router({
  strict: true,
  caseSensitive: true,
});

const RATE_LIMITS = {
  INITIATE_CALL: { max: 10, window: 15 * 60 }, // 10 calls per 15 minutes
  GET_HISTORY: { max: 100, window: 15 * 60 }, // 100 requests per 15 minutes
  GET_STATS: { max: 50, window: 15 * 60 }, // 50 requests per 15 minutes
} as const;

/**
 * Type-safe controller wrapper
 */
function controllerHandler<T extends Request>(handler: (req: T, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handler(req as T, res);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Verify Exotel webhook signature
 */
function verifyExotelWebhook(req: Request, _res: Response, next: NextFunction): void {
  const webhookReq = req as WebhookRequest;
  const signature = webhookReq.headers['x-exotel-signature'];
  const timestamp = webhookReq.headers['x-exotel-timestamp'];

  if (!signature || !timestamp || Array.isArray(signature) || Array.isArray(timestamp)) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Missing webhook signature headers', 401);
  }

  const rawBody = JSON.stringify(webhookReq.body);
  const verificationString = `${timestamp}.${rawBody}`;

  const hmac = crypto.createHmac('sha256', env.EXOTEL_API_TOKEN);
  hmac.update(verificationString);
  const calculatedSignature = hmac.digest('hex');

  if (calculatedSignature !== signature) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Invalid webhook signature', 401);
  }

  next();
}

// Routes with type-safe handlers
router.post(
  '/initiate',
  auth,
  checkPermission(['calls:create']),
  rateLimit(RATE_LIMITS.INITIATE_CALL.max, RATE_LIMITS.INITIATE_CALL.window),
  validateRequest(callSchemas.initiateCall),
  auditMiddleware('call.initiate', 'data'),
  controllerHandler<InitiateCallRequest>(callsController.initiateCall),
);

router.post(
  '/callback',
  verifyExotelWebhook,
  validateRequest(callSchemas.callback),
  auditMiddleware('call.callback', 'data'),
  controllerHandler<WebhookRequest>(callsController.handleCallback),
);

router.get(
  '/customer/:customerId',
  auth,
  checkPermission(['calls:read']),
  rateLimit(RATE_LIMITS.GET_HISTORY.max, RATE_LIMITS.GET_HISTORY.window),
  validateRequest(callSchemas.getCustomerHistory),
  auditMiddleware('call.history.customer', 'data'),
  controllerHandler<CustomerCallHistoryRequest>(callsController.getCustomerCallHistory),
);

router.get(
  '/staff',
  auth,
  checkPermission(['calls:read']),
  rateLimit(RATE_LIMITS.GET_HISTORY.max, RATE_LIMITS.GET_HISTORY.window),
  validateRequest(callSchemas.getStaffHistory),
  auditMiddleware('call.history.staff', 'data'),
  controllerHandler<StaffCallHistoryRequest>(callsController.getStaffCallHistory),
);

router.get(
  '/:id',
  auth,
  checkPermission(['calls:read']),
  validateRequest(callSchemas.getCallById),
  auditMiddleware('call.details', 'data'),
  controllerHandler<CallByIdRequest>(callsController.getCallById),
);

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
