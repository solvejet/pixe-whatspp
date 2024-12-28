// src/routes/call.routes.ts

import type { Router as ExpressRouter, Response, NextFunction, RequestHandler } from 'express';
import { Router } from 'express';
import crypto from 'crypto';
import { callsController } from '@/controllers/calls.controller.js';
import { auth, checkPermission, rateLimit } from '@/middleware/auth.middleware.js';
import { auditMiddleware } from '@/middleware/audit.middleware.js';
import { validateRequest } from '@/middleware/validate-request.js';
import { callSchemas } from '@/schemas/call.schema.js';
import { env } from '@/config/env.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import type { WebhookRequest } from '@/types/call.js';

const router: ExpressRouter = Router({
  strict: true,
  caseSensitive: true,
});

const RATE_LIMITS = {
  INITIATE_CALL: { max: 10, window: 15 * 60 },
  GET_HISTORY: { max: 100, window: 15 * 60 },
  GET_STATS: { max: 50, window: 15 * 60 },
} as const;

// Type-safe middleware wrapper
const asHandler = (handler: RequestHandler): RequestHandler => handler;

/**
 * Verify Exotel webhook signature
 */
const verifyExotelWebhook: RequestHandler = (req, _res, next): void => {
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
};

// Routes with type-safe handlers
router.post(
  '/initiate',
  asHandler(auth),
  asHandler(checkPermission(['calls:create'])),
  asHandler(rateLimit(RATE_LIMITS.INITIATE_CALL.max, RATE_LIMITS.INITIATE_CALL.window)),
  asHandler(validateRequest(callSchemas.initiateCall)),
  asHandler(auditMiddleware('call.initiate', 'data')),
  asHandler(callsController.initiateCall as RequestHandler),
);

router.post(
  '/callback',
  verifyExotelWebhook,
  asHandler(validateRequest(callSchemas.callback)),
  asHandler(auditMiddleware('call.callback', 'data')),
  asHandler(callsController.handleCallback as RequestHandler),
);

router.get(
  '/customer/:customerId',
  asHandler(auth),
  asHandler(checkPermission(['calls:read'])),
  asHandler(rateLimit(RATE_LIMITS.GET_HISTORY.max, RATE_LIMITS.GET_HISTORY.window)),
  asHandler(validateRequest(callSchemas.getCustomerHistory)),
  asHandler(auditMiddleware('call.history.customer', 'data')),
  asHandler(callsController.getCustomerCallHistory as RequestHandler),
);

router.get(
  '/staff',
  asHandler(auth),
  asHandler(checkPermission(['calls:read'])),
  asHandler(rateLimit(RATE_LIMITS.GET_HISTORY.max, RATE_LIMITS.GET_HISTORY.window)),
  asHandler(validateRequest(callSchemas.getStaffHistory)),
  asHandler(auditMiddleware('call.history.staff', 'data')),
  asHandler(callsController.getStaffCallHistory as RequestHandler),
);

router.get(
  '/:id',
  asHandler(auth),
  asHandler(checkPermission(['calls:read'])),
  asHandler(validateRequest(callSchemas.getCallById)),
  asHandler(auditMiddleware('call.details', 'data')),
  asHandler(callsController.getCallById as RequestHandler),
);

router.get(
  '/statistics',
  asHandler(auth),
  asHandler(checkPermission(['calls:read'])),
  asHandler(rateLimit(RATE_LIMITS.GET_STATS.max, RATE_LIMITS.GET_STATS.window)),
  asHandler(validateRequest(callSchemas.getStatistics)),
  asHandler(auditMiddleware('call.statistics', 'data')),
  asHandler(callsController.getCallStatistics as RequestHandler),
);

export default router;
