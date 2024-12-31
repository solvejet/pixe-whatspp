// src/routes/whatsapp.routes.ts

import { Router } from 'express';
import { whatsappController } from '@/controllers/whatsapp.controller.js';
import { auth, checkPermission, rateLimit } from '@/middleware/auth.middleware.js';
import { validateRequest } from '@/middleware/validate-request.js';
import { whatsappSchemas } from '@/schemas/whatsapp.schema.js';
import { auditMiddleware } from '@/middleware/audit.middleware.js';

const router = Router({
  strict: true,
  caseSensitive: true,
});

// Rate limiting configuration
const RATE_LIMITS = {
  MESSAGES: { max: 100, window: 15 * 60 }, // 100 requests per 15 minutes
  TEMPLATES: { max: 50, window: 15 * 60 }, // 50 requests per 15 minutes
  MEDIA: { max: 30, window: 15 * 60 }, // 30 requests per 15 minutes
} as const;

/**
 * Webhook Routes
 */
router.get(
  '/webhook',
  validateRequest(whatsappSchemas.webhookVerification),
  whatsappController.verifyWebhook,
);

router.post('/webhook', validateRequest(whatsappSchemas.webhook), whatsappController.handleWebhook);

/**
 * Message Routes (Protected)
 */
router.post(
  '/messages',
  auth,
  checkPermission(['messages:send']),
  rateLimit(RATE_LIMITS.MESSAGES.max, RATE_LIMITS.MESSAGES.window),
  validateRequest(whatsappSchemas.sendMessage),
  auditMiddleware('whatsapp.message.send', 'data'),
  whatsappController.sendMessage,
);

router.post(
  '/messages/template',
  auth,
  checkPermission(['messages:send', 'templates:use']),
  rateLimit(RATE_LIMITS.TEMPLATES.max, RATE_LIMITS.TEMPLATES.window),
  validateRequest(whatsappSchemas.sendTemplate),
  auditMiddleware('whatsapp.template.send', 'data'),
  whatsappController.sendTemplate,
);

router.post(
  '/messages/bulk',
  auth,
  checkPermission(['messages:send']),
  rateLimit(RATE_LIMITS.MESSAGES.max, RATE_LIMITS.MESSAGES.window),
  validateRequest(whatsappSchemas.sendBulkMessages),
  auditMiddleware('whatsapp.message.bulk', 'data'),
  whatsappController.sendBulkMessages,
);

/**
 * Conversation Routes
 */
router.get(
  '/conversations',
  auth,
  checkPermission(['conversations:read']),
  validateRequest(whatsappSchemas.listConversations),
  auditMiddleware('whatsapp.conversations.list', 'data'),
  whatsappController.getActiveConversations,
);

router.get(
  '/conversations/:id/messages',
  auth,
  checkPermission(['conversations:read']),
  validateRequest(whatsappSchemas.getConversationHistory),
  auditMiddleware('whatsapp.messages.history', 'data'),
  whatsappController.getConversationHistory,
);

router.post(
  '/conversations/:id/read',
  auth,
  checkPermission(['messages:update']),
  validateRequest(whatsappSchemas.markMessagesRead),
  auditMiddleware('whatsapp.messages.read', 'data'),
  whatsappController.markMessagesAsRead,
);

/**
 * Customer Routes
 */
router.get(
  '/customers/assigned',
  auth,
  checkPermission(['customers:read']),
  validateRequest(whatsappSchemas.listAssignedCustomers),
  auditMiddleware('whatsapp.customers.list', 'data'),
  whatsappController.getAssignedCustomers,
);

export default router;
