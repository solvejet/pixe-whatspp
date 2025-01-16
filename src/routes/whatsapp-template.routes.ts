// src/routes/whatsapp-template.routes.ts

import { Router } from 'express';
import { WhatsAppTemplateController } from '@/controllers/whatsapp-template.controller.js';
import { auth, checkPermission, rateLimit } from '@/middleware/auth.middleware.js';
import { auditMiddleware } from '@/middleware/audit.middleware.js';
import { validateRequest } from '@/middleware/validate-request.js';
import { whatsappTemplateSchemas } from '@/schemas/whatsapp-template.schema.js';

const router = Router({
  strict: true,
  caseSensitive: true,
});

const controller = new WhatsAppTemplateController();

// Rate limiting configurations
const RATE_LIMITS = {
  CREATE: { max: 50, window: 15 * 60 }, // 50 requests per 15 minutes
  UPDATE: { max: 100, window: 15 * 60 }, // 100 requests per 15 minutes
  DELETE: { max: 20, window: 15 * 60 }, // 20 requests per 15 minutes
  SYNC: { max: 10, window: 15 * 60 }, // 10 requests per 15 minutes
} as const;

/**
 * Create template
 * @route POST /api/whatsapp/templates
 */
router.post(
  '/',
  auth,
  checkPermission(['whatsapp:templates:create']),
  rateLimit(RATE_LIMITS.CREATE.max, RATE_LIMITS.CREATE.window),
  validateRequest(whatsappTemplateSchemas.create),
  auditMiddleware('whatsapp.template.create', 'data'),
  controller.createTemplate,
);

/**
 * Get template by ID
 * @route GET /api/whatsapp/templates/:id
 */
router.get(
  '/:id',
  auth,
  checkPermission(['whatsapp:templates:read']),
  validateRequest(whatsappTemplateSchemas.getById),
  auditMiddleware('whatsapp.template.read', 'data'),
  controller.getTemplateById,
);

/**
 * Update template
 * @route PUT /api/whatsapp/templates/:id
 */
router.put(
  '/:id',
  auth,
  checkPermission(['whatsapp:templates:update']),
  rateLimit(RATE_LIMITS.UPDATE.max, RATE_LIMITS.UPDATE.window),
  validateRequest(whatsappTemplateSchemas.update),
  auditMiddleware('whatsapp.template.update', 'data'),
  controller.updateTemplate,
);

/**
 * Delete template
 * @route DELETE /api/whatsapp/templates/:id
 */
router.delete(
  '/:id',
  auth,
  checkPermission(['whatsapp:templates:delete']),
  rateLimit(RATE_LIMITS.DELETE.max, RATE_LIMITS.DELETE.window),
  validateRequest(whatsappTemplateSchemas.delete),
  auditMiddleware('whatsapp.template.delete', 'data'),
  controller.deleteTemplate,
);

/**
 * List templates
 * @route GET /api/whatsapp/templates
 */
router.get(
  '/',
  auth,
  checkPermission(['whatsapp:templates:read']),
  validateRequest(whatsappTemplateSchemas.list),
  auditMiddleware('whatsapp.template.list', 'data'),
  controller.listTemplates,
);

/**
 * Sync templates with WhatsApp Business API
 * @route POST /api/whatsapp/templates/sync
 */
router.post(
  '/sync',
  auth,
  checkPermission(['whatsapp:templates:manage']),
  rateLimit(RATE_LIMITS.SYNC.max, RATE_LIMITS.SYNC.window),
  auditMiddleware('whatsapp.template.sync', 'data'),
  controller.syncTemplates,
);

export default router;
