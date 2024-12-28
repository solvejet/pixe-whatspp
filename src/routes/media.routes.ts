// src/routes/media.routes.ts
import type { Router as ExpressRouter } from 'express';
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { MediaController } from '@/controllers/media.controller.js';
import { auth, checkPermission, rateLimit } from '@/middleware/auth.middleware.js';
import { auditMiddleware } from '@/middleware/audit.middleware.js';
import { validateRequest } from '@/middleware/validate-request.js';
import { mediaSchemas } from '@/schemas/media.schema.js';
import { uploadSingle, uploadMultiple, handleMulterError } from '@/middleware/multer.middleware.js';

/**
 * Initialize router with security settings
 */
const router: ExpressRouter = Router({
  strict: true,
  caseSensitive: true,
});

/**
 * Rate limit configurations for media operations
 */
const RATE_LIMITS = {
  UPLOAD: { max: 10, window: 15 * 60 }, // 10 uploads per 15 minutes
  BULK_UPLOAD: { max: 5, window: 15 * 60 }, // 5 bulk uploads per 15 minutes
  LIST: { max: 100, window: 15 * 60 }, // 100 list requests per 15 minutes
  DELETE: { max: 20, window: 15 * 60 }, // 20 deletes per 15 minutes
} as const;

const mediaController = new MediaController();

/**
 * @route   POST /api/media/upload
 * @desc    Upload a single media file
 * @access  Private
 */
router.post(
  '/upload',
  auth,
  checkPermission(['media:upload']),
  rateLimit(RATE_LIMITS.UPLOAD.max, RATE_LIMITS.UPLOAD.window),
  uploadSingle,
  handleMulterError,
  validateRequest(mediaSchemas.upload),
  auditMiddleware('media.upload', 'data'),
  mediaController.uploadMedia as RequestHandler,
);

/**
 * @route   POST /api/media/bulk-upload
 * @desc    Upload multiple media files
 * @access  Private
 */
router.post(
  '/bulk-upload',
  auth,
  checkPermission(['media:upload']),
  rateLimit(RATE_LIMITS.BULK_UPLOAD.max, RATE_LIMITS.BULK_UPLOAD.window),
  uploadMultiple,
  handleMulterError,
  validateRequest(mediaSchemas.bulkUpload),
  auditMiddleware('media.bulk-upload', 'data'),
  mediaController.bulkUpload as RequestHandler,
);

/**
 * @route   GET /api/media/:id
 * @desc    Get media by ID
 * @access  Private
 */
router.get(
  '/:id',
  auth,
  checkPermission(['media:read']),
  validateRequest(mediaSchemas.getById),
  auditMiddleware('media.read', 'data'),
  mediaController.getMediaById as RequestHandler,
);

/**
 * @route   DELETE /api/media/:id
 * @desc    Delete media
 * @access  Private
 */
router.delete(
  '/:id',
  auth,
  checkPermission(['media:delete']),
  rateLimit(RATE_LIMITS.DELETE.max, RATE_LIMITS.DELETE.window),
  validateRequest(mediaSchemas.delete),
  auditMiddleware('media.delete', 'data'),
  mediaController.deleteMedia as RequestHandler,
);

/**
 * @route   GET /api/media
 * @desc    List media files with pagination and filtering
 * @access  Private
 */
router.get(
  '/',
  auth,
  checkPermission(['media:read']),
  rateLimit(RATE_LIMITS.LIST.max, RATE_LIMITS.LIST.window),
  validateRequest(mediaSchemas.list),
  auditMiddleware('media.list', 'data'),
  mediaController.listMedia as RequestHandler,
);

export default router;
