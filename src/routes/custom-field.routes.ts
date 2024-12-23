// src/routes/custom-field.routes.ts

import type { Router as ExpressRouter } from 'express';
import { Router } from 'express';
import type { Response, RequestHandler } from 'express';
import { CustomFieldController } from '@/controllers/custom-field.controller.js';
import { auth, checkPermission, rateLimit } from '@/middleware/auth.middleware.js';
import { auditMiddleware } from '@/middleware/audit.middleware.js';
import { validateRequest } from '@/middleware/validate-request.js';
import { customFieldSchemas } from '@/schemas/custom-field.schema.js';
import type { AuthenticatedRequest } from '@/types/auth.js';

/**
 * Initialize router with security settings
 */
const router: ExpressRouter = Router({
  strict: true,
  caseSensitive: true,
});

/**
 * Type-safe wrapper for controller methods
 */
function controllerHandler<T extends AuthenticatedRequest>(
  fn: (req: T, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as T, res)).catch(next);
  };
}

const customFieldController = new CustomFieldController();

/**
 * Rate limiting configurations
 */
const RATE_LIMITS = {
  CREATE: { max: 50, window: 15 * 60 }, // 50 requests per 15 minutes
  UPDATE: { max: 100, window: 15 * 60 }, // 100 requests per 15 minutes
  DELETE: { max: 20, window: 15 * 60 }, // 20 requests per 15 minutes
  BATCH: { max: 20, window: 15 * 60 }, // 20 batch requests per 15 minutes
} as const;

/**
 * Create custom field
 * @route POST /api/customers/fields
 */
router.post(
  '/',
  auth,
  checkPermission(['customers:manage-fields']),
  rateLimit(RATE_LIMITS.CREATE.max, RATE_LIMITS.CREATE.window),
  validateRequest(customFieldSchemas.create),
  auditMiddleware('custom-field.create', 'data'),
  controllerHandler(customFieldController.createCustomField),
);

/**
 * Update custom field
 * @route PUT /api/customers/fields/:fieldId
 */
router.put(
  '/:fieldId',
  auth,
  checkPermission(['customers:manage-fields']),
  rateLimit(RATE_LIMITS.UPDATE.max, RATE_LIMITS.UPDATE.window),
  validateRequest(customFieldSchemas.update),
  auditMiddleware('custom-field.update', 'data'),
  controllerHandler(customFieldController.updateCustomField),
);

/**
 * Delete custom field
 * @route DELETE /api/customers/fields/:fieldId
 */
router.delete(
  '/:fieldId',
  auth,
  checkPermission(['customers:manage-fields']),
  rateLimit(RATE_LIMITS.DELETE.max, RATE_LIMITS.DELETE.window),
  validateRequest(customFieldSchemas.delete),
  auditMiddleware('custom-field.delete', 'data'),
  controllerHandler(customFieldController.deleteCustomField),
);

/**
 * Get custom field by ID
 * @route GET /api/customers/fields/:fieldId
 */
router.get(
  '/:fieldId',
  auth,
  checkPermission(['customers:read']),
  validateRequest(customFieldSchemas.get),
  auditMiddleware('custom-field.read', 'data'),
  controllerHandler(customFieldController.getCustomField),
);

/**
 * List custom fields
 * @route GET /api/customers/fields
 */
router.get(
  '/',
  auth,
  checkPermission(['customers:read']),
  validateRequest(customFieldSchemas.list),
  auditMiddleware('custom-field.list', 'data'),
  controllerHandler(customFieldController.listCustomFields),
);

/**
 * Batch update custom fields
 * @route PATCH /api/customers/fields/batch
 */
router.patch(
  '/batch',
  auth,
  checkPermission(['customers:manage-fields']),
  rateLimit(RATE_LIMITS.BATCH.max, RATE_LIMITS.BATCH.window),
  validateRequest(customFieldSchemas.batchUpdate),
  auditMiddleware('custom-field.batch-update', 'data'),
  controllerHandler(customFieldController.batchUpdateCustomFields),
);

export default router;
