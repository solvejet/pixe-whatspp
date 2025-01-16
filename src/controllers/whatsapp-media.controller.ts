// src/controllers/whatsapp-media.controller.ts

import type { Response } from 'express';
import { Types } from 'mongoose';
import { Role, type AuthenticatedRequest } from '@/types/auth.js';
import { whatsappMediaService } from '@/services/whatsapp-media.service.js';
import type { WhatsAppMediaType } from '@/types/whatsapp.media.js';
import { MediaQueueMessageType } from '@/types/whatsapp.media.js';
import { successResponse } from '@/middleware/error-handler.js';
import { AppError, ErrorCode } from '@/utils/error-service.js';
import { logger } from '@/utils/logger.js';
import { WhatsAppMediaModel } from '@/models/whatsapp-media.model.js';
import { RabbitMQ } from '@/config/rabbit-mq.js';

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

export class WhatsAppMediaController {
  /**
   * Upload single media file
   * @route POST /api/whatsapp/media/upload
   */
  public async uploadMedia(req: FileUploadRequest, res: Response): Promise<void> {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    if (!req.file) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'No file uploaded', 400);
    }

    const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : undefined;

    const whatsappMediaId = await whatsappMediaService.uploadMedia({
      file: req.file.buffer,
      type: req.body.type,
      mimeType: req.file.mimetype,
      uploadedBy: new Types.ObjectId(userId),
      metadata,
    });

    successResponse(res, { whatsappMediaId }, 'Media uploaded successfully', 201);
  }

  /**
   * Upload multiple media files
   * @route POST /api/whatsapp/media/bulk-upload
   */
  public async bulkUpload(req: BulkUploadRequest, res: Response): Promise<void> {
    const userId = req.user?.userId;
    if (!userId) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'User ID not found in request', 401);
    }

    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'No files uploaded', 400);
    }

    const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : undefined;
    const uploadedBy = new Types.ObjectId(userId);

    const files = req.files.map((file) => ({
      mediaId: crypto.randomUUID(),
      file: file.buffer,
      type: req.body.type,
      mimeType: file.mimetype,
      metadata,
    }));

    const result = await whatsappMediaService.bulkUpload(files, uploadedBy);
    successResponse(res, result, 'Bulk upload completed');
  }

  /**
   * Download media file
   * @route GET /api/whatsapp/media/:mediaId
   */
  public async downloadMedia(req: MediaRequest, res: Response): Promise<void> {
    const { mediaId } = req.params;

    try {
      const mediaData = await whatsappMediaService.downloadMedia(mediaId);
      const media = await WhatsAppMediaModel.findOne({ whatsappMediaId: mediaId });

      if (!media) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, 'Media not found', 404);
      }

      // Set response headers for download
      res.setHeader('Content-Type', media.mimeType);
      res.setHeader('Content-Length', mediaData.length);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${media.filePath.split('/').pop()}"`,
      );
      res.send(mediaData);
    } catch (error) {
      logger.error('Error downloading media:', { mediaId, error });
      throw error;
    }
  }

  /**
   * Delete media
   * @route DELETE /api/whatsapp/media/:mediaId
   */
  public async deleteMedia(req: MediaRequest, res: Response): Promise<void> {
    const { mediaId } = req.params;
    const permanent = req.query.permanent === 'true';

    // Queue the deletion operation
    const channel = await RabbitMQ.createChannel('whatsapp_media');
    await channel.publish(
      '',
      'whatsapp_media_queue',
      Buffer.from(
        JSON.stringify({
          type: MediaQueueMessageType.DELETE,
          data: {
            mediaId,
            permanent,
          },
          timestamp: Date.now(),
        }),
      ),
    );

    successResponse(res, null, 'Media deletion queued successfully');
  }

  /**
   * Trigger cleanup operation
   * @route POST /api/whatsapp/media/cleanup
   */
  public async triggerCleanup(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user?.roles.includes(Role.ADMIN)) {
      // Use Role enum instead of string
      throw new AppError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Admin access required', 403, true, {
        details: {
          requiredRole: Role.ADMIN,
          userRoles: req.user?.roles,
        },
      });
    }

    const channel = await RabbitMQ.createChannel('whatsapp_media');
    await channel.publish(
      '',
      'whatsapp_media_queue',
      Buffer.from(
        JSON.stringify({
          type: MediaQueueMessageType.CLEANUP,
          data: {
            olderThan: 30, // Default 30 days
            syncWithWhatsApp: true,
          },
          timestamp: Date.now(),
        }),
      ),
    );

    successResponse(res, null, 'Cleanup operation queued successfully');
  }
}
