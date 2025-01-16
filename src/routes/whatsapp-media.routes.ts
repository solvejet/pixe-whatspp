// src/routes/whatsapp-media.routes.ts

import { Router, type RequestHandler, type Response, type NextFunction } from 'express';
import { MulterError } from 'multer';
import { WhatsAppMediaController } from '@/controllers/whatsapp-media.controller.js';
import { auth, checkPermission } from '@/middleware/auth.middleware.js';
import { auditMiddleware } from '@/middleware/audit.middleware.js';
import { validateRequest } from '@/middleware/validate-request.js';
import { whatsappMediaSchemas } from '@/schemas/whatsapp-media.schema.js';
import type { AuthenticatedRequest } from '@/types/auth.js';
import type { WhatsAppMediaType } from '@/types/whatsapp.media.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { uploadSingle, uploadMultiple, handleMulterError } from '@/middleware/multer.middleware.js';
import { env } from '@/config/env.js';

/**
 * Request type definitions with proper typing
 */
interface FileUploadRequest extends AuthenticatedRequest {
  file?: Express.Multer.File;
  body: {
    type: WhatsAppMediaType;
    metadata?: string;
  };
}

interface BulkUploadRequest extends AuthenticatedRequest {
  files?: Express.Multer.File[];
  body: {
    type: WhatsAppMediaType;
    metadata?: string;
  };
}

interface MediaRequest extends AuthenticatedRequest {
  params: {
    mediaId: string;
  };
  query: {
    permanent?: string;
  };
}

const router = Router();
const controller = new WhatsAppMediaController();

/**
 * Type-safe wrapper for request handlers
 */
function asyncHandler<T extends AuthenticatedRequest>(
  handler: (req: T, res: Response) => Promise<void>,
): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req as T, res);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Enhanced multer error handler with proper typing
 */
function handleUploadError(uploadFn: RequestHandler): RequestHandler {
  return (req, res, next: NextFunction) => {
    void Promise.resolve(
      uploadFn(req, res, (error: unknown) => {
        if (error) {
          if (error instanceof MulterError) {
            const errorDetails = {
              code: error.code,
              field: error.field,
              maxSize: env.WHATSAPP_UPLOAD_MAX_SIZE,
              maxFiles: 10,
            };

            next(
              new AppError(ErrorCode.VALIDATION_ERROR, 'File upload failed', 400, true, {
                details: errorDetails,
              }),
            );
          } else {
            next(error instanceof Error ? error : new Error('Unknown upload error'));
          }
        } else {
          next();
        }
      }),
    ).catch((error) => next(error instanceof Error ? error : new Error('Unknown error')));
  };
}

/**
 * Route middleware chains
 */
const baseMiddleware = [auth, handleMulterError];

const uploadMiddleware = [
  ...baseMiddleware,
  checkPermission(['whatsapp:media:upload']),
  validateRequest(whatsappMediaSchemas.upload),
  auditMiddleware('whatsapp.media.upload', 'data'),
];

const bulkUploadMiddleware = [
  ...baseMiddleware,
  checkPermission(['whatsapp:media:upload']),
  validateRequest(whatsappMediaSchemas.bulkUpload),
  auditMiddleware('whatsapp.media.bulk-upload', 'data'),
];

const downloadMiddleware = [
  ...baseMiddleware,
  checkPermission(['whatsapp:media:download']),
  validateRequest(whatsappMediaSchemas.mediaById),
  auditMiddleware('whatsapp.media.download', 'data'),
];

const deleteMiddleware = [
  ...baseMiddleware,
  checkPermission(['whatsapp:media:delete']),
  validateRequest(whatsappMediaSchemas.mediaById),
  auditMiddleware('whatsapp.media.delete', 'data'),
];

const cleanupMiddleware = [
  ...baseMiddleware,
  checkPermission(['whatsapp:media:manage']),
  auditMiddleware('whatsapp.media.cleanup', 'data'),
];

/**
 * Routes with organized middleware chains
 */
router.post(
  '/upload',
  uploadMiddleware,
  handleUploadError(uploadSingle),
  asyncHandler<FileUploadRequest>(async (req, res) => {
    await controller.uploadMedia(req, res);
  }),
);

router.post(
  '/bulk-upload',
  bulkUploadMiddleware,
  handleUploadError(uploadMultiple),
  asyncHandler<BulkUploadRequest>(async (req, res) => {
    await controller.bulkUpload(req, res);
  }),
);

router.get(
  '/:mediaId',
  downloadMiddleware,
  asyncHandler<MediaRequest>(async (req, res) => {
    await controller.downloadMedia(req, res);
  }),
);

router.delete(
  '/:mediaId',
  deleteMiddleware,
  asyncHandler<MediaRequest>(async (req, res) => {
    await controller.deleteMedia(req, res);
  }),
);

router.post(
  '/cleanup',
  cleanupMiddleware,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    await controller.triggerCleanup(req, res);
  }),
);

export default router;
