// src/routes/whatsapp-webhook.routes.ts

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { whatsappWebhookController } from '@/controllers/whatsapp-webhook.controller.js';
import { validateRequest } from '@/middleware/validate-request.js';
import { whatsappWebhookSchemas } from '@/schemas/whatsapp-webhook.schema.js';
import { auditMiddleware } from '@/middleware/audit.middleware.js';

const router = Router({
  strict: true,
  caseSensitive: true,
});

/**
 * Rate limiting configuration for webhook endpoints
 */
const RATE_LIMITS = {
  VERIFY: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 verification attempts per 15 minutes
  },
  WEBHOOK: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 webhooks per minute
  },
} as const;

// Webhook verification endpoint
router.get(
  '/',
  rateLimit({
    windowMs: RATE_LIMITS.VERIFY.windowMs,
    max: RATE_LIMITS.VERIFY.max,
    skipSuccessfulRequests: false,
  }),
  validateRequest(whatsappWebhookSchemas.verify),
  auditMiddleware('whatsapp.webhook.verify', 'system'),
  whatsappWebhookController.verifyWebhook,
);

// Webhook receiver endpoint
router.post(
  '/',
  rateLimit({
    windowMs: RATE_LIMITS.WEBHOOK.windowMs,
    max: RATE_LIMITS.WEBHOOK.max,
    skipSuccessfulRequests: true, // Don't count successful webhooks against the limit
  }),
  validateRequest(whatsappWebhookSchemas.webhook),
  auditMiddleware('whatsapp.webhook.receive', 'system'),
  whatsappWebhookController.handleWebhook,
);

export default router;
